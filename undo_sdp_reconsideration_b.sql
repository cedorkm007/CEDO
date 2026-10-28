-- UNDO for supabase_migration_sdp_reconsideration_b_sdp_rules.sql: puts the six SDP counting functions back exactly as they were (credits owed and approved
-- reconsiderations then stop counting anywhere). Run it BEFORE undo_sdp_reconsideration_a.sql.
drop function if exists public.fetch_scholar_sdp_requirements();
drop function if exists public._sdp_required_map(text, text, text);

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
      coalesce(e.amt, 0) + greatest(0, c.total - public.sdp_category_credit_required())
    from chain c
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
      coalesce(e.amt, 0) + greatest(0, c.total - public.sdp_category_credit_required())
    from chain c
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
  totals as (
    select t.scholar_id_number,
      sum(t.total) filter (where t.category = 'community_service')::integer as cs,
      sum(t.total) filter (where t.category = 'community_volunteerism')::integer as cv,
      sum(t.total) filter (where t.category = 'formation_program')::integer as fp
    from public._sdp_period_totals(p_school_year, p_semester, p_scholar_id_number) t
    group by t.scholar_id_number
  ),
  base as (
    select s.scholar_id_number, coalesce(tt.cs, 0) as cs, coalesce(tt.cv, 0) as cv, coalesce(tt.fp, 0) as fp
    from public.scholars s
    left join totals tt on tt.scholar_id_number = s.scholar_id_number
    where s.status <> 'Removed' and (p_scholar_id_number is null or s.scholar_id_number = p_scholar_id_number)
  )
  select b.scholar_id_number, b.cs, b.cv, b.fp, r.applicable,
    case when r.applicable then (b.cs >= r.n and b.cv >= r.n and b.fp >= r.n) else null end,
    case when not r.applicable then 'Not required for Summer'
         else nullif(concat_ws('; ',
           case when b.cs < r.n then 'Institutional Volunteerism: ' || b.cs || ' of ' || r.n end,
           case when b.cv < r.n then 'Community Volunteerism: ' || b.cv || ' of ' || r.n end,
           case when b.fp < r.n then 'Formation Program: ' || b.fp || ' of ' || r.n end), '') end
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
  totals as (
    select t.scholar_id_number,
      sum(t.total) filter (where t.category = 'community_service')::integer as cs,
      sum(t.total) filter (where t.category = 'community_volunteerism')::integer as cv,
      sum(t.total) filter (where t.category = 'formation_program')::integer as fp
    from public._sdp_period_totals_ids(p_school_year, p_semester, p_ids) t
    group by t.scholar_id_number
  ),
  base as (
    select s.scholar_id_number, coalesce(tt.cs, 0) as cs, coalesce(tt.cv, 0) as cv, coalesce(tt.fp, 0) as fp
    from public.scholars s
    left join totals tt on tt.scholar_id_number = s.scholar_id_number
    where s.status <> 'Removed' and (p_ids is null or s.scholar_id_number = any(p_ids))
  )
  select b.scholar_id_number, b.cs, b.cv, b.fp, r.applicable,
    case when r.applicable then (b.cs >= r.n and b.cv >= r.n and b.fp >= r.n) else null end,
    case when not r.applicable then 'Not required for Summer'
         else nullif(concat_ws('; ',
           case when b.cs < r.n then 'Institutional Volunteerism: ' || b.cs || ' of ' || r.n end,
           case when b.cv < r.n then 'Community Volunteerism: ' || b.cv || ' of ' || r.n end,
           case when b.fp < r.n then 'Formation Program: ' || b.fp || ' of ' || r.n end), '') end
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
  totals as (
    select v.scholar_id_number, v.community_service as cs, v.community_volunteerism as cv, v.formation_program as fp
    from public.sdp_checklist_saved v where v.school_year = p_school_year and v.semester = p_semester
  ),
  base as (
    select s.scholar_id_number, coalesce(tt.cs, 0) as cs, coalesce(tt.cv, 0) as cv, coalesce(tt.fp, 0) as fp
    from public.scholars s
    left join totals tt on tt.scholar_id_number = s.scholar_id_number
    where s.status <> 'Removed'
  )
  select b.scholar_id_number, b.cs, b.cv, b.fp, r.applicable,
    case when r.applicable then (b.cs >= r.n and b.cv >= r.n and b.fp >= r.n) else null end,
    case when not r.applicable then 'Not required for Summer'
         else nullif(concat_ws('; ',
           case when b.cs < r.n then 'Institutional Volunteerism: ' || b.cs || ' of ' || r.n end,
           case when b.cv < r.n then 'Community Volunteerism: ' || b.cv || ' of ' || r.n end,
           case when b.fp < r.n then 'Formation Program: ' || b.fp || ' of ' || r.n end), '') end
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
    || '|' || (select count(*)::text || ':' || coalesce(sum(hashtext(r.scholar_id_number || coalesce(r.category, '') || '/' || coalesce(r.amount::text, '') || '/' || coalesce(r.source_school_year, '') || '/' || coalesce(r.source_semester, ''))::bigint), 0)::text from public.sdp_reserved_credits r);
$$;
revoke all on function public._sdp_data_fingerprint() from public, anon, authenticated;

drop function if exists public._sdp_next_semester(text, text);
notify pgrst, 'reload schema';
