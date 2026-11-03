-- ─────────────────────────────────────────────────────────────
-- SCHOLAR RENEWAL: THE THREE LISTS (APPLICATIONS, RENEWED, NOT APPLIED) WITH THEIR SUB-TABS.   Safe to run twice.   Undo: undo_renewal_tabs.sql
-- Run AFTER supabase_migration_renewal_actions_needed.sql (and the files it needs). It only READS: it adds three functions (and one that the two public ones share). No table is changed.
-- Nothing is deleted.
--
--   Applications  everybody who applied for the term and is not renewed yet (late applications and returned ones are here too; removed, "late declined" and "not required" are not).
--   Renewed       the applications that were confirmed, with the scholar's status before and after.
--   Not applied   the scholars who can renew in the term and have no application (a "not required" mark counts as one).
--   Sub-tabs of Applications and Not applied, by the grades of the semester the renewal looks at, WORST FIRST (each scholar is in one sub-tab only):
--        failed2     2 or more failed subjects (a DRP counts as failed)
--        failed1     1 failed subject (also when there is an INC as well)
--        inc         an open INC and nothing failed
--        pending     the grades are not all in yet (waiting, none recorded, or a mark that needs review)
--        complete    everything passed
--   Sub-tabs of Renewed: regular / probationary / reconsidered (by the scholar's status now; a case the Division Head reconsidered is "reconsidered").
--   For an application the grades and the SDP are the ones the application's own check saved (always up to date); for a scholar who has not applied they are the saved result of the Scholar List's
--   check ("Refresh" on the page), and a scholar who has not been checked yet is in "pending".
-- ─────────────────────────────────────────────────────────────

do $$ begin
  if to_regprocedure('public.can_view_renewal_list()') is null or to_regprocedure('public.renewal_scholar_actions(text,text,text[])') is null then
    raise exception 'STOPPED, nothing changed: run supabase_migration_renewal_actions_needed.sql first.';
  end if;
end $$;

-- The scholars of one tab with everything the list shows, after the filters, with the sub-tab each one belongs to. Used by the two functions below only.
create or replace function public._renewal_tab_rows(
  p_school_year text, p_term text, p_tab text, p_query text, p_schools uuid[], p_year_levels text[], p_programs text[], p_statuses text[], p_sdp text, p_grades text)
returns table(
  scholar_id_number text, name text, scholar_status text, school_id uuid, school text, year_level text, program text,
  sdp_applicable boolean, sdp_complied boolean, sdp_missing text, sdp_reconsideration text, grades_state text, graded integer, total integer, failed integer, drp integer, inc integer, review integer,
  eligibility text[], computed_at timestamptz, record_id uuid, stage text, is_late boolean, from_status text, to_status text, sub text)
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
      and (coalesce(cardinality(p_schools), 0) = 0 or s.school_id = any (p_schools))
      and (coalesce(cardinality(p_year_levels), 0) = 0 or s.year_level = any (p_year_levels))
      and (coalesce(cardinality(p_programs), 0) = 0 or s.course = any (p_programs))
      and (coalesce(cardinality(p_statuses), 0) = 0 or s.status = any (p_statuses))
      and (v_q is null or s.scholar_id_number ilike '%' || v_q || '%' or (s.first_name || ' ' || s.last_name) ilike '%' || v_q || '%' or (s.last_name || ' ' || s.first_name) ilike '%' || v_q || '%'
           or (s.last_name || ', ' || s.first_name) ilike '%' || v_q || '%')
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
  from sorted z
  where (p_sdp is null or (p_sdp = 'complied' and (not z.app or coalesce(z.comp, false))) or (p_sdp = 'not_complied' and z.app and not coalesce(z.comp, false)))
    and (p_grades is null or (p_grades = 'in' and coalesce(z.gstate, 'waiting') = 'ready' and z.greview = 0) or (p_grades = 'not_in' and (coalesce(z.gstate, 'waiting') <> 'ready' or z.greview > 0)));
end;
$$;
revoke all on function public._renewal_tab_rows(text, text, text, text, uuid[], text[], text[], text[], text, text) from public, anon, authenticated;

-- One page of one sub-tab (p_sub null = the whole tab), ordered by name.
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

-- How many scholars each sub-tab of a tab holds (with the same filters), for the numbers on the sub-tabs.
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

-- The values the filters offer on the three lists: the schools, year levels, programs and scholarship statuses of the scholars in the term.
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

notify pgrst, 'reload schema';
