-- ─────────────────────────────────────────────────────────────
-- supabase_migration_distinct_school_year_level.sql
--
-- Fixes fetchDistinctSchools() (formationApi.ts) and
-- fetchDistinctYearLevels() (seadApi.ts) — used to populate the School
-- and Year Level filter dropdowns on Rankings and Formation Tools.
--
-- Both previously ran `select school from scholars where school is not
-- null` (or year_level) with no .range()/.order() at all, pulling one
-- column from every scholar row (7,000+) just to de-duplicate it
-- client-side. Two problems, not just one: it's slow (a full-table
-- column dump on every page load), and it's silently WRONG — PostgREST
-- caps a single response at its configured max rows (1,000 on this
-- project, same cap already documented next to
-- fetchAllScholarsSDPChecklist's own pagination loop), so with no
-- `.order()` either, the truncated result is an arbitrary ~1,000-row
-- slice — any school/year level that only appears among scholars
-- outside that slice silently never shows up in the dropdown.
--
-- These two RPCs do the DISTINCT in Postgres itself (a few dozen
-- distinct values out of ~7,000 rows, trivial at this table size) and
-- return just the deduplicated list — `security invoker` (not definer)
-- so RLS on `scholars` is evaluated as the CALLING user exactly as it
-- already was for the direct-table-select these replace (any staff
-- account, via the existing "staff full access" policy) — no new
-- privilege, just a cheap query instead of an expensive, truncated one.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

create or replace function public.distinct_scholar_schools()
returns table (school text)
language sql
security invoker
stable
set search_path = public
as $$
  select distinct school from public.scholars where school is not null and trim(school) != '' order by school;
$$;

create or replace function public.distinct_scholar_year_levels()
returns table (year_level text)
language sql
security invoker
stable
set search_path = public
as $$
  select distinct year_level from public.scholars where year_level is not null and trim(year_level) != '' order by year_level;
$$;

revoke all on function public.distinct_scholar_schools() from public;
grant execute on function public.distinct_scholar_schools() to authenticated;
revoke all on function public.distinct_scholar_year_levels() from public;
grant execute on function public.distinct_scholar_year_levels() to authenticated;
