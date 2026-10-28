-- ─────────────────────────────────────────────────────────────
-- SDP RECONSIDERATION, FILE B of 3: the SDP counting rules.   Safe to run twice.   Undo: undo_sdp_reconsideration_b.sql
-- Run AFTER supabase_migration_sdp_reconsideration_a_tables.sql, and AFTER the SDP Monitoring files (Phase 1, 2, 2b) and the renewal files (Phase 1).
--
-- Two rules are added to how SDP credits are counted, in ONE place each (every screen that counts credits uses these functions):
--   1. An APPROVED SDP reconsideration makes the scholar count as COMPLIED for the semester the request was about ("treated as compliant for the current semester").
--   2. The credits that were lacking become part of the NEXT semester's requirement: a category needs 3 PLUS what the scholar owes for that semester. Credit used to
--      pay what is owed is not also carried on to the semester after (the carry-over counts only what is above the requirement).
-- Same answers as before for every scholar who has no approved reconsideration. Replaces six functions (the originals are in the undo file) and adds three small ones.
-- No table is changed. Nothing is deleted.
-- ─────────────────────────────────────────────────────────────

-- The semester that counts after a given one (Summer has no SDP requirement): 1st Semester -> 2nd Semester of the same year; 2nd Semester -> 1st Semester of the next year.
create or replace function public._sdp_next_semester(p_school_year text, p_semester text)
returns table(school_year text, semester text)
language sql
immutable
as $$
  select case when p_semester ilike '1st%' then p_school_year
              else (split_part(p_school_year, '-', 1)::integer + 1)::text || '-' || (split_part(p_school_year, '-', 2)::integer + 1)::text end,
         case when p_semester ilike '1st%' then '2nd Semester' else '1st Semester' end;
$$;
revoke all on function public._sdp_next_semester(text, text) from public, anon, authenticated;

-- What a scholar needs in each category for a semester (3, plus what is owed for it), as {"community_service": 3, ...}.
create or replace function public._sdp_required_map(p_scholar_id_number text, p_school_year text, p_semester text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'community_service', public.sdp_category_credit_required() + coalesce(sum(d.amount) filter (where d.category = 'community_service'), 0),
    'community_volunteerism', public.sdp_category_credit_required() + coalesce(sum(d.amount) filter (where d.category = 'community_volunteerism'), 0),
    'formation_program', public.sdp_category_credit_required() + coalesce(sum(d.amount) filter (where d.category = 'formation_program'), 0))
  from public.sdp_reconsideration_debts d
  where d.scholar_id_number = p_scholar_id_number and d.apply_school_year = p_school_year and d.apply_semester = p_semester;
$$;
revoke all on function public._sdp_required_map(text, text, text) from public, anon, authenticated;

-- The scholar's own SDP tab: what is needed in each category for the CURRENT grading period (3, plus what is owed).
create or replace function public.fetch_scholar_sdp_requirements()
returns table(category text, required integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_scholar text;
  v_year text;
  v_sem text;
  m jsonb;
begin
  select s.scholar_id_number into v_scholar from public.scholars s where s.id = auth.uid();
  if v_scholar is null then raise exception 'Only signed-in scholars can view SDP progress.'; end if;
  select gps.current_school_year, gps.current_semester into v_year, v_sem from public.grading_period_settings gps where gps.id = true;
  m := public._sdp_required_map(v_scholar, v_year, v_sem);
  return query select k, (m ->> k)::integer from unnest(array['community_service', 'community_volunteerism', 'formation_program']) k;
end;
$$;
revoke all on function public.fetch_scholar_sdp_requirements() from public, anon;
grant execute on function public.fetch_scholar_sdp_requirements() to authenticated;

create or replace function public._sdp_period_totals(p_school_year text, p_semester text, p_scholar_id_number text default null)
returns table(scholar_id_number text, category text, total integer)
language sql
stable
security definer
set search_path = public
as $$
  with recursive
  all_periods as (
    select a.school_year, a.semester from public.sdp_attendance a
      where a.school_year is not null and a.semester is not null
    union
    select rc.source_school_year, rc.source_semester from public.sdp_reserved_credits rc
      where rc.source_school_year is not null and rc.source_semester is not null
    union
    select d.apply_school_year, d.apply_semester from public.sdp_reconsideration_debts d
    union
    select p_school_year, p_semester
  ),
  periods as (
    select ap.school_year, ap.semester,
      row_number() over (
        order by ap.school_year,
          case when ap.semester ilike '1st%' then 1 when ap.semester ilike '2nd%' then 2 when ap.semester ilike 'summer%' then 3 else 4 end,
          ap.semester
      )::integer as rn
    from all_periods ap
  ),
  target as (
    select pr.rn from periods pr where pr.school_year = p_school_year and pr.semester = p_semester
  ),
  -- credits a scholar OWES for a semester (an approved SDP reconsideration of the semester before): part of that semester's requirement, so credit used to pay it is not carried on
  debts as (
    select d.scholar_id_number, d.category, pr.rn, sum(d.amount)::integer as amt
    from public.sdp_reconsideration_debts d
    join periods pr on pr.school_year = d.apply_school_year and pr.semester = d.apply_semester
    where (p_scholar_id_number is null or d.scholar_id_number = p_scholar_id_number)
    group by d.scholar_id_number, d.category, pr.rn
  ),
  earned as (
    select x.scholar_id_number, x.category, pr.rn, sum(x.amt)::integer as amt
    from (
      select a.scholar_id_number, act.category, a.school_year, a.semester, act.credits::integer as amt
      from public.sdp_attendance a
      join public.sdp_activities act on act.id = a.activity_id
      where a.school_year is not null and a.semester is not null and act.category is not null
        and (p_scholar_id_number is null or a.scholar_id_number = p_scholar_id_number)
      union all
      select rc.scholar_id_number, rc.category, rc.source_school_year, rc.source_semester, rc.amount
      from public.sdp_reserved_credits rc
      where rc.source_school_year is not null and rc.source_semester is not null
        and (p_scholar_id_number is null or rc.scholar_id_number = p_scholar_id_number)
    ) x
    join periods pr on pr.school_year = x.school_year and pr.semester = x.semester
    where pr.rn <= (select t.rn from target t)
    group by x.scholar_id_number, x.category, pr.rn
  ),
  pairs as (
    select distinct e.scholar_id_number, e.category from earned e
  ),
  chain as (
    select p.scholar_id_number, p.category, 1 as rn,
      coalesce(e1.amt, 0) as total
    from pairs p
    left join earned e1 on e1.scholar_id_number = p.scholar_id_number and e1.category = p.category and e1.rn = 1
    union all
    select c.scholar_id_number, c.category, c.rn + 1,
      coalesce(e.amt, 0) + greatest(0, c.total - (public.sdp_category_credit_required() + coalesce(dd.amt, 0)))
    from chain c
    left join debts dd on dd.scholar_id_number = c.scholar_id_number and dd.category = c.category and dd.rn = c.rn
    left join earned e on e.scholar_id_number = c.scholar_id_number and e.category = c.category and e.rn = c.rn + 1
    where c.rn < (select t.rn from target t)
  )
  select c.scholar_id_number, c.category, c.total::integer
  from chain c
  where c.rn = (select t.rn from target t) and c.total > 0;
$$;

create or replace function public._sdp_period_totals_ids(p_school_year text, p_semester text, p_ids text[])
returns table(scholar_id_number text, category text, total integer)
language sql
stable
security definer
set search_path = public
as $$
  with recursive
  all_periods as (
    select a.school_year, a.semester from public.sdp_attendance a
      where a.school_year is not null and a.semester is not null
    union
    select rc.source_school_year, rc.source_semester from public.sdp_reserved_credits rc
      where rc.source_school_year is not null and rc.source_semester is not null
    union
    select d.apply_school_year, d.apply_semester from public.sdp_reconsideration_debts d
    union
    select p_school_year, p_semester
  ),
  periods as (
    select ap.school_year, ap.semester,
      row_number() over (
        order by ap.school_year,
          case when ap.semester ilike '1st%' then 1 when ap.semester ilike '2nd%' then 2 when ap.semester ilike 'summer%' then 3 else 4 end,
          ap.semester
      )::integer as rn
    from all_periods ap
  ),
  target as (
    select pr.rn from periods pr where pr.school_year = p_school_year and pr.semester = p_semester
  ),
  -- credits a scholar OWES for a semester (an approved SDP reconsideration of the semester before): part of that semester's requirement, so credit used to pay it is not carried on
  debts as (
    select d.scholar_id_number, d.category, pr.rn, sum(d.amount)::integer as amt
    from public.sdp_reconsideration_debts d
    join periods pr on pr.school_year = d.apply_school_year and pr.semester = d.apply_semester
    where (p_ids is null or d.scholar_id_number = any(p_ids))
    group by d.scholar_id_number, d.category, pr.rn
  ),
  -- Added up per scholar, category and semester BEFORE the semesters are matched (fewer rows to carry along).
  earned as (
    select x.scholar_id_number, x.category, x.rn, sum(x.amt)::integer as amt
    from (
      select a.scholar_id_number, act.category, pr.rn, sum(act.credits::integer) as amt
      from public.sdp_attendance a
      join public.sdp_activities act on act.id = a.activity_id
      join periods pr on pr.school_year = a.school_year and pr.semester = a.semester
      where act.category is not null and pr.rn <= (select t.rn from target t) and (p_ids is null or a.scholar_id_number = any(p_ids))
      group by a.scholar_id_number, act.category, pr.rn
      union all
      select rc.scholar_id_number, rc.category, pr.rn, sum(rc.amount)
      from public.sdp_reserved_credits rc
      join periods pr on pr.school_year = rc.source_school_year and pr.semester = rc.source_semester
      where pr.rn <= (select t.rn from target t) and (p_ids is null or rc.scholar_id_number = any(p_ids))
      group by rc.scholar_id_number, rc.category, pr.rn
    ) x
    group by x.scholar_id_number, x.category, x.rn
  ),
  pairs as (
    select distinct e.scholar_id_number, e.category from earned e
  ),
  chain as (
    select p.scholar_id_number, p.category, 1 as rn,
      coalesce(e1.amt, 0) as total
    from pairs p
    left join earned e1 on e1.scholar_id_number = p.scholar_id_number and e1.category = p.category and e1.rn = 1
    union all
    select c.scholar_id_number, c.category, c.rn + 1,
      coalesce(e.amt, 0) + greatest(0, c.total - (public.sdp_category_credit_required() + coalesce(dd.amt, 0)))
    from chain c
    left join debts dd on dd.scholar_id_number = c.scholar_id_number and dd.category = c.category and dd.rn = c.rn
    left join earned e on e.scholar_id_number = c.scholar_id_number and e.category = c.category and e.rn = c.rn + 1
    where c.rn < (select t.rn from target t)
  )
  select c.scholar_id_number, c.category, c.total::integer
  from chain c
  where c.rn = (select t.rn from target t) and c.total > 0;
$$;
revoke all on function public._sdp_period_totals_ids(text, text, text[]) from public, anon, authenticated;

create or replace function public._sdp_compliance(p_school_year text, p_semester text, p_scholar_id_number text default null)
returns table(
  scholar_id_number text, community_service integer, community_volunteerism integer, formation_program integer,
  applicable boolean, complied boolean, missing text
)
language sql
stable
security definer
set search_path = public
as $$
  with req as (select public.sdp_category_credit_required() as n, not (coalesce(p_semester, '') ilike 'summer%') as applicable),
  -- credits owed for this semester (from an approved SDP reconsideration of the semester before), per category
  extra as (
    select d.scholar_id_number,
      sum(d.amount) filter (where d.category = 'community_service')::integer as xs,
      sum(d.amount) filter (where d.category = 'community_volunteerism')::integer as xv,
      sum(d.amount) filter (where d.category = 'formation_program')::integer as xf
    from public.sdp_reconsideration_debts d where d.apply_school_year = p_school_year and d.apply_semester = p_semester group by d.scholar_id_number
  ),
  -- scholars whose SDP reconsideration for this semester was approved: treated as complied for it
  appr as (
    select distinct r.scholar_id_number from public.sdp_reconsideration_requests r where r.status = 'approved' and r.basis_school_year = p_school_year and r.basis_term = p_semester
  ),
  totals as (
    select t.scholar_id_number,
      sum(t.total) filter (where t.category = 'community_service')::integer as cs,
      sum(t.total) filter (where t.category = 'community_volunteerism')::integer as cv,
      sum(t.total) filter (where t.category = 'formation_program')::integer as fp
    from public._sdp_period_totals(p_school_year, p_semester, p_scholar_id_number) t
    group by t.scholar_id_number
  ),
  base as (
    select s.scholar_id_number, coalesce(tt.cs, 0) as cs, coalesce(tt.cv, 0) as cv, coalesce(tt.fp, 0) as fp,
    coalesce(x.xs, 0) as xs, coalesce(x.xv, 0) as xv, coalesce(x.xf, 0) as xf, (ap.scholar_id_number is not null) as approved
    from public.scholars s
    left join totals tt on tt.scholar_id_number = s.scholar_id_number
    left join extra x on x.scholar_id_number = s.scholar_id_number
    left join appr ap on ap.scholar_id_number = s.scholar_id_number
    where s.status <> 'Removed' and (p_scholar_id_number is null or s.scholar_id_number = p_scholar_id_number)
  )
  select b.scholar_id_number, b.cs, b.cv, b.fp, r.applicable,
    case when r.applicable then ((b.cs >= r.n + b.xs and b.cv >= r.n + b.xv and b.fp >= r.n + b.xf) or b.approved) else null end,
    case when not r.applicable then 'Not required for Summer'
         else nullif(concat_ws('; ',
           case when b.cs < r.n + b.xs then 'Institutional Volunteerism: ' || b.cs || ' of ' || (r.n + b.xs) end,
           case when b.cv < r.n + b.xv then 'Community Volunteerism: ' || b.cv || ' of ' || (r.n + b.xv) end,
           case when b.fp < r.n + b.xf then 'Formation Program: ' || b.fp || ' of ' || (r.n + b.xf) end), '') end
  from base b cross join req r;
$$;
revoke all on function public._sdp_compliance(text, text, text) from public, anon, authenticated;

create or replace function public._sdp_compliance_ids(p_school_year text, p_semester text, p_ids text[])
returns table(
  scholar_id_number text, community_service integer, community_volunteerism integer, formation_program integer,
  applicable boolean, complied boolean, missing text
)
language sql
stable
security definer
set search_path = public
as $$
  with req as (select public.sdp_category_credit_required() as n, not (coalesce(p_semester, '') ilike 'summer%') as applicable),
  -- credits owed for this semester (from an approved SDP reconsideration of the semester before), per category
  extra as (
    select d.scholar_id_number,
      sum(d.amount) filter (where d.category = 'community_service')::integer as xs,
      sum(d.amount) filter (where d.category = 'community_volunteerism')::integer as xv,
      sum(d.amount) filter (where d.category = 'formation_program')::integer as xf
    from public.sdp_reconsideration_debts d where d.apply_school_year = p_school_year and d.apply_semester = p_semester group by d.scholar_id_number
  ),
  -- scholars whose SDP reconsideration for this semester was approved: treated as complied for it
  appr as (
    select distinct r.scholar_id_number from public.sdp_reconsideration_requests r where r.status = 'approved' and r.basis_school_year = p_school_year and r.basis_term = p_semester
  ),
  totals as (
    select t.scholar_id_number,
      sum(t.total) filter (where t.category = 'community_service')::integer as cs,
      sum(t.total) filter (where t.category = 'community_volunteerism')::integer as cv,
      sum(t.total) filter (where t.category = 'formation_program')::integer as fp
    from public._sdp_period_totals_ids(p_school_year, p_semester, p_ids) t
    group by t.scholar_id_number
  ),
  base as (
    select s.scholar_id_number, coalesce(tt.cs, 0) as cs, coalesce(tt.cv, 0) as cv, coalesce(tt.fp, 0) as fp,
    coalesce(x.xs, 0) as xs, coalesce(x.xv, 0) as xv, coalesce(x.xf, 0) as xf, (ap.scholar_id_number is not null) as approved
    from public.scholars s
    left join totals tt on tt.scholar_id_number = s.scholar_id_number
    left join extra x on x.scholar_id_number = s.scholar_id_number
    left join appr ap on ap.scholar_id_number = s.scholar_id_number
    where s.status <> 'Removed' and (p_ids is null or s.scholar_id_number = any(p_ids))
  )
  select b.scholar_id_number, b.cs, b.cv, b.fp, r.applicable,
    case when r.applicable then ((b.cs >= r.n + b.xs and b.cv >= r.n + b.xv and b.fp >= r.n + b.xf) or b.approved) else null end,
    case when not r.applicable then 'Not required for Summer'
         else nullif(concat_ws('; ',
           case when b.cs < r.n + b.xs then 'Institutional Volunteerism: ' || b.cs || ' of ' || (r.n + b.xs) end,
           case when b.cv < r.n + b.xv then 'Community Volunteerism: ' || b.cv || ' of ' || (r.n + b.xv) end,
           case when b.fp < r.n + b.xf then 'Formation Program: ' || b.fp || ' of ' || (r.n + b.xf) end), '') end
  from base b cross join req r;
$$;
revoke all on function public._sdp_compliance_ids(text, text, text[]) from public, anon, authenticated;

create or replace function public._sdp_compliance_saved(p_school_year text, p_semester text)
returns table(
  scholar_id_number text, community_service integer, community_volunteerism integer, formation_program integer,
  applicable boolean, complied boolean, missing text
)
language sql
stable
security definer
set search_path = public
as $$
  with req as (select public.sdp_category_credit_required() as n, not (coalesce(p_semester, '') ilike 'summer%') as applicable),
  -- credits owed for this semester (from an approved SDP reconsideration of the semester before), per category
  extra as (
    select d.scholar_id_number,
      sum(d.amount) filter (where d.category = 'community_service')::integer as xs,
      sum(d.amount) filter (where d.category = 'community_volunteerism')::integer as xv,
      sum(d.amount) filter (where d.category = 'formation_program')::integer as xf
    from public.sdp_reconsideration_debts d where d.apply_school_year = p_school_year and d.apply_semester = p_semester group by d.scholar_id_number
  ),
  -- scholars whose SDP reconsideration for this semester was approved: treated as complied for it
  appr as (
    select distinct r.scholar_id_number from public.sdp_reconsideration_requests r where r.status = 'approved' and r.basis_school_year = p_school_year and r.basis_term = p_semester
  ),
  totals as (
    select v.scholar_id_number, v.community_service as cs, v.community_volunteerism as cv, v.formation_program as fp
    from public.sdp_checklist_saved v where v.school_year = p_school_year and v.semester = p_semester
  ),
  base as (
    select s.scholar_id_number, coalesce(tt.cs, 0) as cs, coalesce(tt.cv, 0) as cv, coalesce(tt.fp, 0) as fp,
    coalesce(x.xs, 0) as xs, coalesce(x.xv, 0) as xv, coalesce(x.xf, 0) as xf, (ap.scholar_id_number is not null) as approved
    from public.scholars s
    left join totals tt on tt.scholar_id_number = s.scholar_id_number
    left join extra x on x.scholar_id_number = s.scholar_id_number
    left join appr ap on ap.scholar_id_number = s.scholar_id_number
    where s.status <> 'Removed'
  )
  select b.scholar_id_number, b.cs, b.cv, b.fp, r.applicable,
    case when r.applicable then ((b.cs >= r.n + b.xs and b.cv >= r.n + b.xv and b.fp >= r.n + b.xf) or b.approved) else null end,
    case when not r.applicable then 'Not required for Summer'
         else nullif(concat_ws('; ',
           case when b.cs < r.n + b.xs then 'Institutional Volunteerism: ' || b.cs || ' of ' || (r.n + b.xs) end,
           case when b.cv < r.n + b.xv then 'Community Volunteerism: ' || b.cv || ' of ' || (r.n + b.xv) end,
           case when b.fp < r.n + b.xf then 'Formation Program: ' || b.fp || ' of ' || (r.n + b.xf) end), '') end
  from base b cross join req r;
$$;
revoke all on function public._sdp_compliance_saved(text, text) from public, anon, authenticated;

create or replace function public._sdp_data_fingerprint()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select (select count(*)::text || ':' || coalesce(sum(hashtext(a.id::text || a.scholar_id_number || a.activity_id::text || coalesce(a.school_year, '') || '/' || coalesce(a.semester, '') || '/' || coalesce(a.occurrence_number::text, ''))::bigint), 0)::text from public.sdp_attendance a)
    || '|' || (select count(*)::text || ':' || coalesce(sum(hashtext(x.id::text || coalesce(x.category, '') || '/' || coalesce(x.credits::text, ''))::bigint), 0)::text from public.sdp_activities x)
    || '|' || (select count(*)::text || ':' || coalesce(sum(hashtext(r.scholar_id_number || coalesce(r.category, '') || '/' || coalesce(r.amount::text, '') || '/' || coalesce(r.source_school_year, '') || '/' || coalesce(r.source_semester, ''))::bigint), 0)::text from public.sdp_reserved_credits r)
    || '|' || (select count(*)::text || ':' || coalesce(sum(hashtext(d.id::text || d.scholar_id_number || d.category || '/' || d.amount::text || '/' || d.apply_school_year || '/' || d.apply_semester)::bigint), 0)::text from public.sdp_reconsideration_debts d);
$$;
revoke all on function public._sdp_data_fingerprint() from public, anon, authenticated;

notify pgrst, 'reload schema';
