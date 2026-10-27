-- UNDO for supabase_migration_referral_reason_c_functions.sql: removes the referral-by-reason functions and puts the three counselor-side functions back exactly as they
-- were (they then work for renewal consultations only). Run this BEFORE undo_referral_reason_b.sql and undo_referral_reason_a.sql.
-- Referrals made with a reason and bookings that belong to a referral are NOT deleted; they just stop being handled until the file is run again.
drop function if exists public.consultation_referral_enabled();
drop function if exists public.create_consultation_referral(text, text, text, jsonb, jsonb, text, date);
drop function if exists public.consultation_my_referrals();
drop function if exists public.referral_open_blocks(uuid);
drop function if exists public.referral_book_consultation(uuid, date, text);
drop function if exists public.referral_reschedule_consultation(uuid, date, text);
drop function if exists public.referral_cancel_booking(uuid);
drop function if exists public._referral_place(uuid, text, date, text, text, text);

-- _counseling_prefill
create or replace function public._counseling_prefill(p_slot_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.counseling_slots%rowtype;
  r public.renewal_records%rowtype;
  v_scholar public.scholars%rowtype;
  v_ev jsonb;
  v_failed text;
  v_inc jsonb;
begin
  select * into s from public.counseling_slots where id = p_slot_id;
  select * into r from public.renewal_records where id = s.record_id;
  select * into v_scholar from public.scholars where scholar_id_number = s.scholar_id_number;
  v_ev := public._renewal_evaluate(s.scholar_id_number, r.school_year, r.term);
  select string_agg(f ->> 'subject' || ' (' || coalesce(f ->> 'grade', '') || ')', ', ') into v_failed
  from jsonb_array_elements(coalesce(v_ev -> 'grades' -> 'failed_subjects', '[]'::jsonb) || coalesce(v_ev -> 'grades' -> 'inc_subjects', '[]'::jsonb)) f;
  select coalesce(jsonb_agg(jsonb_build_object('item_id', i.id, 'subject', i.subject, 'deadline', i.deadline) order by i.subject), '[]'::jsonb) into v_inc
  from public.renewal_inc_items i where i.record_id = r.id and i.state = 'open';
  return jsonb_build_object('slot_id', s.id, 'record_id', r.id, 'scholar_id_number', s.scholar_id_number,
    'scholar_name', btrim(v_scholar.last_name || ', ' || v_scholar.first_name), 'status', v_scholar.status, 'failed_subjects', coalesce(v_failed, ''),
    'inc_items', v_inc, 'is_summer', r.term = 'Summer', 'term_label', r.term || ' ' || r.school_year,
    'date_visited', (s.starts_at at time zone 'Asia/Manila')::date);
end;
$$;
revoke all on function public._counseling_prefill(uuid) from public, anon, authenticated;

-- counseling_mark_slot
create or replace function public.counseling_mark_slot(p_slot_id uuid, p_outcome text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.counseling_slots%rowtype;
  r public.renewal_records%rowtype;
  v_ev jsonb;
  v_scholar public.scholars%rowtype;
  v_failed text;
  v_inc jsonb;
begin
  perform public._require_counseling_staff();
  if p_outcome not in ('attended', 'no_show') then raise exception 'Choose Attended or No-show.'; end if;
  select * into s from public.counseling_slots where id = p_slot_id and staff_id = auth.uid() for update;
  if not found then raise exception 'That appointment was not found.'; end if;
  if s.state <> 'booked' then raise exception 'This slot is not booked (it is %).', s.state; end if;
  if p_outcome = 'no_show' and s.starts_at > now() then raise exception 'A no-show can only be marked after the slot has started.'; end if;
  select * into r from public.renewal_records where id = s.record_id for update;
  select * into v_scholar from public.scholars where scholar_id_number = s.scholar_id_number;

  update public.counseling_slots set state = p_outcome, marked_by = auth.uid(), marked_at = now() where id = s.id;
  perform public._booking_log(s.record_id, s.scholar_id_number, s.starts_at, s.staff_id, p_outcome);

  if p_outcome = 'no_show' then
    update public.renewal_records set no_show_flag = true, no_show_count = no_show_count + 1, updated_at = now() where id = r.id;
    perform public._renewal_log(r.id, r.stage, r.stage, 'No-show for the consultation on ' || public._manila_slot_text(s.starts_at) || '. The scholar must book a new slot.');
    perform public._notify_scholar(s.scholar_id_number, 'no_show', 'You missed your consultation',
      'You did not come to your consultation on ' || public._manila_slot_text(s.starts_at) || '. Please book a new time from your Renewal tile.', r.id);
    return jsonb_build_object('ok', true, 'outcome', 'no_show');
  end if;

  update public.renewal_records set consultation_done_at = coalesce(consultation_done_at, now()), no_show_flag = false, updated_at = now() where id = r.id;
  perform public._renewal_log(r.id, r.stage, r.stage, 'Consultation attended on ' || public._manila_slot_text(s.starts_at) || '.');
  perform public._renewal_recheck(r.id);
  return public._counseling_prefill(s.id) || jsonb_build_object('ok', true, 'outcome', 'attended');
end;
$$;
revoke all on function public.counseling_mark_slot(uuid, text) from public, anon;
grant execute on function public.counseling_mark_slot(uuid, text) to authenticated;

-- counseling_save_daily_record
create or replace function public.counseling_save_daily_record(
  p_slot_id uuid, p_scholar_id_number text, p_status text, p_date_visited date, p_failed_subjects text, p_findings text,
  p_staff_recommendations text, p_visit_type text, p_days_given integer default null, p_hard_copy boolean default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  s public.counseling_slots%rowtype;
  r public.renewal_records%rowtype;
  v_item record;
  v_needs_days boolean := false;
begin
  perform public._require_counseling_staff();
  if not exists (select 1 from public.scholars where scholar_id_number = p_scholar_id_number) then raise exception 'Scholar not found.'; end if;
  if p_slot_id is not null then
    select * into s from public.counseling_slots where id = p_slot_id and staff_id = auth.uid() for update;
    if not found then raise exception 'That appointment was not found.'; end if;
    if s.state <> 'attended' or s.scholar_id_number <> p_scholar_id_number then raise exception 'Mark the appointment as Attended first.'; end if;
    if s.daily_record_id is not null then raise exception 'A Daily Record was already saved for this appointment.'; end if;
    select * into r from public.renewal_records where id = s.record_id for update;
    select exists (select 1 from public.renewal_inc_items i where i.record_id = r.id and i.state = 'open' and i.deadline is null) into v_needs_days;
    if v_needs_days and (p_days_given is null or p_days_given < 1) then
      raise exception 'Please enter the days given to comply for the INC subject(s).';
    end if;
  end if;

  insert into public.scholar_counseling_records (scholar_id_number, status, consulted_by, date_visited, failed_subjects, findings, staff_recommendations, visit_type,
      slot_id, renewal_record_id, days_given, prospectus_hard_copy)
  values (p_scholar_id_number, p_status, auth.uid(), coalesce(p_date_visited, current_date), coalesce(p_failed_subjects, ''), coalesce(p_findings, ''),
      coalesce(p_staff_recommendations, ''), coalesce(nullif(btrim(p_visit_type), ''), 'Office'), p_slot_id, r.id, p_days_given, p_hard_copy)
  returning id into v_id;

  if p_slot_id is not null then
    update public.counseling_slots set daily_record_id = v_id where id = p_slot_id;
    for v_item in select i.id from public.renewal_inc_items i where i.record_id = r.id and i.state = 'open' and i.deadline is null loop
      perform public._renewal_apply_inc_deadline(v_item.id, coalesce(p_date_visited, current_date), p_days_given, '');
    end loop;
    if r.term = 'Summer' and coalesce(p_hard_copy, false) then
      update public.renewal_records set hard_copy_received_at = coalesce(hard_copy_received_at, now()), updated_at = now() where id = r.id;
      perform public._renewal_log(r.id, r.stage, r.stage, 'Prospectus hard copy received.');
    end if;
    perform public._renewal_recheck(r.id);
  end if;
  return v_id;
end;
$$;
revoke all on function public.counseling_save_daily_record(uuid, text, text, date, text, text, text, text, integer, boolean) from public, anon;
grant execute on function public.counseling_save_daily_record(uuid, text, text, date, text, text, text, text, integer, boolean) to authenticated;

notify pgrst, 'reload schema';
