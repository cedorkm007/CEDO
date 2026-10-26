-- ─────────────────────────────────────────────────────────────
-- CONSULTATION REFERRAL BY REASON, FILE C of 3: the referral and booking functions.   Safe to run twice.   Undo: undo_referral_reason_c.sql
-- Run AFTER files A and B (and after the two consultation-types files).
--
-- THE NEW PROCESS
--   1. Staff (the Scholar Renewal evaluator, or Scholar Management staff) refer a scholar for a consultation and choose only the REASON: one of the consultation types
--      (INC, IP, GWA, 1 Failed, 2 or more Failed, Personal concern, Ethical concern). They do not choose a counselor and do not book a time.
--   2. The scholar is notified (in the portal bell and as a push message) and sees the referral in the Consultation tile.
--   3. The scholar chooses a day and morning (AM) or afternoon (PM). The consultation takes the minutes of the reason; the staff member with the most minutes left is
--      assigned, exactly as for a renewal consultation. The referral is now "booked" and shows who the consultation is with.
--   4. The scholar can change or cancel up to 12 hours before. Cancelling or a no-show puts the referral back to "waiting for the scholar to book".
--   5. When the counselor marks the appointment Attended (and writes the Daily Record), the referral enters that counselor's queue, and the existing steps follow
--      (remarks, the Division Head's decision, the signature).
-- Creates functions and replaces three (the Daily Record's pre-fill, Attended / No-show, and saving the Daily Record: they now also work for a booking that belongs
-- to a referral and not to a renewal). No table is changed here. Nothing is deleted.
-- ─────────────────────────────────────────────────────────────

-- The website asks this once to know whether the new referral form can be used (before this file is run it keeps the old "Refer to" form).
create or replace function public.consultation_referral_enabled()
returns boolean
language sql
stable
as $$ select true; $$;
revoke all on function public.consultation_referral_enabled() from public, anon;
grant execute on function public.consultation_referral_enabled() to authenticated;

-- ── 1. Staff: refer a scholar for a consultation, by reason ──
create or replace function public.create_consultation_referral(
  p_scholar_id_number text, p_reason text, p_previous_semester_status text,
  p_failed_subjects jsonb, p_lacking_grades jsonb, p_endorsed_for text,
  p_referral_date date default current_date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_type public.consultation_types%rowtype;
begin
  if not (public.has_staff_tag('scholar_management') or public.is_renewal_evaluator()) then
    raise exception 'Not authorized to refer scholars for consultation.';
  end if;
  if not exists (select 1 from public.scholars where scholar_id_number = p_scholar_id_number) then raise exception 'Scholar not found.'; end if;
  select * into v_type from public.consultation_types t where t.key = p_reason and t.active;
  if not found then raise exception 'Choose the reason for the consultation.'; end if;
  if exists (select 1 from public.scholar_counseling_referrals f where f.scholar_id_number = p_scholar_id_number and f.status <> 'approved') then
    raise exception 'This scholar already has a referral that is not finished yet.';
  end if;

  insert into public.scholar_counseling_referrals
    (scholar_id_number, referred_by, referred_to, previous_semester_status, failed_subjects, lacking_grades, endorsed_for, referral_date, reason, status)
  values
    (p_scholar_id_number, auth.uid(), null, p_previous_semester_status, coalesce(p_failed_subjects, '[]'::jsonb), coalesce(p_lacking_grades, '[]'::jsonb), p_endorsed_for,
     coalesce(p_referral_date, current_date), v_type.key, 'awaiting_booking')
  returning id into v_id;

  perform public._notify_scholar(p_scholar_id_number, 'consultation_referral', 'You are referred for a consultation',
    'CEDO referred you for a consultation: ' || v_type.label || ' (' || v_type.minutes || ' minutes). Please open the Consultation tile and choose a day and morning or afternoon.', null);
  return v_id;
end;
$$;
revoke all on function public.create_consultation_referral(text, text, text, jsonb, jsonb, text, date) from public, anon;
grant execute on function public.create_consultation_referral(text, text, text, jsonb, jsonb, text, date) to authenticated;

-- ── 2. Scholar: my referrals, the open mornings / afternoons, book, change, cancel ──
create or replace function public.consultation_my_referrals()
returns table(referral_id uuid, reason text, reason_label text, minutes integer, status text, referred_at timestamptz,
              slot_id uuid, starts_at timestamptz, ends_at timestamptz, staff_name text, can_change boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id text := public.current_scholar_id_number();
begin
  if v_id is null then raise exception 'Not signed in as a scholar.'; end if;
  return query
  select f.id, f.reason, coalesce(t.label, 'Consultation'), t.minutes, f.status, f.created_at,
         x.id, x.starts_at, x.ends_at, case when x.id is null then null else public._staff_display_name(x.staff_id) end,
         coalesce(x.starts_at >= now() + interval '12 hours', false)
  from public.scholar_counseling_referrals f
  left join public.consultation_types t on t.key = f.reason
  left join public.counseling_slots x on x.referral_id = f.id and x.state = 'booked'
  where f.scholar_id_number = v_id and f.reason is not null and f.status in ('awaiting_booking', 'booked')
  order by f.created_at desc;
end;
$$;
revoke all on function public.consultation_my_referrals() from public, anon;
grant execute on function public.consultation_my_referrals() to authenticated;

create or replace function public.referral_open_blocks(p_referral_id uuid)
returns table(day date, half text, spots integer, free_minutes integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id text := public.current_scholar_id_number();
  f public.scholar_counseling_referrals%rowtype;
  v_min integer;
begin
  if v_id is null then raise exception 'Not signed in as a scholar.'; end if;
  select * into f from public.scholar_counseling_referrals where id = p_referral_id and scholar_id_number = v_id and status in ('awaiting_booking', 'booked');
  if not found then raise exception 'That referral was not found.'; end if;
  select t.minutes into v_min from public.consultation_types t where t.key = f.reason and t.active;
  if v_min is null then raise exception 'The reason of this referral is no longer available. Please contact the CEDO office.'; end if;
  return query
  select b.day, b.half, sum((b.capacity - b.booked) / v_min)::integer, sum(b.capacity - b.booked)::integer
  from public._consult_blocks(now(), now() + interval '61 days') b
  where b.window_start >= now() + interval '12 hours' and b.window_start < now() + interval '60 days' and b.capacity - b.booked >= v_min
  group by b.day, b.half
  order by b.day, b.half;
end;
$$;
revoke all on function public.referral_open_blocks(uuid) from public, anon;
grant execute on function public.referral_open_blocks(uuid) to authenticated;

-- The one place a referral booking is made (booking and changing): picks the staff member with the most minutes left in that morning / afternoon.
create or replace function public._referral_place(p_referral_id uuid, p_scholar text, p_day date, p_half text, p_action text, p_from_text text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.scholar_counseling_referrals%rowtype;
  v_type public.consultation_types%rowtype;
  v_staff uuid;
  v_start timestamptz;
begin
  select * into f from public.scholar_counseling_referrals where id = p_referral_id;
  select * into v_type from public.consultation_types where key = f.reason and active;
  if not found then raise exception 'The reason of this referral is no longer available. Please contact the CEDO office.'; end if;
  if p_half not in ('AM', 'PM') then raise exception 'Please choose morning (AM) or afternoon (PM).'; end if;
  if p_day is null then raise exception 'Please choose a day.'; end if;

  perform pg_advisory_xact_lock(731001);
  select b.staff_id, b.window_start into v_staff, v_start
  from public._consult_blocks(p_day::timestamp at time zone 'Asia/Manila' - interval '1 day', p_day::timestamp at time zone 'Asia/Manila' + interval '2 days') b
  where b.day = p_day and b.half = p_half and b.capacity - b.booked >= v_type.minutes and b.window_start >= now() + interval '12 hours'
  order by (b.capacity - b.booked) desc, b.staff_id
  limit 1;
  if v_staff is null then raise exception 'That time was just filled. Please choose another.'; end if;

  insert into public.counseling_slots (staff_id, starts_at, ends_at, state, record_id, referral_id, scholar_id_number, booked_at, consult_type, minutes, reminded_day_at)
  values (v_staff, v_start, v_start + make_interval(mins => v_type.minutes), 'booked', null, f.id, p_scholar, now(), v_type.key, v_type.minutes,
          case when v_start - now() < interval '24 hours' then now() end);
  update public.scholar_counseling_referrals set status = 'booked', referred_to = v_staff, updated_at = now() where id = f.id;

  perform public._booking_log(null, p_scholar, v_start, v_staff, p_action, case when p_from_text is null then v_type.label else 'From ' || p_from_text || ' · ' || v_type.label end);
  perform public._notify_scholar(p_scholar, 'booking_confirmed', case p_action when 'rescheduled' then 'Your consultation was rescheduled' else 'Your consultation is booked' end,
    public._manila_slot_text(v_start) || ' with ' || public._staff_display_name(v_staff) || ', at the CEDO office (' || v_type.label || '). Please come during the '
      || case p_half when 'AM' then 'morning' else 'afternoon' end || ' hours.', null);
end;
$$;
revoke all on function public._referral_place(uuid, text, date, text, text, text) from public, anon, authenticated;

create or replace function public.referral_book_consultation(p_referral_id uuid, p_day date, p_half text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := public.current_scholar_id_number();
  f public.scholar_counseling_referrals%rowtype;
begin
  if v_id is null then raise exception 'Not signed in as a scholar.'; end if;
  select * into f from public.scholar_counseling_referrals where id = p_referral_id and scholar_id_number = v_id and status in ('awaiting_booking', 'booked') for update;
  if not found then raise exception 'That referral was not found.'; end if;
  if f.status = 'booked' or exists (select 1 from public.counseling_slots x where x.referral_id = f.id and x.state = 'booked') then
    raise exception 'You already have a consultation booked for this referral. Change it instead.';
  end if;
  perform public._referral_place(f.id, v_id, p_day, p_half, 'booked');
end;
$$;
revoke all on function public.referral_book_consultation(uuid, date, text) from public, anon;
grant execute on function public.referral_book_consultation(uuid, date, text) to authenticated;

create or replace function public.referral_reschedule_consultation(p_referral_id uuid, p_day date, p_half text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := public.current_scholar_id_number();
  f public.scholar_counseling_referrals%rowtype;
  v_old public.counseling_slots%rowtype;
begin
  if v_id is null then raise exception 'Not signed in as a scholar.'; end if;
  select * into f from public.scholar_counseling_referrals where id = p_referral_id and scholar_id_number = v_id and status = 'booked' for update;
  if not found then raise exception 'You do not have a consultation booked for this referral.'; end if;
  select * into v_old from public.counseling_slots where referral_id = f.id and state = 'booked' for update;
  if not found then raise exception 'You do not have a consultation booked for this referral.'; end if;
  if v_old.starts_at < now() + interval '12 hours' then
    raise exception 'You can only change a consultation up to 12 hours before it starts. Please contact the CEDO office.';
  end if;
  -- the old booking is released first so its minutes count as free; if the new one cannot be placed, everything is undone
  delete from public.counseling_slots where id = v_old.id;
  perform public._referral_place(f.id, v_id, p_day, p_half, 'rescheduled', public._manila_slot_text(v_old.starts_at));
end;
$$;
revoke all on function public.referral_reschedule_consultation(uuid, date, text) from public, anon;
grant execute on function public.referral_reschedule_consultation(uuid, date, text) to authenticated;

create or replace function public.referral_cancel_booking(p_referral_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := public.current_scholar_id_number();
  f public.scholar_counseling_referrals%rowtype;
  v_old public.counseling_slots%rowtype;
begin
  if v_id is null then raise exception 'Not signed in as a scholar.'; end if;
  select * into f from public.scholar_counseling_referrals where id = p_referral_id and scholar_id_number = v_id and status = 'booked' for update;
  if not found then raise exception 'You do not have a consultation booked for this referral.'; end if;
  select * into v_old from public.counseling_slots where referral_id = f.id and state = 'booked' for update;
  if not found then raise exception 'You do not have a consultation booked for this referral.'; end if;
  if v_old.starts_at < now() + interval '12 hours' then
    raise exception 'You can only cancel a consultation up to 12 hours before it starts. Please contact the CEDO office.';
  end if;
  delete from public.counseling_slots where id = v_old.id;
  update public.scholar_counseling_referrals set status = 'awaiting_booking', referred_to = null, updated_at = now() where id = f.id;
  perform public._booking_log(null, v_id, v_old.starts_at, v_old.staff_id, 'cancelled');
  perform public._notify_scholar(v_id, 'booking_cancelled', 'Your consultation was cancelled', 'You cancelled ' || public._manila_slot_text(v_old.starts_at) || '. Please choose a new day and morning or afternoon when you are ready.', null);
end;
$$;
revoke all on function public.referral_cancel_booking(uuid) from public, anon;
grant execute on function public.referral_cancel_booking(uuid) to authenticated;

-- ── 3. The counselor's side now also works for a booking that belongs to a referral ──
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
  f public.scholar_counseling_referrals%rowtype;
  v_scholar public.scholars%rowtype;
  v_ev jsonb;
  v_failed text;
  v_inc jsonb;
begin
  select * into s from public.counseling_slots where id = p_slot_id;
  select * into v_scholar from public.scholars where scholar_id_number = s.scholar_id_number;
  if s.record_id is null then
    -- a consultation that came from a referral: no renewal application, so no INC items or Summer papers
    select * into f from public.scholar_counseling_referrals where id = s.referral_id;
    select string_agg(coalesce(e ->> 'subjectCode', e ->> 'subject_code', e ->> 'code', ''), ', ') into v_failed from jsonb_array_elements(coalesce(f.failed_subjects, '[]'::jsonb)) e;
    return jsonb_build_object('slot_id', s.id, 'record_id', null, 'scholar_id_number', s.scholar_id_number,
      'scholar_name', btrim(v_scholar.last_name || ', ' || v_scholar.first_name), 'status', v_scholar.status, 'failed_subjects', coalesce(v_failed, ''),
      'inc_items', '[]'::jsonb, 'is_summer', false, 'term_label', 'Referral: ' || coalesce((select t.label from public.consultation_types t where t.key = s.consult_type), 'Consultation'),
      'date_visited', (s.starts_at at time zone 'Asia/Manila')::date);
  end if;
  select * into r from public.renewal_records where id = s.record_id;
  v_ev := public._renewal_evaluate(s.scholar_id_number, r.school_year, r.term);
  select string_agg(f2 ->> 'subject' || ' (' || coalesce(f2 ->> 'grade', '') || ')', ', ') into v_failed
  from jsonb_array_elements(coalesce(v_ev -> 'grades' -> 'failed_subjects', '[]'::jsonb) || coalesce(v_ev -> 'grades' -> 'inc_subjects', '[]'::jsonb)) f2;
  select coalesce(jsonb_agg(jsonb_build_object('item_id', i.id, 'subject', i.subject, 'deadline', i.deadline) order by i.subject), '[]'::jsonb) into v_inc
  from public.renewal_inc_items i where i.record_id = r.id and i.state = 'open';
  return jsonb_build_object('slot_id', s.id, 'record_id', r.id, 'scholar_id_number', s.scholar_id_number,
    'scholar_name', btrim(v_scholar.last_name || ', ' || v_scholar.first_name), 'status', v_scholar.status, 'failed_subjects', coalesce(v_failed, ''),
    'inc_items', v_inc, 'is_summer', r.term = 'Summer', 'term_label', r.term || ' ' || r.school_year,
    'date_visited', (s.starts_at at time zone 'Asia/Manila')::date);
end;
$$;
revoke all on function public._counseling_prefill(uuid) from public, anon, authenticated;

create or replace function public.counseling_mark_slot(p_slot_id uuid, p_outcome text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.counseling_slots%rowtype;
  r public.renewal_records%rowtype;
begin
  perform public._require_counseling_staff();
  if p_outcome not in ('attended', 'no_show') then raise exception 'Choose Attended or No-show.'; end if;
  select * into s from public.counseling_slots where id = p_slot_id and staff_id = auth.uid() for update;
  if not found then raise exception 'That appointment was not found.'; end if;
  if s.state <> 'booked' then raise exception 'This slot is not booked (it is %).', s.state; end if;
  if p_outcome = 'no_show' and s.starts_at > now() then raise exception 'A no-show can only be marked after the slot has started.'; end if;

  if s.record_id is null then
    -- a consultation that came from a referral
    update public.counseling_slots set state = p_outcome, marked_by = auth.uid(), marked_at = now() where id = s.id;
    perform public._booking_log(null, s.scholar_id_number, s.starts_at, s.staff_id, p_outcome);
    if p_outcome = 'no_show' then
      update public.scholar_counseling_referrals set status = 'awaiting_booking', referred_to = null, updated_at = now() where id = s.referral_id and status = 'booked';
      perform public._notify_scholar(s.scholar_id_number, 'no_show', 'You missed your consultation',
        'You did not come to your consultation on ' || public._manila_slot_text(s.starts_at) || '. Please choose a new day and morning or afternoon in your Consultation tile.', null);
      return jsonb_build_object('ok', true, 'outcome', 'no_show');
    end if;
    update public.scholar_counseling_referrals set status = 'pending', updated_at = now() where id = s.referral_id and status = 'booked';
    return public._counseling_prefill(s.id) || jsonb_build_object('ok', true, 'outcome', 'attended');
  end if;

  select * into r from public.renewal_records where id = s.record_id for update;
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
    if s.record_id is not null then
      select * into r from public.renewal_records where id = s.record_id for update;
      select exists (select 1 from public.renewal_inc_items i where i.record_id = r.id and i.state = 'open' and i.deadline is null) into v_needs_days;
      if v_needs_days and (p_days_given is null or p_days_given < 1) then
        raise exception 'Please enter the days given to comply for the INC subject(s).';
      end if;
    end if;
  end if;

  insert into public.scholar_counseling_records (scholar_id_number, status, consulted_by, date_visited, failed_subjects, findings, staff_recommendations, visit_type,
      slot_id, renewal_record_id, days_given, prospectus_hard_copy)
  values (p_scholar_id_number, p_status, auth.uid(), coalesce(p_date_visited, current_date), coalesce(p_failed_subjects, ''), coalesce(p_findings, ''),
      coalesce(p_staff_recommendations, ''), coalesce(nullif(btrim(p_visit_type), ''), 'Office'), p_slot_id, r.id, p_days_given, p_hard_copy)
  returning id into v_id;

  if p_slot_id is not null then
    update public.counseling_slots set daily_record_id = v_id where id = p_slot_id;
    if r.id is not null then
      for v_item in select i.id from public.renewal_inc_items i where i.record_id = r.id and i.state = 'open' and i.deadline is null loop
        perform public._renewal_apply_inc_deadline(v_item.id, coalesce(p_date_visited, current_date), p_days_given, '');
      end loop;
      if r.term = 'Summer' and coalesce(p_hard_copy, false) then
        update public.renewal_records set hard_copy_received_at = coalesce(hard_copy_received_at, now()), updated_at = now() where id = r.id;
        perform public._renewal_log(r.id, r.stage, r.stage, 'Prospectus hard copy received.');
      end if;
      perform public._renewal_recheck(r.id);
    end if;
  end if;
  return v_id;
end;
$$;
revoke all on function public.counseling_save_daily_record(uuid, text, text, date, text, text, text, text, integer, boolean) from public, anon;
grant execute on function public.counseling_save_daily_record(uuid, text, text, date, text, text, text, text, integer, boolean) to authenticated;

notify pgrst, 'reload schema';
