-- Undo of supabase_migration_renewal_lists_speed.sql: the three functions go back to what they were, and the two new helper functions are removed. Nothing else was changed by that file.
create or replace function public.renewal_tab_options(p_school_year text, p_term text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_view_renewal_list() then raise exception 'Not authorized to view renewal applications.'; end if;
  return (
    with base as (
      select s.scholar_id_number, s.school_id, s.year_level, s.course, s.status from public.scholars s
      where public._renewal_window_includes(p_school_year, p_term, s.scholar_id_number)
        and (s.status not in ('Removed', 'On leave') or exists (select 1 from public.renewal_records r where r.scholar_id_number = s.scholar_id_number and r.school_year = p_school_year and r.term = p_term))
    )
    select jsonb_build_object(
      'schools', coalesce((select jsonb_agg(jsonb_build_object('id', x.school_id, 'name', x.nm) order by x.nm) from (
          select b.school_id, coalesce(sc.name, '(no school set)') as nm from base b left join public.schools sc on sc.id = b.school_id group by b.school_id, 2) x), '[]'::jsonb),
      'year_levels', coalesce((select jsonb_agg(y order by y) from (select distinct nullif(btrim(year_level), '') as y from base) q where y is not null), '[]'::jsonb),
      'programs', coalesce((select jsonb_agg(p order by p) from (select distinct nullif(btrim(course), '') as p from base) q where p is not null), '[]'::jsonb),
      'statuses', coalesce((select jsonb_agg(st order by st) from (select distinct nullif(btrim(status), '') as st from base) q where st is not null), '[]'::jsonb),
      'scholars', (select count(*) from base where status not in ('Removed', 'On leave')),
      'checked', (select count(*) from base b join public.renewal_scholar_list_cache c on c.scholar_id_number = b.scholar_id_number and c.school_year = p_school_year and c.term = p_term where b.status not in ('Removed', 'On leave')),
      'last_checked', (select min(c.computed_at) from base b join public.renewal_scholar_list_cache c on c.scholar_id_number = b.scholar_id_number and c.school_year = p_school_year and c.term = p_term where b.status not in ('Removed', 'On leave')))
  );
end;
$$;
revoke all on function public.renewal_tab_options(text, text) from public, anon;
grant execute on function public.renewal_tab_options(text, text) to authenticated;

create or replace function public.renewal_scholar_list(
  p_school_year text, p_term text, p_query text default null, p_schools uuid[] default null, p_year_levels text[] default null, p_programs text[] default null,
  p_eligibility text[] default null, p_limit integer default 25, p_offset integer default 0)
returns table(
  scholar_id_number text, name text, scholar_status text, school_id uuid, school text, year_level text, program text,
  sdp_applicable boolean, sdp_complied boolean, sdp_missing text, sdp_reconsideration text, grades_state text, graded integer, total integer, failed integer, drp integer, inc integer, review integer,
  eligibility text[], computed_at timestamptz, total_rows bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if not public.can_view_renewal_list() then raise exception 'Not authorized to view renewal applications.'; end if;
  return query
  select s.scholar_id_number, btrim(s.last_name || ', ' || s.first_name || ' ' || coalesce(s.middle_name, '')), s.status, s.school_id, s.school, s.year_level, s.course,
         c.sdp_applicable, c.sdp_complied, c.sdp_missing,
         (select r.status from public.sdp_reconsideration_requests r where r.scholar_id_number = s.scholar_id_number and r.school_year = p_school_year and r.term = p_term),
         c.grades_state, c.graded, c.total, c.failed, c.drp, c.inc, c.review, c.eligibility, c.computed_at,
         count(*) over ()
  from public.renewal_scholar_list_cache c
  join public.scholars s on s.scholar_id_number = c.scholar_id_number
  where c.school_year = p_school_year and c.term = p_term
    and s.status not in ('Removed', 'On leave') and public._renewal_window_includes(p_school_year, p_term, s.scholar_id_number)
    and (coalesce(cardinality(p_schools), 0) = 0 or s.school_id = any (p_schools))
    and (coalesce(cardinality(p_year_levels), 0) = 0 or s.year_level = any (p_year_levels))
    and (coalesce(cardinality(p_programs), 0) = 0 or s.course = any (p_programs))
    and (coalesce(cardinality(p_eligibility), 0) = 0 or c.eligibility && p_eligibility)
    and (v_q is null or s.scholar_id_number ilike '%' || v_q || '%' or (s.first_name || ' ' || s.last_name) ilike '%' || v_q || '%' or (s.last_name || ' ' || s.first_name) ilike '%' || v_q || '%'
         or (s.last_name || ', ' || s.first_name) ilike '%' || v_q || '%')
  order by s.last_name, s.first_name, s.scholar_id_number
  limit greatest(1, least(coalesce(p_limit, 25), 200)) offset greatest(0, coalesce(p_offset, 0));
end;
$$;
revoke all on function public.renewal_scholar_list(text, text, text, uuid[], text[], text[], text[], integer, integer) from public, anon;
grant execute on function public.renewal_scholar_list(text, text, text, uuid[], text[], text[], text[], integer, integer) to authenticated;

create or replace function public.renewal_scholar_list_matrix(
  p_school_year text, p_term text, p_query text default null, p_schools uuid[] default null, p_year_levels text[] default null, p_programs text[] default null)
returns table(school_id uuid, school text, ready bigint, consultation bigint, sdp_reconsideration bigint, waiting bigint, review bigint, total bigint, last_checked timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if not public.can_view_renewal_list() then raise exception 'Not authorized to view renewal applications.'; end if;
  return query
  select s.school_id, coalesce(sc.name, nullif(btrim(coalesce(s.school, '')), ''), '(no school set)'),
         count(*) filter (where 'ready' = any (c.eligibility)), count(*) filter (where 'consultation' = any (c.eligibility)), count(*) filter (where 'sdp_reconsideration' = any (c.eligibility)),
         count(*) filter (where 'waiting' = any (c.eligibility)), count(*) filter (where 'review' = any (c.eligibility)), count(*), min(c.computed_at)
  from public.renewal_scholar_list_cache c
  join public.scholars s on s.scholar_id_number = c.scholar_id_number
  left join public.schools sc on sc.id = s.school_id
  where c.school_year = p_school_year and c.term = p_term
    and s.status not in ('Removed', 'On leave') and public._renewal_window_includes(p_school_year, p_term, s.scholar_id_number)
    and (coalesce(cardinality(p_schools), 0) = 0 or s.school_id = any (p_schools))
    and (coalesce(cardinality(p_year_levels), 0) = 0 or s.year_level = any (p_year_levels))
    and (coalesce(cardinality(p_programs), 0) = 0 or s.course = any (p_programs))
    and (v_q is null or s.scholar_id_number ilike '%' || v_q || '%' or (s.first_name || ' ' || s.last_name) ilike '%' || v_q || '%' or (s.last_name || ' ' || s.first_name) ilike '%' || v_q || '%'
         or (s.last_name || ', ' || s.first_name) ilike '%' || v_q || '%')
  group by s.school_id, 2
  order by 2;
end;
$$;
revoke all on function public.renewal_scholar_list_matrix(text, text, text, uuid[], text[], text[]) from public, anon;
grant execute on function public.renewal_scholar_list_matrix(text, text, text, uuid[], text[], text[]) to authenticated;

create or replace function public.renewal_scholar_list_options(p_school_year text, p_term text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_view_renewal_list() then raise exception 'Not authorized to view renewal applications.'; end if;
  return (
    with base as (
      select s.scholar_id_number, s.school_id, s.school, s.year_level, s.course from public.scholars s
      where s.status not in ('Removed', 'On leave') and public._renewal_window_includes(p_school_year, p_term, s.scholar_id_number)
    )
    select jsonb_build_object(
      'schools', coalesce((select jsonb_agg(jsonb_build_object('id', x.school_id, 'name', x.nm) order by x.nm) from (
          select b.school_id, coalesce(sc.name, '(no school set)') as nm from base b left join public.schools sc on sc.id = b.school_id group by b.school_id, 2) x), '[]'::jsonb),
      'year_levels', coalesce((select jsonb_agg(y order by y) from (select distinct nullif(btrim(year_level), '') as y from base) q where y is not null), '[]'::jsonb),
      'programs', coalesce((select jsonb_agg(p order by p) from (select distinct nullif(btrim(course), '') as p from base) q where p is not null), '[]'::jsonb),
      'scholars', (select count(*) from base),
      'checked', (select count(*) from base b join public.renewal_scholar_list_cache c on c.scholar_id_number = b.scholar_id_number and c.school_year = p_school_year and c.term = p_term),
      'last_checked', (select min(c.computed_at) from base b join public.renewal_scholar_list_cache c on c.scholar_id_number = b.scholar_id_number and c.school_year = p_school_year and c.term = p_term)));
end;
$$;
revoke all on function public.renewal_scholar_list_options(text, text) from public, anon;
grant execute on function public.renewal_scholar_list_options(text, text) to authenticated;

create or replace function public.renewal_tab_list(
  p_school_year text, p_term text, p_tab text, p_sub text default null, p_query text default null, p_schools uuid[] default null, p_year_levels text[] default null, p_programs text[] default null,
  p_statuses text[] default null, p_sdp text default null, p_grades text default null, p_limit integer default 25, p_offset integer default 0)
returns table(
  scholar_id_number text, name text, scholar_status text, school_id uuid, school text, year_level text, program text,
  sdp_applicable boolean, sdp_complied boolean, sdp_missing text, sdp_reconsideration text, grades_state text, graded integer, total integer, failed integer, drp integer, inc integer, review integer,
  eligibility text[], computed_at timestamptz, record_id uuid, stage text, is_late boolean, from_status text, to_status text, sub text, total_rows bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_view_renewal_list() then raise exception 'Not authorized to view renewal applications.'; end if;
  return query
  select t.scholar_id_number, t.name, t.scholar_status, t.school_id, t.school, t.year_level, t.program, t.sdp_applicable, t.sdp_complied, t.sdp_missing, t.sdp_reconsideration, t.grades_state, t.graded, t.total,
         t.failed, t.drp, t.inc, t.review, t.eligibility, t.computed_at, t.record_id, t.stage, t.is_late, t.from_status, t.to_status, t.sub, count(*) over ()
  from public._renewal_tab_rows(p_school_year, p_term, p_tab, p_query, p_schools, p_year_levels, p_programs, p_statuses, p_sdp, p_grades) t
  where p_sub is null or t.sub = p_sub
  order by t.name, t.scholar_id_number
  limit greatest(1, least(coalesce(p_limit, 25), 200)) offset greatest(0, coalesce(p_offset, 0));
end;
$$;
revoke all on function public.renewal_tab_list(text, text, text, text, text, uuid[], text[], text[], text[], text, text, integer, integer) from public, anon;
grant execute on function public.renewal_tab_list(text, text, text, text, text, uuid[], text[], text[], text[], text, text, integer, integer) to authenticated;

create or replace function public.renewal_tab_counts(
  p_school_year text, p_term text, p_tab text, p_query text default null, p_schools uuid[] default null, p_year_levels text[] default null, p_programs text[] default null,
  p_statuses text[] default null, p_sdp text default null, p_grades text default null)
returns table(sub text, n bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_view_renewal_list() then raise exception 'Not authorized to view renewal applications.'; end if;
  return query
  select t.sub, count(*)
  from public._renewal_tab_rows(p_school_year, p_term, p_tab, p_query, p_schools, p_year_levels, p_programs, p_statuses, p_sdp, p_grades) t
  group by t.sub;
end;
$$;
revoke all on function public.renewal_tab_counts(text, text, text, text, uuid[], text[], text[], text[], text, text) from public, anon;
grant execute on function public.renewal_tab_counts(text, text, text, text, uuid[], text[], text[], text[], text, text) to authenticated;

drop function if exists public._renewal_window_members(text, text);
drop function if exists public._renewal_tab_page_rows(text, text, text, text[]);
drop function if exists public._renewal_tab_core(text, text, text, text, uuid[], text[], text[], text[], text, text);
notify pgrst, 'reload schema';
