-- ─────────────────────────────────────────────────────────────
-- supabase_migration_renewal_enrollment_confirmation.sql
-- SCHOLAR RENEWAL > RENEWED: AN "ENROLLMENT CONFIRMATION" TICK BOX PER SCHOLAR, AND AN EXPORT OF THE CONFIRMED ENROLLED (BY THE DATE THE SCHOLAR WAS RENEWED).
-- Safe to run twice.   Undo: undo_renewal_enrollment_confirmation.sql
--
--   * Each renewed scholar gets one tick box, "Enrollment confirmation". The renewal staff (the same people who can open the renewal lists) tick it and untick it.
--     The database keeps WHO ticked it and WHEN (the first tick is kept if somebody ticks it again).
--   * The export lists the ticked scholars who were renewed between two dates (the day the renewal was confirmed, Philippine time, both days included),
--     for the allowance endorsement: name, year, program, barangay and school.
--   * Nothing about the renewal itself changes (stages, results, SDP, grades). Only three columns are added to renewal_records, plus four functions. Nothing is deleted.
-- ─────────────────────────────────────────────────────────────

begin;

do $$ begin
  if to_regclass('public.renewal_records') is null or to_regprocedure('public.can_view_renewal_list()') is null or to_regclass('public.renewal_export_log') is null then
    raise exception 'STOPPED, nothing changed: run the Scholar Renewal files first.';
  end if;
end $$;

-- 1. Who confirmed the enrollment, and when (empty = not confirmed).
alter table public.renewal_records add column if not exists enrollment_confirmed_at timestamptz;
alter table public.renewal_records add column if not exists enrollment_confirmed_by uuid;
alter table public.renewal_records add column if not exists enrollment_confirmed_label text;
create index if not exists renewal_records_enrollment_idx on public.renewal_records (school_year, term, confirmed_at) where enrollment_confirmed_at is not null;

-- 2. Where the given scholars stand (one page of the Renewed list): the renewal record, ticked or not, by whom and when, and the day the scholar was renewed.
create or replace function public.renewal_enrollment_status(p_school_year text, p_term text, p_ids text[])
returns table(scholar_id_number text, record_id uuid, confirmed boolean, confirmed_at timestamptz, confirmed_by text, renewed_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_view_renewal_list() then raise exception 'Not authorized to view renewal applications.'; end if;
  return query
  select r.scholar_id_number, r.id, r.enrollment_confirmed_at is not null, r.enrollment_confirmed_at, r.enrollment_confirmed_label, r.confirmed_at
  from public.renewal_records r
  where r.school_year = p_school_year and r.term = p_term and r.stage = 'renewed' and r.scholar_id_number = any (coalesce(p_ids, '{}'::text[]));
end;
$$;
revoke all on function public.renewal_enrollment_status(text, text, text[]) from public, anon;
grant execute on function public.renewal_enrollment_status(text, text, text[]) to authenticated;

-- 3. Tick or untick. Only a renewed scholar can be ticked. Ticking twice keeps the first who/when.
create or replace function public.renewal_enrollment_set(p_record_id uuid, p_confirmed boolean)
returns table(confirmed boolean, confirmed_at timestamptz, confirmed_by text)
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.renewal_records%rowtype;
begin
  if not public.can_view_renewal_list() then raise exception 'Not authorized to view renewal applications.'; end if;
  select * into r from public.renewal_records where id = p_record_id for update;
  if not found then raise exception 'This renewal was not found.'; end if;
  if r.stage <> 'renewed' then raise exception 'Only a renewed scholar can be confirmed as enrolled.'; end if;
  if coalesce(p_confirmed, false) then
    if r.enrollment_confirmed_at is null then
      update public.renewal_records set enrollment_confirmed_at = now(), enrollment_confirmed_by = auth.uid(), enrollment_confirmed_label = public._actor_name() where id = p_record_id;
    end if;
  else
    update public.renewal_records set enrollment_confirmed_at = null, enrollment_confirmed_by = null, enrollment_confirmed_label = null where id = p_record_id;
  end if;
  return query select x.enrollment_confirmed_at is not null, x.enrollment_confirmed_at, x.enrollment_confirmed_label from public.renewal_records x where x.id = p_record_id;
end;
$$;
revoke all on function public.renewal_enrollment_set(uuid, boolean) from public, anon;
grant execute on function public.renewal_enrollment_set(uuid, boolean) to authenticated;

-- 4. The numbers for the export window: renewed and confirmed within the chosen dates, and the first / last day anybody was renewed in the term (to suggest the dates).
create or replace function public.renewal_enrollment_summary(p_school_year text, p_term text, p_from date default null, p_to date default null)
returns table(renewed_in_range bigint, confirmed_in_range bigint, term_renewed bigint, term_confirmed bigint, first_renewed date, last_renewed date)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_view_renewal_list() then raise exception 'Not authorized to view renewal applications.'; end if;
  return query
  select count(*) filter (where d between coalesce(p_from, d) and coalesce(p_to, d)),
         count(*) filter (where x.enrollment_confirmed_at is not null and d between coalesce(p_from, d) and coalesce(p_to, d)),
         count(*), count(*) filter (where x.enrollment_confirmed_at is not null),
         min(d), max(d)
  from (select r.enrollment_confirmed_at, (r.confirmed_at at time zone 'Asia/Manila')::date as d
        from public.renewal_records r where r.school_year = p_school_year and r.term = p_term and r.stage = 'renewed' and r.confirmed_at is not null) x;
end;
$$;
revoke all on function public.renewal_enrollment_summary(text, text, date, date) from public, anon;
grant execute on function public.renewal_enrollment_summary(text, text, date, date) to authenticated;

-- 5. The export (written to the export log, like the other renewal exports): the scholars with the box ticked who were renewed from p_from to p_to (Philippine days, both included; empty = no limit), by school, year level and name. In pages (the API cuts one answer at 1,000 rows).
create or replace function public.renewal_enrollment_export(p_school_year text, p_term text, p_from date default null, p_to date default null, p_offset integer default 0, p_limit integer default 1000)
returns table(scholar_id_number text, last_name text, first_name text, middle_name text, year_level text, program text, barangay text, school text, renewed_on date)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n bigint;
begin
  if not public.can_view_renewal_list() then raise exception 'Not authorized to view renewal applications.'; end if;
  -- the export lists personal details, so (like the other renewal exports) it is written to the export log: once, when the first page is asked for
  if coalesce(p_offset, 0) = 0 then
    select count(*) into v_n from public.renewal_records r
    where r.school_year = p_school_year and r.term = p_term and r.stage = 'renewed' and r.enrollment_confirmed_at is not null
      and (p_from is null or (r.confirmed_at at time zone 'Asia/Manila')::date >= p_from) and (p_to is null or (r.confirmed_at at time zone 'Asia/Manila')::date <= p_to);
    insert into public.renewal_export_log (exported_by, by_label, school_year, term, what, row_count, filter_text)
    values ((select u.id from public.users u where u.id = auth.uid()), public._actor_name(), p_school_year, p_term, 'allowance endorsement', v_n,
            'Confirmed enrolled, renewed ' || coalesce('from ' || p_from::text, 'from the start') || coalesce(' to ' || p_to::text, ' to the end'));
  end if;
  return query
  select s.scholar_id_number, s.last_name, s.first_name, coalesce(s.middle_name, ''), coalesce(s.year_level, ''), coalesce(s.course, ''), coalesce(s.barangay, ''), coalesce(s.school, ''),
         (r.confirmed_at at time zone 'Asia/Manila')::date
  from public.renewal_records r
  join public.scholars s on s.scholar_id_number = r.scholar_id_number
  where r.school_year = p_school_year and r.term = p_term and r.stage = 'renewed' and r.enrollment_confirmed_at is not null
    and (p_from is null or (r.confirmed_at at time zone 'Asia/Manila')::date >= p_from)
    and (p_to is null or (r.confirmed_at at time zone 'Asia/Manila')::date <= p_to)
  order by lower(coalesce(s.school, '')), coalesce(nullif(substring(s.year_level from '[0-9]+'), '')::integer, 99), lower(s.last_name), lower(s.first_name), s.scholar_id_number
  offset greatest(0, coalesce(p_offset, 0)) limit greatest(1, least(coalesce(p_limit, 1000), 1000));
end;
$$;
revoke all on function public.renewal_enrollment_export(text, text, date, date, integer, integer) from public, anon;
grant execute on function public.renewal_enrollment_export(text, text, date, date, integer, integer) to authenticated;

notify pgrst, 'reload schema';

commit;
