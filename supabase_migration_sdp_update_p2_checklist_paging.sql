-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 2: the SDP Checklist asks the database for ONE PAGE at a time.   Safe to re-run.   Undo: undo_sdp_update_p2.sql
--
-- Before: the website downloaded the result for every scholar (the database worked out all of them), then searched, sorted, filtered and paged in
-- the browser. Now the database does the searching, sorting, filtering and paging, and works out the SDP result only for the 50 scholars on the
-- page. The three counts (All / Complied / Not complied) come from one small separate question that fills in right after the page appears.
-- The answers are the same as the old function (scholars_sdp_compliance), which stays in place and is still used by Renewal and as a fallback.
-- Only ADDS functions; nothing existing is changed or deleted.
-- ─────────────────────────────────────────────────────────────

-- Same calculation as _sdp_period_totals, but for a list of scholars (or everyone when the list is empty/null).
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

-- Same result rules as _sdp_compliance, for a list of scholars.
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

-- One page of the Checklist. Search = part of the name or Scholar ID (capitals do not matter). Filter = all | complied | not_complied.
-- Sort = default | id | name | community_service | community_volunteerism | formation_program | result; direction asc | desc. Ties keep the
-- usual order (last name, first name, Scholar ID). total_count = how many scholars match the search and filter (for the page buttons).
create or replace function public.scholars_sdp_checklist_page(
  p_school_year text, p_semester text, p_search text default '', p_filter text default 'all',
  p_sort text default 'default', p_dir text default 'asc', p_page integer default 1, p_page_size integer default 50
)
returns table(
  scholar_id_number text, name text,
  community_service integer, community_volunteerism integer, formation_program integer,
  applicable boolean, complied boolean, missing text, total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := lower(btrim(coalesce(p_search, '')));
  v_size integer := least(greatest(coalesce(p_page_size, 50), 1), 200);
  v_off integer := (greatest(coalesce(p_page, 1), 1) - 1) * v_size;
  v_dir text := case when lower(coalesce(p_dir, 'asc')) = 'desc' then 'desc' else 'asc' end;
  v_filter text := coalesce(p_filter, 'all');
  v_sort text := coalesce(p_sort, 'default');
  v_order text;
  v_tie text;
  v_where text;
begin
  if not public.has_staff_tag('sdp_monitoring') then
    raise exception 'Not authorized to view the SDP checklist.';
  end if;
  if v_filter not in ('all', 'complied', 'not_complied') then raise exception 'Unknown filter.'; end if;
  if v_sort not in ('default', 'id', 'name', 'community_service', 'community_volunteerism', 'formation_program', 'result') then raise exception 'Unknown sort.'; end if;
  if v_sort = 'default' then v_dir := 'asc'; end if;

  -- "@" stands for the table name; it is replaced below. Only fixed text is put together here, never the caller's text.
  v_tie := format('@.last_name %1$s, @.first_name %1$s, @.sid %1$s', v_dir);
  v_order := case v_sort
    when 'id' then format('lower(@.sid) %s, ', v_dir) || v_tie
    when 'name' then format('lower(@.nm) %s, ', v_dir) || v_tie
    when 'community_service' then format('@.community_service %s, ', v_dir) || v_tie
    when 'community_volunteerism' then format('@.community_volunteerism %s, ', v_dir) || v_tie
    when 'formation_program' then format('@.formation_program %s, ', v_dir) || v_tie
    when 'result' then format('(case when @.complied is null then 2 when @.complied then 1 else 0 end) %s, ', v_dir) || v_tie
    else v_tie
  end;
  v_where := case v_filter when 'complied' then 'and c.complied is true' when 'not_complied' then 'and c.complied is false' else '' end;

  if v_filter = 'all' and v_sort in ('default', 'id', 'name') then
    -- Fast way: choose the page of scholars first, then work out the SDP result for only those scholars.
    return query execute
      'with matched as (
         select s.scholar_id_number as sid, s.first_name, s.last_name, s.first_name || '' '' || s.last_name as nm
         from public.scholars s
         where s.status <> ''Removed''
           and ($1 = '''' or position($1 in lower(s.first_name || '' '' || s.last_name)) > 0 or position($1 in lower(s.scholar_id_number)) > 0)
       ), pg as (
         select m.*, count(*) over () as total from matched m order by ' || replace(v_order, '@', 'm') || ' limit $2 offset $3
       ), comp as (
         select * from public._sdp_compliance_ids($4, $5, coalesce((select array_agg(pg2.sid) from pg pg2), ''{}''::text[]))
       )
       select pg.sid, pg.nm, c.community_service, c.community_volunteerism, c.formation_program, c.applicable, c.complied, c.missing, pg.total
       from pg join comp c on c.scholar_id_number = pg.sid
       order by ' || replace(v_order, '@', 'pg')
    using v_q, v_size, v_off, p_school_year, p_semester;
  else
    -- The filter or the sort depends on the result itself, so it is worked out for everyone, then filtered, sorted and cut to the page.
    return query execute
      'with comp as (select * from public._sdp_compliance_ids($4, $5, null)),
       base as (
         select c.scholar_id_number as sid, s.first_name, s.last_name, s.first_name || '' '' || s.last_name as nm,
                c.community_service, c.community_volunteerism, c.formation_program, c.applicable, c.complied, c.missing
         from comp c join public.scholars s on s.scholar_id_number = c.scholar_id_number
         where ($1 = '''' or position($1 in lower(s.first_name || '' '' || s.last_name)) > 0 or position($1 in lower(s.scholar_id_number)) > 0) ' || v_where || '
       )
       select b.sid, b.nm, b.community_service, b.community_volunteerism, b.formation_program, b.applicable, b.complied, b.missing, count(*) over ()
       from base b order by ' || replace(v_order, '@', 'b') || ' limit $2 offset $3'
    using v_q, v_size, v_off, p_school_year, p_semester;
  end if;
end;
$$;
revoke all on function public.scholars_sdp_checklist_page(text, text, text, text, text, text, integer, integer) from public, anon;
grant execute on function public.scholars_sdp_checklist_page(text, text, text, text, text, text, integer, integer) to authenticated;

-- The three counts for the chosen semester: everyone, complied, not complied (all zero for Summer, which has no requirement).
create or replace function public.scholars_sdp_checklist_summary(p_school_year text, p_semester text)
returns table(total bigint, complied bigint, not_complied bigint, applicable boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_staff_tag('sdp_monitoring') then
    raise exception 'Not authorized to view the SDP checklist.';
  end if;
  return query
  select count(*), count(*) filter (where c.complied is true), count(*) filter (where c.complied is false),
         not (coalesce(p_semester, '') ilike 'summer%')
  from public._sdp_compliance_ids(p_school_year, p_semester, null) c;
end;
$$;
revoke all on function public.scholars_sdp_checklist_summary(text, text) from public, anon;
grant execute on function public.scholars_sdp_checklist_summary(text, text) to authenticated;

notify pgrst, 'reload schema';
