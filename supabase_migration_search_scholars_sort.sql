-- ─────────────────────────────────────────────────────────────
-- supabase_migration_search_scholars_sort.sql
--
-- Adds server-side column sorting to search_scholars() (backs the
-- Scholars Account subtab's clickable column headers). Two new optional
-- params, p_sort_column/p_sort_direction, default to the function's
-- prior fixed order (last_name, first_name, scholar_id_number) so every
-- existing caller is unaffected until it opts in.
--
-- Stays a plain `language sql` function (no dynamic EXECUTE) — the sort
-- is expressed as a fixed set of `case when p_sort_column = '...'` legs,
-- one pair (asc/desc) per sortable column, which is both simpler and
-- safer than building an ORDER BY string from user input.
--
-- Drops the old 3-arg signature first — `create or replace` can't change
-- a function's arity, and leaving both overloads around risks "function
-- is not unique" errors from PostgREST calls that omit the new params
-- (Postgres can't always tell which default-filled overload to pick).
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

drop function if exists public.search_scholars(text, integer, integer);

create or replace function public.search_scholars(
  p_search text default '',
  p_limit integer default 50,
  p_offset integer default 0,
  p_sort_column text default null,
  p_sort_direction text default 'asc'
)
returns table (
  id uuid, scholar_id_number text, first_name text, last_name text,
  middle_name text, school text, status text, total_count bigint
)
language sql security definer stable set search_path = public as $$
  select s.id, s.scholar_id_number, s.first_name, s.last_name, s.middle_name,
    s.school, s.status, count(*) over () as total_count
  from public.scholars s
  where public.is_sead_staff()
    and (
      nullif(trim(p_search), '') is null
      or s.scholar_id_number ilike '%' || trim(p_search) || '%'
      or s.first_name ilike '%' || trim(p_search) || '%'
      or s.last_name ilike '%' || trim(p_search) || '%'
      or concat_ws(' ', s.first_name, s.last_name) ilike '%' || trim(p_search) || '%'
      or concat_ws(' ', s.last_name, s.first_name) ilike '%' || trim(p_search) || '%'
    )
  order by
    case when p_sort_column = 'scholarIdNumber' and p_sort_direction = 'asc' then s.scholar_id_number end asc,
    case when p_sort_column = 'scholarIdNumber' and p_sort_direction = 'desc' then s.scholar_id_number end desc,
    case when p_sort_column = 'name' and p_sort_direction = 'asc' then concat_ws(' ', s.last_name, s.first_name) end asc,
    case when p_sort_column = 'name' and p_sort_direction = 'desc' then concat_ws(' ', s.last_name, s.first_name) end desc,
    case when p_sort_column = 'school' and p_sort_direction = 'asc' then s.school end asc,
    case when p_sort_column = 'school' and p_sort_direction = 'desc' then s.school end desc,
    case when p_sort_column = 'status' and p_sort_direction = 'asc' then s.status end asc,
    case when p_sort_column = 'status' and p_sort_direction = 'desc' then s.status end desc,
    s.last_name, s.first_name, s.scholar_id_number
  limit greatest(1, least(coalesce(p_limit, 50), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.search_scholars(text, integer, integer, text, text) from public;
grant execute on function public.search_scholars(text, integer, integer, text, text) to authenticated;
