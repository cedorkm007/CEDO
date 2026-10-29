-- UNDO for supabase_migration_consultation_open_and_choose_staff.sql: a consultation can no longer be booked without a renewal or a referral, and the staff member is no longer chosen by the scholar.
-- Bookings already made stay (nobody is cancelled): a consultation a scholar booked on their own keeps its place on the counselor's calendar and can still be marked Attended or No-show.
-- Replaces the functions with their earlier forms and removes the new ones; nothing is deleted.

drop function if exists public.consult_self_book(text, date, text, uuid);
drop function if exists public.consult_self_reschedule(text, date, text, uuid);
drop function if exists public.consult_self_cancel();
drop function if exists public._consult_self_place(text, text, date, text, text, text, uuid);
drop function if exists public.consult_my_self();
drop function if exists public.consult_self_open_blocks(text);
drop function if exists public.consult_self_types();
drop function if exists public.consult_block_staff(text, date, text);

drop function if exists public.renewal_book_consultation(uuid, text, date, text, uuid);
drop function if exists public.renewal_reschedule_consultation(uuid, text, date, text, uuid);
drop function if exists public._consult_place(uuid, text, text, date, text, text, text, uuid);
drop function if exists public.referral_book_consultation(uuid, date, text, uuid);
drop function if exists public.referral_reschedule_consultation(uuid, date, text, uuid);
drop function if exists public._referral_place(uuid, text, date, text, text, text, uuid);

create or replace function public._consult_place(p_record_id uuid, p_scholar text, p_type text, p_day date, p_half text, p_action text, p_from_text text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.renewal_records%rowtype;
  v_type public.consultation_types%rowtype;
  v_staff uuid;
  v_start timestamptz;
begin
  select * into r from public.renewal_records where id = p_record_id;
  select * into v_type from public.consultation_types where key = p_type and active;
  if not found then raise exception 'Please choose the type of consultation.'; end if;
  if p_half not in ('AM', 'PM') then raise exception 'Please choose morning (AM) or afternoon (PM).'; end if;
  if p_day is null then raise exception 'Please choose a day.'; end if;

  perform pg_advisory_xact_lock(731001);
  select b.staff_id, b.window_start into v_staff, v_start
  from public._consult_blocks(p_day::timestamp at time zone 'Asia/Manila' - interval '1 day', p_day::timestamp at time zone 'Asia/Manila' + interval '2 days') b
  where b.day = p_day and b.half = p_half and b.capacity - b.booked >= v_type.minutes and b.window_start >= now() + interval '12 hours'
  order by (b.capacity - b.booked) desc, b.staff_id
  limit 1;
  if v_staff is null then raise exception 'That time was just filled. Please choose another.'; end if;

  insert into public.counseling_slots (staff_id, starts_at, ends_at, state, record_id, scholar_id_number, booked_at, consult_type, minutes, reminded_day_at)
  values (v_staff, v_start, v_start + make_interval(mins => v_type.minutes), 'booked', r.id, p_scholar, now(), v_type.key, v_type.minutes,
          case when v_start - now() < interval '24 hours' then now() end);

  perform public._booking_log(r.id, p_scholar, v_start, v_staff, p_action, case when p_from_text is null then v_type.label else 'From ' || p_from_text || ' · ' || v_type.label end);
  perform public._renewal_log(r.id, r.stage, r.stage,
    case p_action when 'rescheduled' then 'Changed the consultation (' || v_type.label || ') from ' || p_from_text || ' to ' else 'Booked a consultation (' || v_type.label || ') for ' end
      || public._manila_slot_text(v_start) || ' with ' || public._staff_display_name(v_staff) || '.', 'Scholar');
  perform public._notify_scholar(p_scholar, 'booking_confirmed', case p_action when 'rescheduled' then 'Your consultation was rescheduled' else 'Your consultation is booked' end,
    public._manila_slot_text(v_start) || ' with ' || public._staff_display_name(v_staff) || ', at the CEDO office (' || v_type.label || '). Please come during the '
      || case p_half when 'AM' then 'morning' else 'afternoon' end || ' hours.'
      || case when r.term = 'Summer' then ' Please bring the hard copy of your prospectus.' else '' end, r.id);
end;
$$;
revoke all on function public._consult_place(uuid, text, text, date, text, text, text) from public, anon, authenticated;

create or replace function public.renewal_book_consultation(p_record_id uuid, p_type text, p_day date, p_half text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := public.current_scholar_id_number();
  r public.renewal_records%rowtype;
begin
  if v_id is null then raise exception 'Not signed in as a scholar.'; end if;
  select * into r from public.renewal_records where id = p_record_id and scholar_id_number = v_id for update;
  if not found then raise exception 'That application was not found.'; end if;
  if exists (select 1 from public.counseling_slots x where x.record_id = r.id and x.state = 'booked') then
    raise exception 'You already have a consultation booked. Change it instead.';
  end if;
  perform public._renewal_require_can_book(r.id);
  perform public._consult_place(r.id, v_id, p_type, p_day, p_half, 'booked');
end;
$$;
revoke all on function public.renewal_book_consultation(uuid, text, date, text) from public, anon;
grant execute on function public.renewal_book_consultation(uuid, text, date, text) to authenticated;

create or replace function public.renewal_reschedule_consultation(p_record_id uuid, p_type text, p_day date, p_half text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := public.current_scholar_id_number();
  r public.renewal_records%rowtype;
  v_old public.counseling_slots%rowtype;
begin
  if v_id is null then raise exception 'Not signed in as a scholar.'; end if;
  select * into r from public.renewal_records where id = p_record_id and scholar_id_number = v_id for update;
  if not found then raise exception 'That application was not found.'; end if;
  select * into v_old from public.counseling_slots where record_id = r.id and state = 'booked' for update;
  if not found then raise exception 'You do not have a consultation booked.'; end if;
  if v_old.starts_at < now() + interval '12 hours' then
    raise exception 'You can only change a consultation up to 12 hours before it starts. Please contact the CEDO office.';
  end if;
  -- The old booking is released first, so its minutes count as free when the new one is placed; if the new one cannot be placed, everything is undone.
  delete from public.counseling_slots where id = v_old.id;
  perform public._consult_place(r.id, v_id, p_type, p_day, p_half, 'rescheduled', public._manila_slot_text(v_old.starts_at));
end;
$$;
revoke all on function public.renewal_reschedule_consultation(uuid, text, date, text) from public, anon;
grant execute on function public.renewal_reschedule_consultation(uuid, text, date, text) to authenticated;

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

notify pgrst, 'reload schema';
