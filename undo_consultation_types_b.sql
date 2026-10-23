-- UNDO for supabase_migration_consultation_types_b_booking.sql: puts the old booking functions and calendars back exactly as they were (10-minute slots).
-- Run this BEFORE undo_consultation_types_a.sql. Bookings already made are kept (each one stays a booking at the start of its morning or afternoon).
-- The empty 10-minute slots that file B deleted are made again for the availability ranges that have not started yet (when file A's rule is back; see undo A).
-- The consultation types table is removed.

-- the versions with new columns go first
drop function if exists public.counseling_my_availability(timestamptz, timestamptz);
drop function if exists public.counseling_my_slots(timestamptz, timestamptz);
drop function if exists public.renewal_calendar_availability(timestamptz, timestamptz, uuid);
drop function if exists public.renewal_calendar_slots(timestamptz, timestamptz, uuid);
drop function if exists public.consultation_my_appointments();

-- _manila_slot_text
create or replace function public._manila_slot_text(p_at timestamptz)
returns text
language sql
stable
as $$ select to_char(p_at at time zone 'Asia/Manila', 'FMDy, FMMon FMDD "at" FMHH12:MI AM'); $$;
revoke all on function public._manila_slot_text(timestamptz) from public, anon, authenticated;

-- counseling_availability_save
create or replace function public.counseling_availability_save(p_id uuid, p_starts timestamptz, p_ends timestamptz, p_confirm boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.counseling_availability%rowtype;
  v_id uuid;
  v_affected jsonb;
  s record;
begin
  perform public._require_counseling_staff();
  if p_starts is null or p_ends is null then raise exception 'Please choose the start and end time.'; end if;
  if p_ends <= p_starts then raise exception 'The end time must be after the start time.'; end if;
  if mod(extract(epoch from (p_ends - p_starts))::bigint, 600) <> 0 then raise exception 'The range must be a whole number of 10-minute slots (for example 9:00 to 11:00).'; end if;
  if p_ends - p_starts > interval '12 hours' then raise exception 'A single range can be at most 12 hours.'; end if;
  if p_starts < now() then raise exception 'Availability must start in the future.'; end if;
  if exists (select 1 from public.counseling_availability a where a.staff_id = auth.uid() and a.id is distinct from p_id and a.starts_at < p_ends and a.ends_at > p_starts) then
    raise exception 'This overlaps another range of yours. Edit that one instead.';
  end if;

  if p_id is null then
    insert into public.counseling_availability (staff_id, starts_at, ends_at) values (auth.uid(), p_starts, p_ends) returning id into v_id;
    perform public._counseling_generate_slots(v_id);
    return jsonb_build_object('ok', true, 'id', v_id);
  end if;

  select * into v_old from public.counseling_availability where id = p_id and staff_id = auth.uid() for update;
  if not found then raise exception 'That availability range was not found.'; end if;
  if v_old.starts_at <= now() then raise exception 'This range has already started, so it can no longer be changed.'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('slot_id', x.id, 'starts_at', x.starts_at, 'scholar_id_number', x.scholar_id_number,
           'name', (select btrim(sc.first_name || ' ' || sc.last_name) from public.scholars sc where sc.scholar_id_number = x.scholar_id_number)) order by x.starts_at), '[]'::jsonb)
    into v_affected
  from public.counseling_slots x
  where x.availability_id = p_id and x.state = 'booked' and (x.starts_at < p_starts or x.ends_at > p_ends);
  if jsonb_array_length(v_affected) > 0 and not p_confirm then
    return jsonb_build_object('ok', false, 'needs_confirm', true, 'booked', v_affected);
  end if;

  for s in select x.id from public.counseling_slots x where x.availability_id = p_id and (x.starts_at < p_starts or x.ends_at > p_ends) loop
    perform public._counseling_remove_slot(s.id, 'The availability range was changed.');
  end loop;
  update public.counseling_availability set starts_at = p_starts, ends_at = p_ends, updated_at = now() where id = p_id;
  perform public._counseling_generate_slots(p_id);
  return jsonb_build_object('ok', true, 'id', p_id, 'notified', jsonb_array_length(v_affected));
end;
$$;
revoke all on function public.counseling_availability_save(uuid, timestamptz, timestamptz, boolean) from public, anon;
grant execute on function public.counseling_availability_save(uuid, timestamptz, timestamptz, boolean) to authenticated;

-- counseling_availability_delete
create or replace function public.counseling_availability_delete(p_id uuid, p_confirm boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.counseling_availability%rowtype;
  v_affected jsonb;
  s record;
begin
  perform public._require_counseling_staff();
  select * into v_old from public.counseling_availability where id = p_id and staff_id = auth.uid() for update;
  if not found then raise exception 'That availability range was not found.'; end if;
  if v_old.starts_at <= now() then raise exception 'This range has already started, so it can no longer be removed.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('slot_id', x.id, 'starts_at', x.starts_at, 'scholar_id_number', x.scholar_id_number,
           'name', (select btrim(sc.first_name || ' ' || sc.last_name) from public.scholars sc where sc.scholar_id_number = x.scholar_id_number)) order by x.starts_at), '[]'::jsonb)
    into v_affected
  from public.counseling_slots x where x.availability_id = p_id and x.state = 'booked';
  if jsonb_array_length(v_affected) > 0 and not p_confirm then
    return jsonb_build_object('ok', false, 'needs_confirm', true, 'booked', v_affected);
  end if;
  for s in select x.id from public.counseling_slots x where x.availability_id = p_id loop
    perform public._counseling_remove_slot(s.id, 'The availability range was removed.');
  end loop;
  delete from public.counseling_availability where id = p_id;
  return jsonb_build_object('ok', true, 'notified', jsonb_array_length(v_affected));
end;
$$;
revoke all on function public.counseling_availability_delete(uuid, boolean) from public, anon;
grant execute on function public.counseling_availability_delete(uuid, boolean) to authenticated;

-- counseling_my_availability
create or replace function public.counseling_my_availability(p_from timestamptz, p_to timestamptz)
returns table(id uuid, starts_at timestamptz, ends_at timestamptz, slot_count integer, booked_count integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_counseling_staff();
  return query
  select a.id, a.starts_at, a.ends_at,
         (select count(*)::integer from public.counseling_slots x where x.availability_id = a.id),
         (select count(*)::integer from public.counseling_slots x where x.availability_id = a.id and x.state <> 'open')
  from public.counseling_availability a
  where a.staff_id = auth.uid() and a.ends_at > p_from and a.starts_at < p_to
  order by a.starts_at;
end;
$$;
revoke all on function public.counseling_my_availability(timestamptz, timestamptz) from public, anon;
grant execute on function public.counseling_my_availability(timestamptz, timestamptz) to authenticated;

-- counseling_my_slots
create or replace function public.counseling_my_slots(p_from timestamptz, p_to timestamptz)
returns table(
  slot_id uuid, availability_id uuid, starts_at timestamptz, ends_at timestamptz, state text, scholar_id_number text, scholar_name text,
  record_id uuid, term_label text, stage text, case_summary text, no_show_count integer, is_summer boolean, hard_copy boolean, daily_record_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_counseling_staff();
  return query
  select x.id, x.availability_id, x.starts_at, x.ends_at, x.state, x.scholar_id_number,
         (select btrim(sc.last_name || ', ' || sc.first_name) from public.scholars sc where sc.scholar_id_number = x.scholar_id_number),
         x.record_id, case when r.id is null then null else r.term || ' ' || r.school_year end, r.stage,
         case when r.id is null then null else nullif(concat_ws(' · ',
           case when coalesce((r.evaluation -> 'grades' -> 'counts' ->> 'failed')::integer, 0) > 0 then (r.evaluation -> 'grades' -> 'counts' ->> 'failed') || ' failed' end,
           case when coalesce((r.evaluation -> 'grades' -> 'counts' ->> 'inc')::integer, 0) > 0 then (r.evaluation -> 'grades' -> 'counts' ->> 'inc') || ' INC' end,
           case when r.term = 'Summer' then 'Summer renewal' end), '') end,
         coalesce(r.no_show_count, 0), coalesce(r.term = 'Summer', false), r.hard_copy_received_at is not null, x.daily_record_id
  from public.counseling_slots x
  left join public.renewal_records r on r.id = x.record_id
  where x.staff_id = auth.uid() and x.starts_at >= p_from and x.starts_at < p_to
  order by x.starts_at;
end;
$$;
revoke all on function public.counseling_my_slots(timestamptz, timestamptz) from public, anon;
grant execute on function public.counseling_my_slots(timestamptz, timestamptz) to authenticated;

-- renewal_calendar_availability
create or replace function public.renewal_calendar_availability(p_from timestamptz, p_to timestamptz, p_staff uuid default null)
returns table(id uuid, staff_id uuid, staff_name text, starts_at timestamptz, ends_at timestamptz, slot_count integer, booked_count integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_renewal_evaluator() then raise exception 'Only the Scholar Renewal Evaluator can see the consultation calendars.'; end if;
  return query
  select a.id, a.staff_id, public._staff_display_name(a.staff_id), a.starts_at, a.ends_at,
         (select count(*)::integer from public.counseling_slots x where x.availability_id = a.id),
         (select count(*)::integer from public.counseling_slots x where x.availability_id = a.id and x.state <> 'open')
  from public.counseling_availability a
  where a.ends_at > p_from and a.starts_at < p_to and (p_staff is null or a.staff_id = p_staff)
  order by a.starts_at, a.staff_id;
end;
$$;
revoke all on function public.renewal_calendar_availability(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.renewal_calendar_availability(timestamptz, timestamptz, uuid) to authenticated;

-- renewal_calendar_slots
create or replace function public.renewal_calendar_slots(p_from timestamptz, p_to timestamptz, p_staff uuid default null)
returns table(
  slot_id uuid, availability_id uuid, staff_id uuid, staff_name text, starts_at timestamptz, ends_at timestamptz, state text, scholar_id_number text, scholar_name text,
  record_id uuid, term_label text, stage text, case_summary text, no_show_count integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_renewal_evaluator() then raise exception 'Only the Scholar Renewal Evaluator can see the consultation calendars.'; end if;
  return query
  select x.id, x.availability_id, x.staff_id, public._staff_display_name(x.staff_id), x.starts_at, x.ends_at, x.state, x.scholar_id_number,
         (select btrim(sc.last_name || ', ' || sc.first_name) from public.scholars sc where sc.scholar_id_number = x.scholar_id_number),
         x.record_id, case when r.id is null then null else r.term || ' ' || r.school_year end, r.stage,
         case when r.id is null then null else nullif(concat_ws(' · ',
           case when coalesce((r.evaluation -> 'grades' -> 'counts' ->> 'failed')::integer, 0) > 0 then (r.evaluation -> 'grades' -> 'counts' ->> 'failed') || ' failed' end,
           case when coalesce((r.evaluation -> 'grades' -> 'counts' ->> 'inc')::integer, 0) > 0 then (r.evaluation -> 'grades' -> 'counts' ->> 'inc') || ' INC' end,
           case when r.term = 'Summer' then 'Summer renewal' end), '') end,
         coalesce(r.no_show_count, 0)
  from public.counseling_slots x
  left join public.renewal_records r on r.id = x.record_id
  where x.starts_at >= p_from and x.starts_at < p_to and (p_staff is null or x.staff_id = p_staff)
  order by x.starts_at, x.staff_id;
end;
$$;
revoke all on function public.renewal_calendar_slots(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.renewal_calendar_slots(timestamptz, timestamptz, uuid) to authenticated;

-- renewal_cancel_booking
create or replace function public.renewal_cancel_booking(p_record_id uuid)
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
    raise exception 'You can only cancel a consultation up to 12 hours before it starts. Please contact the CEDO office.';
  end if;
  update public.counseling_slots set state = 'open', record_id = null, scholar_id_number = null, booked_at = null, reminded_day_at = null, reminded_hour_at = null where id = v_old.id;
  perform public._booking_log(r.id, v_id, v_old.starts_at, v_old.staff_id, 'cancelled');
  perform public._renewal_log(r.id, r.stage, r.stage, 'Cancelled the consultation on ' || public._manila_slot_text(v_old.starts_at) || '.', 'Scholar');
  perform public._notify_scholar(v_id, 'booking_cancelled', 'Your consultation was cancelled', 'You cancelled ' || public._manila_slot_text(v_old.starts_at) || '. Please book a new time when you are ready.', r.id);
end;
$$;
revoke all on function public.renewal_cancel_booking(uuid) from public, anon;
grant execute on function public.renewal_cancel_booking(uuid) to authenticated;

-- renewal_scheduled_jobs
create or replace function public.renewal_scheduled_jobs()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  v_day integer := 0;
  v_hour integer := 0;
begin
  for s in
    select x.id, x.scholar_id_number, x.record_id, x.starts_at from public.counseling_slots x
    where x.state = 'booked' and x.starts_at > now() and x.starts_at <= now() + interval '24 hours' and x.reminded_day_at is null
  loop
    update public.counseling_slots set reminded_day_at = now() where id = s.id;
    perform public._notify_scholar(s.scholar_id_number, 'reminder_day', 'Your consultation is tomorrow', 'Reminder: ' || public._manila_slot_text(s.starts_at) || ' at the CEDO office.', s.record_id);
    v_day := v_day + 1;
  end loop;
  for s in
    select x.id, x.scholar_id_number, x.record_id, x.starts_at from public.counseling_slots x
    where x.state = 'booked' and x.starts_at > now() and x.starts_at <= now() + interval '1 hour' and x.reminded_hour_at is null
  loop
    update public.counseling_slots set reminded_hour_at = now() where id = s.id;
    perform public._notify_scholar(s.scholar_id_number, 'reminder_hour', 'Your consultation is in about an hour', 'Reminder: ' || public._manila_slot_text(s.starts_at) || ' at the CEDO office.', s.record_id);
    v_hour := v_hour + 1;
  end loop;
  perform public._renewal_sweep();
  return jsonb_build_object('day_reminders', v_day, 'hour_reminders', v_hour);
end;
$$;
revoke all on function public.renewal_scheduled_jobs() from public, anon, authenticated;

-- consultation_my_appointments
create or replace function public.consultation_my_appointments()
returns table(slot_id uuid, starts_at timestamptz, ends_at timestamptz, staff_name text, state text, record_id uuid, term_label text, can_change boolean)
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
  select x.id, x.starts_at, x.ends_at, public._staff_display_name(x.staff_id), x.state, x.record_id,
         case when r.id is null then null else r.term || ' ' || r.school_year end,
         (x.state = 'booked' and x.starts_at >= now() + interval '12 hours')
  from public.counseling_slots x
  left join public.renewal_records r on r.id = x.record_id
  where x.scholar_id_number = v_id and x.state <> 'open'
  order by (x.state = 'booked' and x.starts_at >= now()) desc,
           case when x.state = 'booked' and x.starts_at >= now() then x.starts_at end asc,
           x.starts_at desc
  limit 50;
end;
$$;
revoke all on function public.consultation_my_appointments() from public, anon;
grant execute on function public.consultation_my_appointments() to authenticated;

-- renewal_my_overview
create or replace function public.renewal_my_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id text := public.current_scholar_id_number();
  v_scholar public.scholars%rowtype;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_out jsonb := '[]'::jsonb;
  w record;
  v_rec public.renewal_records%rowtype;
  v_state text;
  v_slot public.counseling_slots%rowtype;
  v_booking jsonb;
begin
  if v_id is null then raise exception 'Not signed in as a scholar.'; end if;
  select * into v_scholar from public.scholars where scholar_id_number = v_id;
  for w in
    select * from public.renewal_windows
    where (opens_on <= v_today + 14 or exists (select 1 from public.renewal_records r where r.window_id = renewal_windows.id and r.scholar_id_number = v_id))
      and (renewal_windows.testers is null or v_id = any (renewal_windows.testers))
    order by opens_on desc limit 6
  loop
    select * into v_rec from public.renewal_records r where r.scholar_id_number = v_id and r.school_year = w.school_year and r.term = w.term;
    v_state := case when v_today < w.opens_on then 'upcoming' when v_today <= w.closes_on then 'open'
                    when w.late_allowed then 'late' else 'closed' end;
    v_booking := null;
    if v_rec.id is not null then
      select * into v_slot from public.counseling_slots x where x.record_id = v_rec.id and x.state = 'booked';
      if found then
        v_booking := jsonb_build_object('slot_id', v_slot.id, 'starts_at', v_slot.starts_at, 'ends_at', v_slot.ends_at, 'staff_name', public._staff_display_name(v_slot.staff_id),
          'can_change', v_slot.starts_at >= now() + interval '12 hours');
      end if;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'window', to_jsonb(w), 'state', v_state,
      'record', case when v_rec.id is null then null else to_jsonb(v_rec) end,
      'documents', coalesce((select jsonb_agg(to_jsonb(d) order by d.uploaded_at) from public.renewal_documents d where d.record_id = v_rec.id), '[]'::jsonb),
      'history', coalesce((select jsonb_agg(jsonb_build_object('at', h.at, 'to_stage', h.to_stage, 'actor', h.actor_label, 'note', h.note) order by h.at) from public.renewal_history h where h.record_id = v_rec.id), '[]'::jsonb),
      'inc_items', coalesce((select jsonb_agg(to_jsonb(i) order by i.subject) from public.renewal_inc_items i where i.record_id = v_rec.id), '[]'::jsonb),
      'booking', v_booking,
      'consult_needed', v_rec.id is not null and public._renewal_consult_eligible(v_rec.id),
      'consult_state', case when v_rec.id is null then null else public._renewal_consult_state(v_rec.id) end));
  end loop;
  return jsonb_build_object(
    'scholar', jsonb_build_object('scholar_id_number', v_scholar.scholar_id_number, 'school', v_scholar.school, 'program', v_scholar.course, 'year_level', v_scholar.year_level, 'status', v_scholar.status),
    'windows', v_out);
end;
$$;
revoke all on function public.renewal_my_overview() from public, anon;
grant execute on function public.renewal_my_overview() to authenticated;

drop function if exists public.renewal_consult_types(uuid);
drop function if exists public.renewal_open_blocks(uuid, text);
drop function if exists public.renewal_book_consultation(uuid, text, date, text);
drop function if exists public.renewal_reschedule_consultation(uuid, text, date, text);
drop function if exists public._consult_place(uuid, text, text, date, text, text, text);
drop function if exists public._consult_affected(uuid, uuid, timestamptz, timestamptz, timestamptz, timestamptz);
drop function if exists public._consult_blocks(timestamptz, timestamptz);
drop function if exists public._consult_half(timestamptz);
drop table if exists public.consultation_types;

-- the empty 10-minute slots of the availability that has not started yet (needs the one-start-per-staff rule of file A's undo to be back; otherwise skipped)
do $$
declare a record;
begin
  if exists (select 1 from pg_constraint where conname = 'counseling_slots_staff_id_starts_at_key') then
    for a in select id from public.counseling_availability where starts_at > now() loop perform public._counseling_generate_slots(a.id); end loop;
  else
    raise notice 'The 10-minute slots were not made again: run undo_consultation_types_a.sql, then run this file once more.';
  end if;
end $$;

notify pgrst, 'reload schema';
