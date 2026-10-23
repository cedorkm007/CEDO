-- ─────────────────────────────────────────────────────────────
-- CONSULTATION TYPES AND AM / PM BOOKING, FILE B of 2: the types, the booking rules and the calendars.   Safe to run twice.   Undo: undo_consultation_types_b.sql
-- Run AFTER supabase_migration_consultation_types_a_slots_columns.sql.
--
-- WHAT CHANGES
--   • Consultation TYPES, each with its own minutes:  INC 8 · IP 5 · GWA (below the minimum) 5 · 1 Failed 10 · 2 or more Failed 15 · Personal concern 25 · Ethical concern 20.
--     They live in the table consultation_types, so a number of minutes can be changed later with one line of SQL.
--   • A scholar no longer picks a 10-minute time. The scholar picks the TYPE, a day, and MORNING (AM) or AFTERNOON (PM). Staff still set the time ranges they are
--     available. Each morning or afternoon holds as many consultations as the staff member's available MINUTES allow: a booking uses up the minutes of its type.
--     (Example: a staff member available 9:00 to 11:00 has 120 minutes in the morning: that is 15 INC consultations, or 8 of 15 minutes, or 4 Personal concerns...)
--   • The staff member is chosen by the system: the one with the most minutes left in that morning or afternoon. The scholar is told who after booking.
--   • The old pre-made 10-minute slots are no longer used: this file removes the EMPTY ones (no scholar on them). Existing bookings stay and still work.
--   • Staff availability keeps its 10-minute steps (9:00 to 11:00), but no slots are made from it any more. If a change would leave too few minutes for the
--     bookings already made, the staff member is asked first, and the latest bookings are cancelled and the scholars are told (same warning as before).
--   • Messages and screens now say "Mon, Oct 20, morning (AM)" instead of an exact time.
-- Creates one table and replaces functions only. Nothing is altered; no booking is deleted.
-- ─────────────────────────────────────────────────────────────

-- ── 1. The types ────────────────────────────────────────────
create table if not exists public.consultation_types (
  key     text primary key,
  label   text not null,
  minutes integer not null check (minutes > 0),
  sort    integer not null default 0,
  active  boolean not null default true
);
insert into public.consultation_types (key, label, minutes, sort) values
  ('inc', 'INC (incomplete)', 8, 1),
  ('ip', 'IP (in progress)', 5, 2),
  ('gwa', 'GWA (did not reach the minimum threshold)', 5, 3),
  ('one_failed', '1 Failed', 10, 4),
  ('two_plus_failed', '2 or more Failed', 15, 5),
  ('personal', 'Personal concern', 25, 6),
  ('ethical', 'Ethical concern (e.g., bullying)', 20, 7)
on conflict (key) do nothing;
alter table public.consultation_types enable row level security;
drop policy if exists "signed-in users read consultation types" on public.consultation_types;
create policy "signed-in users read consultation types" on public.consultation_types for select to authenticated using (true);

-- ── 2. Small helpers ────────────────────────────────────────
-- "AM" before 12:00 noon Philippine time, "PM" from noon.
create or replace function public._consult_half(p_at timestamptz)
returns text
language sql
stable
as $$ select case when extract(hour from p_at at time zone 'Asia/Manila') < 12 then 'AM' else 'PM' end; $$;
revoke all on function public._consult_half(timestamptz) from public, anon, authenticated;

-- "Mon, Oct 20, morning (AM)" for messages. (Replaces the version that showed an exact time.)
create or replace function public._manila_slot_text(p_at timestamptz)
returns text
language sql
stable
as $$
  select to_char(p_at at time zone 'Asia/Manila', 'FMDy, FMMon FMDD') || ', ' || case public._consult_half(p_at) when 'AM' then 'morning (AM)' else 'afternoon (PM)' end;
$$;
revoke all on function public._manila_slot_text(timestamptz) from public, anon, authenticated;

-- Every morning / afternoon in which someone is available: how many minutes there are, how many are already used, and when the window starts.
-- Minutes used = the bookings of that staff member in that half day (a booking with no type counts as the old 10 minutes).
create or replace function public._consult_blocks(p_from timestamptz, p_to timestamptz)
returns table(staff_id uuid, day date, half text, capacity integer, booked integer, window_start timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with halves as (
    select a.staff_id, d::date as day, h.half, a.starts_at, a.ends_at,
           ((d::date)::timestamp + h.s) at time zone 'Asia/Manila' as ws,
           ((d::date)::timestamp + h.e) at time zone 'Asia/Manila' as we
    from public.counseling_availability a
    cross join lateral generate_series((a.starts_at at time zone 'Asia/Manila')::date, (a.ends_at at time zone 'Asia/Manila')::date, interval '1 day') d
    cross join (values ('AM', interval '0 hours', interval '12 hours'), ('PM', interval '12 hours', interval '24 hours')) h(half, s, e)
    where a.ends_at > p_from and a.starts_at < p_to
  ), cap as (
    select hv.staff_id, hv.day, hv.half,
           sum(greatest(0, extract(epoch from (least(hv.ends_at, hv.we) - greatest(hv.starts_at, hv.ws))) / 60))::integer as capacity,
           min(greatest(hv.starts_at, hv.ws)) as window_start
    from halves hv where hv.starts_at < hv.we and hv.ends_at > hv.ws
    group by hv.staff_id, hv.day, hv.half
  )
  select c.staff_id, c.day, c.half, c.capacity,
         coalesce((select sum(coalesce(x.minutes, 10)) from public.counseling_slots x
                   where x.staff_id = c.staff_id and x.state in ('booked', 'attended', 'no_show')
                     and (x.starts_at at time zone 'Asia/Manila')::date = c.day and public._consult_half(x.starts_at) = c.half), 0)::integer,
         c.window_start
  from cap c
  where c.capacity > 0;
$$;
revoke all on function public._consult_blocks(timestamptz, timestamptz) from public, anon, authenticated;

-- The bookings that would no longer fit if one availability range of a staff member changed (new times) or was removed (new times null).
-- Bookings already attended or missed are never touched; of the others, the EARLIEST bookings are kept and the LATEST ones are listed.
create or replace function public._consult_affected(p_staff uuid, p_exclude uuid, p_new_starts timestamptz, p_new_ends timestamptz, p_old_starts timestamptz, p_old_ends timestamptz)
returns table(slot_id uuid, starts_at timestamptz, scholar_id_number text, name text)
language sql
stable
security definer
set search_path = public
as $$
  with days as (
    select distinct d::date as day
    from generate_series(
      (least(coalesce(p_old_starts, p_new_starts), coalesce(p_new_starts, p_old_starts)) at time zone 'Asia/Manila')::date,
      (greatest(coalesce(p_old_ends, p_new_ends), coalesce(p_new_ends, p_old_ends)) at time zone 'Asia/Manila')::date, interval '1 day') d
  ), blocks as (
    select dy.day, h.half, ((dy.day)::timestamp + h.s) at time zone 'Asia/Manila' as ws, ((dy.day)::timestamp + h.e) at time zone 'Asia/Manila' as we
    from days dy cross join (values ('AM', interval '0 hours', interval '12 hours'), ('PM', interval '12 hours', interval '24 hours')) h(half, s, e)
  ), cap as (
    select b.day, b.half,
           (coalesce((select sum(greatest(0, extract(epoch from (least(a.ends_at, b.we) - greatest(a.starts_at, b.ws))) / 60))
                      from public.counseling_availability a
                      where a.staff_id = p_staff and a.id is distinct from p_exclude and a.starts_at < b.we and a.ends_at > b.ws), 0)
            + case when p_new_starts is not null and p_new_starts < b.we and p_new_ends > b.ws
                   then greatest(0, extract(epoch from (least(p_new_ends, b.we) - greatest(p_new_starts, b.ws))) / 60) else 0 end)::integer as capacity
    from blocks b
  ), rows as (
    select x.id, x.starts_at, x.scholar_id_number, x.state, c.capacity,
           sum(coalesce(x.minutes, 10)) over (partition by c.day, c.half order by (x.state = 'booked'), x.booked_at nulls first, x.id) as cum
    from cap c
    join public.counseling_slots x on x.staff_id = p_staff and x.state in ('booked', 'attended', 'no_show')
         and (x.starts_at at time zone 'Asia/Manila')::date = c.day and public._consult_half(x.starts_at) = c.half
  )
  select r.id, r.starts_at, r.scholar_id_number,
         (select btrim(sc.first_name || ' ' || sc.last_name) from public.scholars sc where sc.scholar_id_number = r.scholar_id_number)
  from rows r
  where r.state = 'booked' and r.cum > r.capacity
  order by r.starts_at;
$$;
revoke all on function public._consult_affected(uuid, uuid, timestamptz, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;

-- ── 3. Staff: availability (no more pre-made slots) ─────────
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
  if mod(extract(epoch from (p_ends - p_starts))::bigint, 600) <> 0 then raise exception 'The range must be a whole number of 10-minute steps (for example 9:00 to 11:00).'; end if;
  if p_ends - p_starts > interval '12 hours' then raise exception 'A single range can be at most 12 hours.'; end if;
  if p_starts < now() then raise exception 'Availability must start in the future.'; end if;
  if exists (select 1 from public.counseling_availability a where a.staff_id = auth.uid() and a.id is distinct from p_id and a.starts_at < p_ends and a.ends_at > p_starts) then
    raise exception 'This overlaps another range of yours. Edit that one instead.';
  end if;

  if p_id is null then
    insert into public.counseling_availability (staff_id, starts_at, ends_at) values (auth.uid(), p_starts, p_ends) returning id into v_id;
    return jsonb_build_object('ok', true, 'id', v_id);
  end if;

  select * into v_old from public.counseling_availability where id = p_id and staff_id = auth.uid() for update;
  if not found then raise exception 'That availability range was not found.'; end if;
  if v_old.starts_at <= now() then raise exception 'This range has already started, so it can no longer be changed.'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('slot_id', f.slot_id, 'starts_at', f.starts_at, 'scholar_id_number', f.scholar_id_number, 'name', f.name) order by f.starts_at), '[]'::jsonb)
    into v_affected
  from public._consult_affected(auth.uid(), p_id, p_starts, p_ends, v_old.starts_at, v_old.ends_at) f;
  if jsonb_array_length(v_affected) > 0 and not p_confirm then
    return jsonb_build_object('ok', false, 'needs_confirm', true, 'booked', v_affected);
  end if;

  for s in select f.slot_id from public._consult_affected(auth.uid(), p_id, p_starts, p_ends, v_old.starts_at, v_old.ends_at) f loop
    perform public._counseling_remove_slot(s.slot_id, 'The availability range was changed.');
  end loop;
  update public.counseling_availability set starts_at = p_starts, ends_at = p_ends, updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id, 'notified', jsonb_array_length(v_affected));
end;
$$;
revoke all on function public.counseling_availability_save(uuid, timestamptz, timestamptz, boolean) from public, anon;
grant execute on function public.counseling_availability_save(uuid, timestamptz, timestamptz, boolean) to authenticated;

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
  select coalesce(jsonb_agg(jsonb_build_object('slot_id', f.slot_id, 'starts_at', f.starts_at, 'scholar_id_number', f.scholar_id_number, 'name', f.name) order by f.starts_at), '[]'::jsonb)
    into v_affected
  from public._consult_affected(auth.uid(), p_id, null, null, v_old.starts_at, v_old.ends_at) f;
  if jsonb_array_length(v_affected) > 0 and not p_confirm then
    return jsonb_build_object('ok', false, 'needs_confirm', true, 'booked', v_affected);
  end if;
  for s in select f.slot_id from public._consult_affected(auth.uid(), p_id, null, null, v_old.starts_at, v_old.ends_at) f loop
    perform public._counseling_remove_slot(s.slot_id, 'The availability range was removed.');
  end loop;
  delete from public.counseling_availability where id = p_id;
  return jsonb_build_object('ok', true, 'notified', jsonb_array_length(v_affected));
end;
$$;
revoke all on function public.counseling_availability_delete(uuid, boolean) from public, anon;
grant execute on function public.counseling_availability_delete(uuid, boolean) to authenticated;

-- ── 4. Staff and evaluator calendars ────────────────────────
drop function if exists public.counseling_my_availability(timestamptz, timestamptz);
create or replace function public.counseling_my_availability(p_from timestamptz, p_to timestamptz)
returns table(id uuid, starts_at timestamptz, ends_at timestamptz, minutes integer, booked_minutes integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_counseling_staff();
  return query
  select a.id, a.starts_at, a.ends_at, (extract(epoch from (a.ends_at - a.starts_at)) / 60)::integer,
         (select coalesce(sum(coalesce(x.minutes, 10)), 0)::integer from public.counseling_slots x
          where x.staff_id = a.staff_id and x.state in ('booked', 'attended', 'no_show') and x.starts_at >= a.starts_at and x.starts_at < a.ends_at)
  from public.counseling_availability a
  where a.staff_id = auth.uid() and a.ends_at > p_from and a.starts_at < p_to
  order by a.starts_at;
end;
$$;
revoke all on function public.counseling_my_availability(timestamptz, timestamptz) from public, anon;
grant execute on function public.counseling_my_availability(timestamptz, timestamptz) to authenticated;

drop function if exists public.counseling_my_slots(timestamptz, timestamptz);
create or replace function public.counseling_my_slots(p_from timestamptz, p_to timestamptz)
returns table(
  slot_id uuid, availability_id uuid, starts_at timestamptz, ends_at timestamptz, state text, scholar_id_number text, scholar_name text,
  record_id uuid, term_label text, stage text, case_summary text, no_show_count integer, is_summer boolean, hard_copy boolean, daily_record_id uuid,
  type_label text, minutes integer
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
         coalesce(r.no_show_count, 0), coalesce(r.term = 'Summer', false), r.hard_copy_received_at is not null, x.daily_record_id,
         (select t.label from public.consultation_types t where t.key = x.consult_type), x.minutes
  from public.counseling_slots x
  left join public.renewal_records r on r.id = x.record_id
  where x.staff_id = auth.uid() and x.state <> 'open' and x.starts_at >= p_from and x.starts_at < p_to
  order by x.starts_at, x.booked_at;
end;
$$;
revoke all on function public.counseling_my_slots(timestamptz, timestamptz) from public, anon;
grant execute on function public.counseling_my_slots(timestamptz, timestamptz) to authenticated;

drop function if exists public.renewal_calendar_availability(timestamptz, timestamptz, uuid);
create or replace function public.renewal_calendar_availability(p_from timestamptz, p_to timestamptz, p_staff uuid default null)
returns table(id uuid, staff_id uuid, staff_name text, starts_at timestamptz, ends_at timestamptz, minutes integer, booked_minutes integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_renewal_evaluator() then raise exception 'Only the Scholar Renewal Evaluator can see the consultation calendars.'; end if;
  return query
  select a.id, a.staff_id, public._staff_display_name(a.staff_id), a.starts_at, a.ends_at, (extract(epoch from (a.ends_at - a.starts_at)) / 60)::integer,
         (select coalesce(sum(coalesce(x.minutes, 10)), 0)::integer from public.counseling_slots x
          where x.staff_id = a.staff_id and x.state in ('booked', 'attended', 'no_show') and x.starts_at >= a.starts_at and x.starts_at < a.ends_at)
  from public.counseling_availability a
  where a.ends_at > p_from and a.starts_at < p_to and (p_staff is null or a.staff_id = p_staff)
  order by a.starts_at, a.staff_id;
end;
$$;
revoke all on function public.renewal_calendar_availability(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.renewal_calendar_availability(timestamptz, timestamptz, uuid) to authenticated;

drop function if exists public.renewal_calendar_slots(timestamptz, timestamptz, uuid);
create or replace function public.renewal_calendar_slots(p_from timestamptz, p_to timestamptz, p_staff uuid default null)
returns table(
  slot_id uuid, availability_id uuid, staff_id uuid, staff_name text, starts_at timestamptz, ends_at timestamptz, state text, scholar_id_number text, scholar_name text,
  record_id uuid, term_label text, stage text, case_summary text, no_show_count integer, type_label text, minutes integer
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
         coalesce(r.no_show_count, 0),
         (select t.label from public.consultation_types t where t.key = x.consult_type), x.minutes
  from public.counseling_slots x
  left join public.renewal_records r on r.id = x.record_id
  where x.state <> 'open' and x.starts_at >= p_from and x.starts_at < p_to and (p_staff is null or x.staff_id = p_staff)
  order by x.starts_at, x.staff_id, x.booked_at;
end;
$$;
revoke all on function public.renewal_calendar_slots(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.renewal_calendar_slots(timestamptz, timestamptz, uuid) to authenticated;

-- ── 5. Scholar: the types, the open mornings / afternoons, book, change, cancel ──
-- The types a scholar can choose, and the one that matches the case (a suggestion only).
create or replace function public.renewal_consult_types(p_record_id uuid)
returns table(key text, label text, minutes integer, suggested boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id text := public.current_scholar_id_number();
  r public.renewal_records%rowtype;
  v_failed integer;
  v_inc integer;
  v_pick text;
begin
  if v_id is null then raise exception 'Not signed in as a scholar.'; end if;
  select * into r from public.renewal_records where id = p_record_id and scholar_id_number = v_id;
  if not found then raise exception 'That application was not found.'; end if;
  v_failed := coalesce((r.evaluation ->> 'failed_effective')::integer, (r.evaluation -> 'grades' -> 'counts' ->> 'failed')::integer, 0);
  v_inc := coalesce((r.evaluation -> 'grades' -> 'counts' ->> 'inc')::integer, 0);
  v_pick := case when v_inc > 0 then 'inc' when v_failed >= 2 then 'two_plus_failed' when v_failed = 1 then 'one_failed' else null end;
  return query select t.key, t.label, t.minutes, (t.key = v_pick) from public.consultation_types t where t.active order by t.sort;
end;
$$;
revoke all on function public.renewal_consult_types(uuid) from public, anon;
grant execute on function public.renewal_consult_types(uuid) to authenticated;

-- The mornings and afternoons that still have room for this type (at least 12 hours from now, up to 60 days ahead).
create or replace function public.renewal_open_blocks(p_record_id uuid, p_type text)
returns table(day date, half text, spots integer, free_minutes integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id text := public.current_scholar_id_number();
  v_min integer;
begin
  if v_id is null then raise exception 'Not signed in as a scholar.'; end if;
  if not exists (select 1 from public.renewal_records r where r.id = p_record_id and r.scholar_id_number = v_id) then raise exception 'That application was not found.'; end if;
  select t.minutes into v_min from public.consultation_types t where t.key = p_type and t.active;
  if v_min is null then raise exception 'Please choose the type of consultation.'; end if;
  -- someone who already holds a booking may look for another time (to change it); everyone else must be allowed to book
  if not exists (select 1 from public.counseling_slots b where b.record_id = p_record_id and b.state = 'booked') then
    perform public._renewal_require_can_book(p_record_id);
  end if;
  return query
  select b.day, b.half, sum((b.capacity - b.booked) / v_min)::integer, sum(b.capacity - b.booked)::integer
  from public._consult_blocks(now(), now() + interval '61 days') b
  where b.window_start >= now() + interval '12 hours' and b.window_start < now() + interval '60 days' and b.capacity - b.booked >= v_min
  group by b.day, b.half
  order by b.day, b.half;
end;
$$;
revoke all on function public.renewal_open_blocks(uuid, text) from public, anon;
grant execute on function public.renewal_open_blocks(uuid, text) to authenticated;

-- The one place a booking is made (used for booking and for changing): picks the staff member with the most minutes left in that morning / afternoon.
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
  delete from public.counseling_slots where id = v_old.id;
  perform public._booking_log(r.id, v_id, v_old.starts_at, v_old.staff_id, 'cancelled');
  perform public._renewal_log(r.id, r.stage, r.stage, 'Cancelled the consultation on ' || public._manila_slot_text(v_old.starts_at) || '.', 'Scholar');
  perform public._notify_scholar(v_id, 'booking_cancelled', 'Your consultation was cancelled', 'You cancelled ' || public._manila_slot_text(v_old.starts_at) || '. Please book a new time when you are ready.', r.id);
end;
$$;
revoke all on function public.renewal_cancel_booking(uuid) from public, anon;
grant execute on function public.renewal_cancel_booking(uuid) to authenticated;

-- ── 6. What the scholar sees ────────────────────────────────
-- The scholar's overview now says the type and minutes of the booking.
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
          'can_change', v_slot.starts_at >= now() + interval '12 hours',
          'consult_type', v_slot.consult_type, 'type_label', (select t.label from public.consultation_types t where t.key = v_slot.consult_type), 'minutes', v_slot.minutes);
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

drop function if exists public.consultation_my_appointments();
create or replace function public.consultation_my_appointments()
returns table(slot_id uuid, starts_at timestamptz, ends_at timestamptz, staff_name text, state text, record_id uuid, term_label text, can_change boolean, type_label text, minutes integer)
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
         (x.state = 'booked' and x.starts_at >= now() + interval '12 hours'),
         (select t.label from public.consultation_types t where t.key = x.consult_type), x.minutes
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

-- ── 7. Reminders (wording: a morning or afternoon, not an exact time) ──
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
    perform public._notify_scholar(s.scholar_id_number, 'reminder_hour', 'Your consultation hours start soon', 'Reminder: ' || public._manila_slot_text(s.starts_at) || ' at the CEDO office. Please come during those hours.', s.record_id);
    v_hour := v_hour + 1;
  end loop;
  perform public._renewal_sweep();
  return jsonb_build_object('day_reminders', v_day, 'hour_reminders', v_hour);
end;
$$;
revoke all on function public.renewal_scheduled_jobs() from public, anon, authenticated;

-- ── 8. The pre-made 10-minute slots are no longer used: remove the EMPTY ones (no scholar on them; bookings are never touched) ──
delete from public.counseling_slots where state = 'open';

notify pgrst, 'reload schema';
