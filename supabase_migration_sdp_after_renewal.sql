-- ─────────────────────────────────────────────────────────────
-- SDP AFTER RENEWAL: a renewed scholar's SDP shows the NEXT semester's numbers right away (3 credits used per category; what was lacking is added to the requirement).   Safe to run twice.   Undo: undo_sdp_after_renewal.sql
-- Run AFTER the SDP reconsideration files (a to d) and the files of the SDP Monitoring update (Phase 1 to 2b).
--
-- The rules themselves are not new: when a semester ends, 3 credits per category are used for it and only what is ABOVE the requirement carries on, and what an approved SDP
-- reconsideration found lacking is added to the next semester's requirement. Until now a scholar saw the result only once CEDO changed the current grading period to the next
-- semester. Example: 3 / 1 / 3 credits and an approved reconsideration showed 3/3, 1/3, 3/3 after the renewal; now it shows 0/3, 0/5, 0/3 as soon as the scholar is renewed.
--
--   * A scholar who is RENEWED for the semester that is still the current grading period is shown the NEXT semester (see _sdp_view_period). Everyone else is shown the current period as before.
--   * It changes what is SHOWN: the scholar's SDP tab, the staff SDP Checklist (rows, counts, filters) and a new "after renewal" box on the renewal detail page. The renewal's own
--     check (the SDP of the semester that was being renewed) and the saved record of it are not touched.
--   * Replaces functions only: three the scholar's SDP tab reads, three the checklist reads. Adds six small ones. No table is changed. Nothing is deleted.
-- ─────────────────────────────────────────────────────────────

do $$ begin
  if to_regprocedure('public._sdp_next_semester(text,text)') is null or to_regprocedure('public.scholars_sdp_extra_required(text,text)') is null then
    raise exception 'STOPPED, nothing changed: run the SDP reconsideration files (a to d) first.';
  end if;
  if to_regprocedure('public._sdp_compliance_saved(text,text)') is null then
    raise exception 'STOPPED, nothing changed: run the SDP Monitoring update files (Phase 2b) first.';
  end if;
end $$;

-- 1. Which semester a scholar's SDP is shown for: the current grading period, or the next one once the scholar is renewed for the current one.
create or replace function public._sdp_view_period(p_scholar_id_number text)
returns table(school_year text, semester text, shifted boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_year text;
  v_sem text;
begin
  select gps.current_school_year, gps.current_semester into v_year, v_sem from public.grading_period_settings gps where gps.id = true;
  if v_year is null or v_sem is null then return; end if;
  if exists (
    select 1 from public.renewal_records r
    cross join lateral public._renewal_basis(r.school_year, r.term) b
    where r.scholar_id_number = p_scholar_id_number and r.stage = 'renewed' and b.basis_school_year = v_year and b.basis_term = v_sem
  ) then
    return query select n.school_year, n.semester, true from public._sdp_next_semester(v_year, v_sem) n;
  else
    return query select v_year, v_sem, false;
  end if;
end;
$$;
revoke all on function public._sdp_view_period(text) from public, anon, authenticated;

-- The scholars who are shown the next semester for a period: only when that period is the current grading period, and only the scholars renewed for it.
create or replace function public._sdp_advanced_ids(p_school_year text, p_semester text)
returns table(scholar_id_number text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct r.scholar_id_number
  from public.grading_period_settings gps
  join public.renewal_records r on r.stage = 'renewed'
  cross join lateral public._renewal_basis(r.school_year, r.term) b
  where gps.id = true and gps.current_school_year = p_school_year and gps.current_semester = p_semester
    and b.basis_school_year = p_school_year and b.basis_term = p_semester;
$$;
revoke all on function public._sdp_advanced_ids(text, text) from public, anon, authenticated;

-- 2. The scholar's own SDP tab.
create or replace function public.fetch_scholar_sdp_progress()
returns table(category text, credits integer, reserved integer)
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_scholar_id_number text;
  v_school_year text;
  v_semester text;
begin
  select s.scholar_id_number into v_scholar_id_number from public.scholars s where s.id = auth.uid();
  if v_scholar_id_number is null then raise exception 'Only signed-in scholars can view SDP progress.'; end if;
  select vp.school_year, vp.semester into v_school_year, v_semester
    from public._sdp_view_period(v_scholar_id_number) vp;

  return query
  select c.key, coalesce(t.total, 0)::integer, 0::integer
  from (values ('community_service'), ('community_volunteerism'), ('formation_program')) as c(key)
  left join public._sdp_period_totals(v_school_year, v_semester, v_scholar_id_number) t on t.category = c.key;
end;
$function$;
grant execute on function public.fetch_scholar_sdp_progress() to authenticated;
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
  select vp.school_year, vp.semester into v_year, v_sem from public._sdp_view_period(v_scholar) vp;
  m := public._sdp_required_map(v_scholar, v_year, v_sem);
  return query select k, (m ->> k)::integer from unnest(array['community_service', 'community_volunteerism', 'formation_program']) k;
end;
$$;
revoke all on function public.fetch_scholar_sdp_requirements() from public, anon;
grant execute on function public.fetch_scholar_sdp_requirements() to authenticated;
create or replace function public.fetch_scholar_sdp_owed()
returns table(school_year text, semester text, category text, amount integer, is_current boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id text := public.current_scholar_id_number();
  v_year text;
  v_sem text;
  v_rank integer;
begin
  if v_id is null then raise exception 'Only signed-in scholars can view SDP progress.'; end if;
  select vp.school_year, vp.semester into v_year, v_sem from public._sdp_view_period(v_id) vp;
  if v_year is null or v_sem is null then return; end if;
  v_rank := case when v_sem ilike '1st%' then 1 when v_sem ilike '2nd%' then 2 when v_sem ilike 'summer%' then 3 else 4 end;
  return query
  select d.apply_school_year, d.apply_semester, d.category, sum(d.amount)::integer, (d.apply_school_year = v_year and d.apply_semester = v_sem)
  from public.sdp_reconsideration_debts d
  where d.scholar_id_number = v_id
    and (d.apply_school_year > v_year
         or (d.apply_school_year = v_year and (case when d.apply_semester ilike '1st%' then 1 when d.apply_semester ilike '2nd%' then 2 when d.apply_semester ilike 'summer%' then 3 else 4 end) >= v_rank))
  group by d.apply_school_year, d.apply_semester, d.category
  order by d.apply_school_year, (case when d.apply_semester ilike '1st%' then 1 when d.apply_semester ilike '2nd%' then 2 when d.apply_semester ilike 'summer%' then 3 else 4 end), d.category;
end;
$$;
revoke all on function public.fetch_scholar_sdp_owed() from public, anon;
grant execute on function public.fetch_scholar_sdp_owed() to authenticated;

-- What the scholar's tab is showing: the semester, and whether it is the next one because the scholar is renewed.
create or replace function public.fetch_scholar_sdp_view()
returns table(school_year text, semester text, shifted boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id text := public.current_scholar_id_number();
begin
  if v_id is null then raise exception 'Only signed-in scholars can view SDP progress.'; end if;
  return query select vp.school_year, vp.semester, vp.shifted from public._sdp_view_period(v_id) vp;
end;
$$;
revoke all on function public.fetch_scholar_sdp_view() from public, anon;
grant execute on function public.fetch_scholar_sdp_view() to authenticated;

-- 3. The staff SDP Checklist: the rows of the scholars renewed for the current period come from the next semester.
create or replace function public._sdp_compliance_view_ids(p_school_year text, p_semester text, p_ids text[])
returns table(
  scholar_id_number text, community_service integer, community_volunteerism integer, formation_program integer,
  applicable boolean, complied boolean, missing text
)
language sql
stable
security definer
set search_path = public
as $$
  with adv as (select a.scholar_id_number as sid from public._sdp_advanced_ids(p_school_year, p_semester) a where a.scholar_id_number = any (p_ids))
  select c.scholar_id_number, c.community_service, c.community_volunteerism, c.formation_program, c.applicable, c.complied, c.missing
  from public._sdp_compliance_ids(p_school_year, p_semester, array(select x from unnest(p_ids) x where x not in (select sid from adv))) c
  union all
  select c.scholar_id_number, c.community_service, c.community_volunteerism, c.formation_program, c.applicable, c.complied, c.missing
  from public._sdp_next_semester(p_school_year, p_semester) nx
  cross join lateral public._sdp_compliance_ids(nx.school_year, nx.semester, array(select sid from adv)) c
  where exists (select 1 from adv);
$$;
revoke all on function public._sdp_compliance_view_ids(text, text, text[]) from public, anon, authenticated;

-- The saved-totals version (the counts, the Complied / Not complied buttons, sorting): the old function keeps its work under a new name, the new one swaps in the renewed scholars.
create or replace function public._sdp_compliance_saved_plain(p_school_year text, p_semester text)
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
revoke all on function public._sdp_compliance_saved_plain(text, text) from public, anon, authenticated;

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
  with adv as (select a.scholar_id_number as sid from public._sdp_advanced_ids(p_school_year, p_semester) a)
  select p.scholar_id_number, p.community_service, p.community_volunteerism, p.formation_program, p.applicable, p.complied, p.missing
  from public._sdp_compliance_saved_plain(p_school_year, p_semester) p
  where p.scholar_id_number not in (select sid from adv)
  union all
  select c.scholar_id_number, c.community_service, c.community_volunteerism, c.formation_program, c.applicable, c.complied, c.missing
  from public._sdp_next_semester(p_school_year, p_semester) nx
  cross join lateral public._sdp_compliance_ids(nx.school_year, nx.semester, array(select sid from adv)) c
  where exists (select 1 from adv);
$$;
revoke all on function public._sdp_compliance_saved(text, text) from public, anon, authenticated;

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
         select * from public._sdp_compliance_view_ids($4, $5, coalesce((select array_agg(pg2.sid) from pg pg2), ''{}''::text[]))
       )
       select pg.sid, pg.nm, c.community_service, c.community_volunteerism, c.formation_program, c.applicable, c.complied, c.missing, pg.total
       from pg join comp c on c.scholar_id_number = pg.sid
       order by ' || replace(v_order, '@', 'pg')
    using v_q, v_size, v_off, p_school_year, p_semester;
  else
    -- The filter or the sort depends on the result itself, so it needs everyone's result: taken from the saved totals (brought up to date first if any credit changed).
    perform public._sdp_saved_totals_ensure(p_school_year, p_semester);
    return query execute
      'with comp as (select * from public._sdp_compliance_saved($4, $5)),
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

-- The credits owed on top of 3 (what the Checklist shows after the "/"): a renewed scholar's come from the next semester too.
create or replace function public.scholars_sdp_extra_required(p_school_year text, p_semester text)
returns table(scholar_id_number text, community_service integer, community_volunteerism integer, formation_program integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.has_staff_tag('sdp_monitoring') or public.can_view_renewals() or public.can_decide_sdp_reconsideration()) then raise exception 'Not authorized to view the SDP checklist.'; end if;
  return query
  with adv as (select a.scholar_id_number as sid from public._sdp_advanced_ids(p_school_year, p_semester) a),
       nx as (select n.school_year as y, n.semester as s from public._sdp_next_semester(p_school_year, p_semester) n)
  select d.scholar_id_number,
         coalesce(sum(d.amount) filter (where d.category = 'community_service'), 0)::integer,
         coalesce(sum(d.amount) filter (where d.category = 'community_volunteerism'), 0)::integer,
         coalesce(sum(d.amount) filter (where d.category = 'formation_program'), 0)::integer
  from public.sdp_reconsideration_debts d
  where (d.apply_school_year = p_school_year and d.apply_semester = p_semester and d.scholar_id_number not in (select sid from adv))
     or (d.scholar_id_number in (select sid from adv) and d.apply_school_year = (select y from nx) and d.apply_semester = (select s from nx))
  group by d.scholar_id_number;
end;
$$;
revoke all on function public.scholars_sdp_extra_required(text, text) from public, anon;
grant execute on function public.scholars_sdp_extra_required(text, text) to authenticated;

-- Which Checklist rows are showing the next semester (for the "renewed" mark), and which semester that is.
create or replace function public.scholars_sdp_advanced(p_school_year text, p_semester text)
returns table(scholar_id_number text, next_school_year text, next_semester text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.has_staff_tag('sdp_monitoring') or public.can_view_renewals() or public.can_decide_sdp_reconsideration()) then raise exception 'Not authorized to view the SDP checklist.'; end if;
  return query
  select a.scholar_id_number, n.school_year, n.semester
  from public._sdp_advanced_ids(p_school_year, p_semester) a
  cross join lateral public._sdp_next_semester(p_school_year, p_semester) n;
end;
$$;
revoke all on function public.scholars_sdp_advanced(text, text) from public, anon;
grant execute on function public.scholars_sdp_advanced(text, text) to authenticated;

-- 4. The renewal detail page: what the scholar's SDP is after the renewal (only for a renewed application).
create or replace function public.renewal_sdp_after(p_record_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.renewal_records%rowtype;
  b record;
  n record;
  v_req jsonb;
  v_cs integer; v_cv integer; v_fp integer;
begin
  if not public.can_view_renewals() then raise exception 'Not authorized to view renewal applications.'; end if;
  select * into r from public.renewal_records where id = p_record_id;
  if not found then raise exception 'That renewal record was not found.'; end if;
  if r.stage <> 'renewed' then return jsonb_build_object('applies', false); end if;
  select * into b from public._renewal_basis(r.school_year, r.term);
  select * into n from public._sdp_next_semester(b.basis_school_year, b.basis_term);
  v_req := public._sdp_required_map(r.scholar_id_number, n.school_year, n.semester);
  select coalesce(sum(t.total) filter (where t.category = 'community_service'), 0)::integer, coalesce(sum(t.total) filter (where t.category = 'community_volunteerism'), 0)::integer,
         coalesce(sum(t.total) filter (where t.category = 'formation_program'), 0)::integer
    into v_cs, v_cv, v_fp
  from public._sdp_period_totals(n.school_year, n.semester, r.scholar_id_number) t;
  return jsonb_build_object('applies', true, 'school_year', n.school_year, 'semester', n.semester,
    'community_service', v_cs, 'community_volunteerism', v_cv, 'formation_program', v_fp,
    'required_community_service', (v_req ->> 'community_service')::integer, 'required_community_volunteerism', (v_req ->> 'community_volunteerism')::integer,
    'required_formation_program', (v_req ->> 'formation_program')::integer);
end;
$$;
revoke all on function public.renewal_sdp_after(uuid) from public, anon;
grant execute on function public.renewal_sdp_after(uuid) to authenticated;

notify pgrst, 'reload schema';
