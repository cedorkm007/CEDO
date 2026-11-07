-- ─────────────────────────────────────────────────────────────
-- SCHOLAR RENEWAL LISTS: FASTER (no more "canceling statement due to statement timeout").   Safe to run twice.   Undo: undo_renewal_lists_speed.sql
-- Run AFTER supabase_migration_renewal_tabs.sql (and the files it needs, up to supabase_migration_renewal_multi_windows_d_test_window_beside.sql).
--
-- WHY IT WAS SLOW: to show 25 scholars, the Applications / Renewed / Not applied lists worked out EVERYTHING for EVERY application first: each stored renewal check
-- (a large JSON document per application) was opened about twenty times per scholar, and the eligibility, the SDP reconsideration and the status history were worked out for
-- everybody although only 25 are shown. The sub-tab numbers asked for the same work again. With thousands of applications that passes the time the database allows.
--
-- WHAT CHANGES (the answers stay exactly the same; only how they are found):
--   * _renewal_tab_core(): finds only WHO is in the tab / sub-tab and the sub-tab each one belongs to, opening each stored check ONCE.
--   * renewal_tab_counts() and renewal_tab_list() use it; the list then works out the full details for the 25 (or fewer) scholars of the page only (_renewal_tab_page_rows()).
--   * _renewal_window_members(): the question "is this scholar in a window of this term?" is asked for thousands of scholars by the lists. It is now answered ONCE, as a set, and the lists that asked it
--     for every scholar (Not applied, the filter options, the Scholar List, its school table and its options) use that set. _renewal_window_includes() itself is not changed.
-- Replaces 7 functions and adds 3. No table is changed. Nothing is deleted. The older _renewal_tab_rows() stays (nothing uses it any more).
-- ─────────────────────────────────────────────────────────────
do $$ begin
  if to_regprocedure('public._renewal_tab_rows(text,text,text,text,uuid[],text[],text[],text[],text,text)') is null then
    raise exception 'STOPPED, nothing changed: run supabase_migration_renewal_tabs.sql first.';
  end if;
end $$;

-- 1. "Who is in a window of this term?", as ONE set (computed once per list), instead of asking "is this scholar in a window?" again for each of thousands of scholars. The same rules as
--    _renewal_window_includes() (a term with no window includes everybody; a test window belongs to its testers; a window follows its schools; an "all schools" window is not for a school that
--    has a window of its own; a scholar who is a tester of a test window of the term is not in the real windows). _renewal_window_includes() itself is NOT changed.
create or replace function public._renewal_window_members(p_school_year text, p_term text)
returns table(sid text)
language sql
stable
security definer
set search_path = public
as $$
  select s.scholar_id_number
  from public.scholars s
  where not exists (select 1 from public.renewal_windows w where w.school_year = p_school_year and w.term = p_term)
  union
  select s.scholar_id_number
  from public.scholars s
  join public.renewal_windows w on w.school_year = p_school_year and w.term = p_term
  where case
          when w.testers is not null then
            s.scholar_id_number = any (w.testers)
            and case when coalesce(cardinality(w.school_ids), 0) > 0 then s.school_id is not null and s.school_id = any (w.school_ids) else true end
          else
            (case when coalesce(cardinality(w.school_ids), 0) > 0 then s.school_id is not null and s.school_id = any (w.school_ids)
                  else not (s.school_id is not null and exists (
                         select 1 from public.renewal_windows x
                         where x.id <> w.id and x.school_year = w.school_year and x.term = w.term and x.testers is null and s.school_id = any (coalesce(x.school_ids, '{}'::uuid[])))) end)
            and not exists (select 1 from public.renewal_windows x where x.id <> w.id and x.school_year = w.school_year and x.term = w.term and x.testers is not null and s.scholar_id_number = any (x.testers))
        end;
$$;
revoke all on function public._renewal_window_members(text, text) from public, anon, authenticated;

-- 2. Who is in a tab (and the sub-tab of each), opening each stored renewal check once.
create or replace function public._renewal_tab_core(
  p_school_year text, p_term text, p_tab text, p_query text, p_schools uuid[], p_year_levels text[], p_programs text[], p_statuses text[], p_sdp text, p_grades text)
returns table(scholar_id_number text, name text, sub text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if p_tab not in ('applications', 'renewed', 'not_applied') then raise exception 'Unknown list.'; end if;
  return query
  with joined as (
    select s.scholar_id_number as sid, btrim(s.last_name || ', ' || s.first_name || ' ' || coalesce(s.middle_name, '')) as nm, s.status as st,
           r.result as rresult, (r.id is not null and r.evaluation <> '{}'::jsonb) as live, r.evaluation as ev,
           c.sdp_applicable as c_app, c.sdp_complied as c_comp, c.grades_state as c_state, c.failed as c_failed, c.drp as c_drp, c.inc as c_inc, c.review as c_review
    from public.scholars s
    left join public.renewal_records r on r.scholar_id_number = s.scholar_id_number and r.school_year = p_school_year and r.term = p_term
    left join public.renewal_scholar_list_cache c on c.scholar_id_number = s.scholar_id_number and c.school_year = p_school_year and c.term = p_term
    where case p_tab
            when 'applications' then r.id is not null and r.stage not in ('renewed', 'removed', 'late_declined', 'not_required')
            when 'renewed' then r.stage = 'renewed'
            else r.id is null and s.status not in ('Removed', 'On leave') and s.scholar_id_number in (select m.sid from public._renewal_window_members(p_school_year, p_term) m) end
      and (coalesce(cardinality(p_schools), 0) = 0 or s.school_id = any (p_schools))
      and (coalesce(cardinality(p_year_levels), 0) = 0 or s.year_level = any (p_year_levels))
      and (coalesce(cardinality(p_programs), 0) = 0 or s.course = any (p_programs))
      and (coalesce(cardinality(p_statuses), 0) = 0 or s.status = any (p_statuses))
      and (v_q is null or s.scholar_id_number ilike '%' || v_q || '%' or (s.first_name || ' ' || s.last_name) ilike '%' || v_q || '%' or (s.last_name || ' ' || s.first_name) ilike '%' || v_q || '%'
           or (s.last_name || ', ' || s.first_name) ilike '%' || v_q || '%')
  ), shaped as (
    -- each stored check is opened ONCE here (jsonb_to_record), and only the few values the sub-tabs need are taken from it
    select j.sid, j.nm, j.st, j.rresult,
           case when j.live then coalesce(sd.applicable, true) else coalesce(j.c_app, true) end as app,
           case when j.live then sd.complied else j.c_comp end as comp,
           case when j.live then g.state else j.c_state end as gstate,
           case when j.live then coalesce(cn.review, 0) else coalesce(j.c_review, 0) end as greview,
           case when j.live then coalesce(e.failed_effective, cn.failed, 0) else coalesce(j.c_failed, 0) + coalesce(j.c_drp, 0) end as gfailed_eff,
           case when j.live then coalesce(e.open_inc, 0) else coalesce(j.c_inc, 0) end as ginc_open
    from joined j
    left join lateral jsonb_to_record(case when j.live then j.ev else '{}'::jsonb end) as e(sdp jsonb, grades jsonb, failed_effective integer, open_inc integer) on true
    left join lateral jsonb_to_record(coalesce(e.sdp, '{}'::jsonb)) as sd(applicable boolean, complied boolean) on true
    left join lateral jsonb_to_record(coalesce(e.grades, '{}'::jsonb)) as g(state text, counts jsonb) on true
    left join lateral jsonb_to_record(coalesce(g.counts, '{}'::jsonb)) as cn(failed integer, review integer) on true
  )
  select z.sid, z.nm,
         case p_tab
           when 'renewed' then case when z.rresult = 'reconsidered' or z.st = 'Reconsidered' then 'reconsidered' when z.st = 'Probationary' then 'probationary' else 'regular' end
           else case when z.gfailed_eff >= 2 then 'failed2'
                     when z.gfailed_eff = 1 then 'failed1'
                     when z.ginc_open > 0 then 'inc'
                     when coalesce(z.gstate, 'waiting') <> 'ready' or z.greview > 0 then 'pending'
                     else 'complete' end end
  from shaped z
  where (p_sdp is null or (p_sdp = 'complied' and (not z.app or coalesce(z.comp, false))) or (p_sdp = 'not_complied' and z.app and not coalesce(z.comp, false)))
    and (p_grades is null or (p_grades = 'in' and coalesce(z.gstate, 'waiting') = 'ready' and z.greview = 0) or (p_grades = 'not_in' and (coalesce(z.gstate, 'waiting') <> 'ready' or z.greview > 0)));
end;
$$;
revoke all on function public._renewal_tab_core(text, text, text, text, uuid[], text[], text[], text[], text, text) from public, anon, authenticated;

-- 3. The full details of the scholars of ONE page (the same columns the list has always had).
create or replace function public._renewal_tab_page_rows(p_school_year text, p_term text, p_tab text, p_ids text[])
returns table(
  scholar_id_number text, name text, scholar_status text, school_id uuid, school text, year_level text, program text,
  sdp_applicable boolean, sdp_complied boolean, sdp_missing text, sdp_reconsideration text, grades_state text, graded integer, total integer, failed integer, drp integer, inc integer, review integer,
  eligibility text[], computed_at timestamptz, record_id uuid, stage text, is_late boolean, from_status text, to_status text, sub text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_tab not in ('applications', 'renewed', 'not_applied') then raise exception 'Unknown list.'; end if;
  return query
  with joined as (
    select s.scholar_id_number as sid, btrim(s.last_name || ', ' || s.first_name || ' ' || coalesce(s.middle_name, '')) as nm, s.status as st, s.school_id as sch_id, s.school as sch, s.year_level as yl, s.course as prog,
           r.id as rid, r.stage as rstage, coalesce(r.is_late, false) as rlate, r.applied_at as rapplied, r.result as rresult,
           (r.id is not null and r.evaluation <> '{}'::jsonb) as live,
           r.evaluation as ev, c.sdp_applicable as c_app, c.sdp_complied as c_comp, c.sdp_missing as c_miss, c.grades_state as c_state, c.graded as c_graded, c.total as c_total,
           c.failed as c_failed, c.drp as c_drp, c.inc as c_inc, c.review as c_review, c.eligibility as c_elig, c.computed_at as c_at
    from public.scholars s
    left join public.renewal_records r on r.scholar_id_number = s.scholar_id_number and r.school_year = p_school_year and r.term = p_term
    left join public.renewal_scholar_list_cache c on c.scholar_id_number = s.scholar_id_number and c.school_year = p_school_year and c.term = p_term
    where case p_tab
            when 'applications' then r.id is not null and r.stage not in ('renewed', 'removed', 'late_declined', 'not_required')
            when 'renewed' then r.stage = 'renewed'
            else r.id is null and s.status not in ('Removed', 'On leave') and public._renewal_window_includes(p_school_year, p_term, s.scholar_id_number) end
      and s.scholar_id_number = any (p_ids)
  ), shaped as (
    select j.*,
           case when j.live then coalesce((j.ev -> 'sdp' ->> 'applicable')::boolean, true) else coalesce(j.c_app, true) end as app,
           case when j.live then (j.ev -> 'sdp' ->> 'complied')::boolean else j.c_comp end as comp,
           case when j.live then j.ev -> 'sdp' ->> 'missing' else j.c_miss end as miss,
           case when j.live then j.ev -> 'grades' ->> 'state' else j.c_state end as gstate,
           case when j.live then greatest(0, coalesce((j.ev -> 'grades' -> 'counts' ->> 'total')::integer, 0) - coalesce((j.ev -> 'grades' -> 'counts' ->> 'ungraded')::integer, 0)) else coalesce(j.c_graded, 0) end as gdone,
           case when j.live then coalesce((j.ev -> 'grades' -> 'counts' ->> 'total')::integer, 0) else coalesce(j.c_total, 0) end as gtotal,
           case when j.live then greatest(0, coalesce((j.ev -> 'grades' -> 'counts' ->> 'failed')::integer, 0) - coalesce((j.ev -> 'grades' -> 'counts' ->> 'drp')::integer, 0)) else coalesce(j.c_failed, 0) end as gfailed,
           case when j.live then coalesce((j.ev -> 'grades' -> 'counts' ->> 'drp')::integer, 0) else coalesce(j.c_drp, 0) end as gdrp,
           case when j.live then coalesce((j.ev -> 'grades' -> 'counts' ->> 'inc')::integer, 0) else coalesce(j.c_inc, 0) end as ginc,
           case when j.live then coalesce((j.ev -> 'grades' -> 'counts' ->> 'review')::integer, 0) else coalesce(j.c_review, 0) end as greview,
           -- failed subjects that decide the sub-tab: the ones counted for the renewal (an INC the evaluator counted as failed is one), a DRP included
           case when j.live then coalesce((j.ev ->> 'failed_effective')::integer, (j.ev -> 'grades' -> 'counts' ->> 'failed')::integer, 0) else coalesce(j.c_failed, 0) + coalesce(j.c_drp, 0) end as gfailed_eff,
           -- INCs still open (an INC that was decided or counted as failed is no longer one)
           case when j.live then coalesce((j.ev ->> 'open_inc')::integer, 0) else coalesce(j.c_inc, 0) end as ginc_open,
           case when j.live then public._renewal_list_eligibility(j.ev) else coalesce(j.c_elig, '{}'::text[]) end as elig
    from joined j
  ), sorted as (
    select x.*,
           case p_tab
             when 'renewed' then case when x.rresult = 'reconsidered' or x.st = 'Reconsidered' then 'reconsidered' when x.st = 'Probationary' then 'probationary' else 'regular' end
             else case when x.gfailed_eff >= 2 then 'failed2'
                       when x.gfailed_eff = 1 then 'failed1'
                       when x.ginc_open > 0 then 'inc'
                       when coalesce(x.gstate, 'waiting') <> 'ready' or x.greview > 0 then 'pending'
                       else 'complete' end end as subtab
    from shaped x
  )
  select z.sid, z.nm, z.st, z.sch_id, z.sch, z.yl, z.prog,
         z.app, z.comp, z.miss,
         (select q.status from public.sdp_reconsideration_requests q where q.scholar_id_number = z.sid and q.school_year = p_school_year and q.term = p_term),
         z.gstate, z.gdone, z.gtotal, z.gfailed, z.gdrp, z.ginc, z.greview,
         z.elig, z.c_at, z.rid, z.rstage, z.rlate,
         case when p_tab = 'renewed' then coalesce((select h.previous_status from public.scholar_status_history h where h.scholar_id_number = z.sid and z.rapplied is not null and h.changed_at >= z.rapplied order by h.changed_at asc limit 1), z.st) end,
         case when p_tab = 'renewed' then z.st end,
         z.subtab
  from sorted z;
end;
$$;
revoke all on function public._renewal_tab_rows(text, text, text, text, uuid[], text[], text[], text[], text, text) from public, anon, authenticated;
revoke all on function public._renewal_tab_page_rows(text, text, text, text[]) from public, anon, authenticated;

-- 4. One page of one sub-tab (p_sub null = the whole tab), ordered by name: who is on the page is found first, then only their details are worked out.
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
  with pg as (
    select t.scholar_id_number as sid, t.name as nm, count(*) over () as total
    from public._renewal_tab_core(p_school_year, p_term, p_tab, p_query, p_schools, p_year_levels, p_programs, p_statuses, p_sdp, p_grades) t
    where p_sub is null or t.sub = p_sub
    order by t.name, t.scholar_id_number
    limit greatest(1, least(coalesce(p_limit, 25), 200)) offset greatest(0, coalesce(p_offset, 0))
  )
  select f.scholar_id_number, f.name, f.scholar_status, f.school_id, f.school, f.year_level, f.program, f.sdp_applicable, f.sdp_complied, f.sdp_missing, f.sdp_reconsideration, f.grades_state, f.graded, f.total,
         f.failed, f.drp, f.inc, f.review, f.eligibility, f.computed_at, f.record_id, f.stage, f.is_late, f.from_status, f.to_status, f.sub, pg.total
  from pg
  join public._renewal_tab_page_rows(p_school_year, p_term, p_tab, array(select p2.sid from pg p2)) f on f.scholar_id_number = pg.sid
  order by pg.nm, pg.sid;
end;
$$;
revoke all on function public.renewal_tab_list(text, text, text, text, text, uuid[], text[], text[], text[], text, text, integer, integer) from public, anon;
grant execute on function public.renewal_tab_list(text, text, text, text, text, uuid[], text[], text[], text[], text, text, integer, integer) to authenticated;

-- 5. How many scholars each sub-tab holds (with the same filters), for the numbers on the sub-tabs.
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
  from public._renewal_tab_core(p_school_year, p_term, p_tab, p_query, p_schools, p_year_levels, p_programs, p_statuses, p_sdp, p_grades) t
  group by t.sub;
end;
$$;
revoke all on function public.renewal_tab_counts(text, text, text, text, uuid[], text[], text[], text[], text, text) from public, anon;
grant execute on function public.renewal_tab_counts(text, text, text, text, uuid[], text[], text[], text[], text, text) to authenticated;


-- 6. The filter options of the three lists, and the Scholar List (its page, its school table and its options): the same answers, the window question asked once.
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
      where s.scholar_id_number in (select m.sid from public._renewal_window_members(p_school_year, p_term) m)
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
    and s.status not in ('Removed', 'On leave') and s.scholar_id_number in (select m.sid from public._renewal_window_members(p_school_year, p_term) m)
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
    and s.status not in ('Removed', 'On leave') and s.scholar_id_number in (select m.sid from public._renewal_window_members(p_school_year, p_term) m)
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
      where s.status not in ('Removed', 'On leave') and s.scholar_id_number in (select m.sid from public._renewal_window_members(p_school_year, p_term) m)
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

notify pgrst, 'reload schema';
