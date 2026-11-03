-- ─────────────────────────────────────────────────────────────
-- SCHOOL PORTAL: THE RENEWAL TAB (where the school's scholars are in the renewal).   Safe to run twice.   Undo: undo_school_renewal_tab.sql
-- Run AFTER supabase_migration_school_student_no.sql, supabase_migration_renewal_tabs.sql and the renewal files (window schools).
--
-- Adds three read-only functions. A school account can ask about ITS OWN scholars only, and gets only: who they are, the scholarship status, where the renewal is, and the grade
-- result (failed / INC). No SDP details, no consultation or Division Head details, no staff notes.
--   * school_renewal_windows(): the renewal windows that apply to the school.
--   * school_renewal_list(school year, term): every scholar of the school in that renewal, one row each, with the group they are in:
--       applied (being processed), renewed, removed, not applied yet, or not required / late application declined; and whether they are on probation.
--   * school_renewal_summary(school year, term): the numbers for the progress bar.
-- No table is changed. Nothing is deleted.
-- ─────────────────────────────────────────────────────────────

do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'scholars' and column_name = 'school_student_no') then
    raise exception 'STOPPED, nothing changed: run supabase_migration_school_student_no.sql first.';
  end if;
  if to_regprocedure('public._renewal_window_includes(text,text,text)') is null or to_regclass('public.renewal_scholar_list_cache') is null then
    raise exception 'STOPPED, nothing changed: run the renewal files (Scholar List, window schools) first.';
  end if;
end $$;

-- 1. The renewal windows that apply to the school (a window for other schools, or for test accounts only, is not listed).
create or replace function public.school_renewal_windows()
returns table(school_year text, term text, opens_on date, closes_on date, late_allowed boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_school_id();
begin
  if v_school is null or not public.is_school_account() then raise exception 'Only a school account can see its scholars'' renewal.'; end if;
  return query
  select w.school_year, w.term, w.opens_on, w.closes_on, w.late_allowed
  from public.renewal_windows w
  where (coalesce(cardinality(w.school_ids), 0) = 0 or v_school = any (w.school_ids))
    and (w.testers is null or exists (select 1 from public.scholars s where s.school_id = v_school and s.scholar_id_number = any (w.testers)))
  order by w.opens_on desc, w.school_year desc;
end;
$$;
revoke all on function public.school_renewal_windows() from public, anon;
grant execute on function public.school_renewal_windows() to authenticated;

-- 2. Every scholar of the school in one renewal, with the group they are in. Used by the two functions below only.
create or replace function public._school_renewal_rows(p_school_year text, p_term text)
returns table(
  scholar_id_number text, school_student_no text, last_name text, first_name text, middle_name text, year_level text, program text,
  scholar_status text, stage text, is_late boolean, grp text, probation boolean, grades_state text, failed integer, inc integer, review integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_school uuid := public.current_school_id();
  v_by text;
  v_bt text;
begin
  if v_school is null or not public.is_school_account() then raise exception 'Only a school account can see its scholars'' renewal.'; end if;
  select b.basis_school_year, b.basis_term into v_by, v_bt from public._renewal_basis(p_school_year, p_term) b;
  return query
  with joined as (
    select s.scholar_id_number as sid, s.school_student_no as sno, s.last_name as ln, s.first_name as fn, s.middle_name as mn, s.year_level as yl, s.course as prog, s.status as st,
           r.id as rid, r.stage as rstage, coalesce(r.is_late, false) as rlate,
           (r.id is not null and r.evaluation <> '{}'::jsonb) as live, r.evaluation as ev,
           c.scholar_id_number as c_sid, c.grades_state as c_state, c.failed as c_failed, c.drp as c_drp, c.inc as c_inc, c.review as c_review,
           own.total as o_total, own.ungraded as o_ungraded, own.failed as o_failed, own.inc as o_inc, own.review as o_review
    from public.scholars s
    left join public.renewal_records r on r.scholar_id_number = s.scholar_id_number and r.school_year = p_school_year and r.term = p_term
    left join public.renewal_scholar_list_cache c on c.scholar_id_number = s.scholar_id_number and c.school_year = p_school_year and c.term = p_term
    -- a scholar CEDO has not checked yet (no application evaluated, no saved check): the result comes from the grades the school itself saved for the semester that is judged
    left join lateral (
      select count(*)::integer as total, (count(*) filter (where x.o = 'ungraded'))::integer as ungraded, (count(*) filter (where x.o in ('failed', 'drp')))::integer as failed,
             (count(*) filter (where x.o = 'inc'))::integer as inc, (count(*) filter (where x.o not in ('passed', 'failed', 'drp', 'inc', 'ungraded')))::integer as review
      from (select public._grade_outcome(s.school_id, g.grade) as o from public.scholar_subjects_grades g
            where g.scholar_id_number = s.scholar_id_number and g.school_year = v_by and g.semester = v_bt) x
      where (r.id is null or r.evaluation = '{}'::jsonb) and c.scholar_id_number is null
    ) own on true
    where s.school_id = v_school
      and public._renewal_window_includes(p_school_year, p_term, s.scholar_id_number)
      and (s.status not in ('Removed', 'On leave') or r.id is not null)
  )
  select j.sid, j.sno, j.ln, j.fn, j.mn, j.yl, j.prog, j.st, j.rstage, j.rlate,
         case when j.st = 'Removed' or j.rstage = 'removed' then 'removed'
              when j.rstage = 'renewed' then 'renewed'
              when j.rstage in ('late_declined', 'not_required') then 'not_required'
              when j.rid is not null then 'in_process'
              else 'not_applied' end,
         (j.st = 'Probationary'),
         case when j.live then j.ev -> 'grades' ->> 'state' when j.c_sid is not null then j.c_state
              when j.o_total is null then null
              else case when j.o_total = 0 then 'no_grades' when j.o_ungraded > 0 then 'waiting' when j.o_review > 0 then 'review' else 'ready' end end,
         -- failed subjects counted for the renewal (a DRP included), and INCs still open: the same rules as the evaluator's lists
         (case when j.live then coalesce((j.ev ->> 'failed_effective')::integer, (j.ev -> 'grades' -> 'counts' ->> 'failed')::integer, 0) when j.c_sid is not null then coalesce(j.c_failed, 0) + coalesce(j.c_drp, 0) else coalesce(j.o_failed, 0) end)::integer,
         (case when j.live then coalesce((j.ev ->> 'open_inc')::integer, 0) when j.c_sid is not null then coalesce(j.c_inc, 0) else coalesce(j.o_inc, 0) end)::integer,
         (case when j.live then coalesce((j.ev -> 'grades' -> 'counts' ->> 'review')::integer, 0) when j.c_sid is not null then coalesce(j.c_review, 0) else coalesce(j.o_review, 0) end)::integer
  from joined j;
end;
$$;
revoke all on function public._school_renewal_rows(text, text) from public, anon, authenticated;

create or replace function public.school_renewal_list(p_school_year text, p_term text)
returns table(
  scholar_id_number text, school_student_no text, last_name text, first_name text, middle_name text, year_level text, program text,
  scholar_status text, stage text, is_late boolean, grp text, probation boolean, grades_state text, failed integer, inc integer, review integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.current_school_id() is null or not public.is_school_account() then raise exception 'Only a school account can see its scholars'' renewal.'; end if;
  return query select * from public._school_renewal_rows(p_school_year, p_term) r order by lower(r.last_name), lower(r.first_name), r.scholar_id_number limit 5000;
end;
$$;
revoke all on function public.school_renewal_list(text, text) from public, anon;
grant execute on function public.school_renewal_list(text, text) to authenticated;

-- 3. The numbers for the progress bar, and the semester the grades are judged for.
create or replace function public.school_renewal_summary(p_school_year text, p_term text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_b record;
  v jsonb;
begin
  if public.current_school_id() is null or not public.is_school_account() then raise exception 'Only a school account can see its scholars'' renewal.'; end if;
  select * into v_b from public._renewal_basis(p_school_year, p_term);
  select jsonb_build_object(
    'total', count(*),
    'applied', count(*) filter (where r.grp = 'in_process'),
    'renewed', count(*) filter (where r.grp = 'renewed'),
    'removed', count(*) filter (where r.grp = 'removed'),
    'not_applied', count(*) filter (where r.grp = 'not_applied'),
    'not_required', count(*) filter (where r.grp = 'not_required'),
    'probation', count(*) filter (where r.probation),
    'with_inc_or_failed', count(*) filter (where (r.failed > 0 or r.inc > 0) and r.grp <> 'removed'))
  into v from public._school_renewal_rows(p_school_year, p_term) r;
  return v || jsonb_build_object('basis_school_year', v_b.basis_school_year, 'basis_term', v_b.basis_term);
end;
$$;
revoke all on function public.school_renewal_summary(text, text) from public, anon;
grant execute on function public.school_renewal_summary(text, text) to authenticated;

notify pgrst, 'reload schema';
