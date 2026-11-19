-- ─────────────────────────────────────────────────────────────
-- supabase_migration_consultation_calendar_paging.sql
-- THE ALL-STAFF (READ-ONLY) CONSULTATION CALENDAR: A DAY AT A TIME, ONLY THE NUMBERS ON THE CALENDAR, THE BOOKING LIST IN PAGES.
-- Safe to run twice.   Undo: undo_consultation_calendar_paging.sql   (It adds indexes and three read-only functions; it changes and deletes no record. The old functions stay as they are.)
--
-- This is the calendar of the Scholar Renewal evaluator ("Calendar" tab) that shows EVERY consultation staff member. Each staff member's own calendar (Consultation Tool > Appointments) is not changed.
-- Before: the calendar downloaded every booking of the whole day or week for all staff at once (and a request is cut off silently at 1,000 rows).
--   * renewal_calendar_summary(from, to, staff): only the NUMBERS for each morning (AM) and afternoon (PM) of each day: how many are booked / attended / no-show and how many minutes are used.
--   * renewal_calendar_bookings_page(day, half, staff, limit, offset): ONE PAGE of the booking list of one morning or afternoon (50 at a time) with the true total, read when "Booking list" is pressed.
--   * renewal_calendar_ranges(from, to, staff, limit): the availability ranges, at most p_limit (300 by default) with the true total, so the screen can say when not all of them are shown.
--   * Indexes for the day lookups.
-- Only the Scholar Renewal evaluator can use them (the same rule as before). A day is the Philippine day; a morning is before 12:00 noon Philippine time (the same as the screen has always done).
-- ─────────────────────────────────────────────────────────────

begin;

do $$ begin
  if to_regprocedure('public.renewal_calendar_slots(timestamptz,timestamptz,uuid)') is null or to_regprocedure('public.is_renewal_evaluator()') is null then
    raise exception 'STOPPED, nothing changed: run the Scholar Renewal appointment files first.';
  end if;
end $$;

-- 1. Indexes (an index that exists is left alone).
create index if not exists counseling_slots_booked_day_idx on public.counseling_slots (starts_at, staff_id) where state <> 'open';
create index if not exists counseling_availability_start_idx on public.counseling_availability (starts_at);

-- 2. The numbers for each morning and afternoon.
create or replace function public.renewal_calendar_summary(p_from timestamptz, p_to timestamptz, p_staff uuid default null)
returns table(day date, half text, total integer, booked integer, attended integer, no_show integer, used_minutes integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_renewal_evaluator() then raise exception 'Only the Scholar Renewal Evaluator can see the consultation calendars.'; end if;
  return query
  select (x.starts_at at time zone 'Asia/Manila')::date,
         case when extract(hour from (x.starts_at at time zone 'Asia/Manila')) < 12 then 'AM' else 'PM' end,
         count(*)::integer,
         (count(*) filter (where x.state = 'booked'))::integer, (count(*) filter (where x.state = 'attended'))::integer, (count(*) filter (where x.state = 'no_show'))::integer,
         coalesce(sum(coalesce(x.minutes, 10)), 0)::integer
  from public.counseling_slots x
  where x.state <> 'open' and x.starts_at >= p_from and x.starts_at < p_to and (p_staff is null or x.staff_id = p_staff)
  group by 1, 2
  order by 1, 2;
end;
$$;
revoke all on function public.renewal_calendar_summary(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.renewal_calendar_summary(timestamptz, timestamptz, uuid) to authenticated;

-- 3. One page of the booking list of one morning or afternoon.
create or replace function public.renewal_calendar_bookings_page(p_day date, p_half text, p_staff uuid default null, p_limit integer default 50, p_offset integer default 0)
returns table(
  slot_id uuid, availability_id uuid, staff_id uuid, staff_name text, starts_at timestamptz, ends_at timestamptz, state text, scholar_id_number text, scholar_name text,
  record_id uuid, term_label text, stage text, case_summary text, no_show_count integer, type_label text, minutes integer, total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_half text := case when upper(coalesce(p_half, '')) = 'PM' then 'PM' else 'AM' end;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_from timestamptz := ((p_day::text || ' 00:00:00')::timestamp at time zone 'Asia/Manila');
begin
  if not public.is_renewal_evaluator() then raise exception 'Only the Scholar Renewal Evaluator can see the consultation calendars.'; end if;
  return query
  with b as (
    select x.*, count(*) over () as total
    from public.counseling_slots x
    where x.state <> 'open' and x.starts_at >= v_from and x.starts_at < v_from + interval '1 day' and (p_staff is null or x.staff_id = p_staff)
      and (case when extract(hour from (x.starts_at at time zone 'Asia/Manila')) < 12 then 'AM' else 'PM' end) = v_half
    order by x.starts_at, x.staff_id, x.booked_at, x.id
    limit v_limit offset v_offset
  )
  select b.id, b.availability_id, b.staff_id, public._staff_display_name(b.staff_id), b.starts_at, b.ends_at, b.state, b.scholar_id_number,
         (select btrim(sc.last_name || ', ' || sc.first_name) from public.scholars sc where sc.scholar_id_number = b.scholar_id_number),
         b.record_id, case when r.id is null then null else r.term || ' ' || r.school_year end, r.stage,
         case when r.id is null then null else nullif(concat_ws(' · ',
           case when coalesce((r.evaluation -> 'grades' -> 'counts' ->> 'failed')::integer, 0) > 0 then (r.evaluation -> 'grades' -> 'counts' ->> 'failed') || ' failed' end,
           case when coalesce((r.evaluation -> 'grades' -> 'counts' ->> 'inc')::integer, 0) > 0 then (r.evaluation -> 'grades' -> 'counts' ->> 'inc') || ' INC' end,
           case when r.term = 'Summer' then 'Summer renewal' end), '') end,
         coalesce(r.no_show_count, 0),
         (select t.label from public.consultation_types t where t.key = b.consult_type), b.minutes, b.total
  from b left join public.renewal_records r on r.id = b.record_id
  order by b.starts_at, b.staff_id, b.booked_at, b.id;
end;
$$;
revoke all on function public.renewal_calendar_bookings_page(date, text, uuid, integer, integer) from public, anon;
grant execute on function public.renewal_calendar_bookings_page(date, text, uuid, integer, integer) to authenticated;

-- 4. The availability ranges (the same as before, at most p_limit, with the true total).
create or replace function public.renewal_calendar_ranges(p_from timestamptz, p_to timestamptz, p_staff uuid default null, p_limit integer default 300)
returns table(id uuid, staff_id uuid, staff_name text, starts_at timestamptz, ends_at timestamptz, minutes integer, booked_minutes integer, total_count bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 300), 1), 1000);
begin
  if not public.is_renewal_evaluator() then raise exception 'Only the Scholar Renewal Evaluator can see the consultation calendars.'; end if;
  return query
  with a as (
    select z.*, count(*) over () as total from public.counseling_availability z
    where z.ends_at > p_from and z.starts_at < p_to and (p_staff is null or z.staff_id = p_staff)
    order by z.starts_at, z.staff_id limit v_limit
  )
  select a.id, a.staff_id, public._staff_display_name(a.staff_id), a.starts_at, a.ends_at, (extract(epoch from (a.ends_at - a.starts_at)) / 60)::integer,
         (select coalesce(sum(coalesce(x.minutes, 10)), 0)::integer from public.counseling_slots x
          where x.staff_id = a.staff_id and x.state in ('booked', 'attended', 'no_show') and x.starts_at >= a.starts_at and x.starts_at < a.ends_at),
         a.total
  from a order by a.starts_at, a.staff_id;
end;
$$;
revoke all on function public.renewal_calendar_ranges(timestamptz, timestamptz, uuid, integer) from public, anon;
grant execute on function public.renewal_calendar_ranges(timestamptz, timestamptz, uuid, integer) to authenticated;

notify pgrst, 'reload schema';
commit;
