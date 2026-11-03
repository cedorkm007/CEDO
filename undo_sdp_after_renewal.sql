-- UNDO for supabase_migration_sdp_after_renewal.sql: the scholar's SDP tab and the Checklist go back to the current grading period for everyone (a renewed scholar shows the next semester only once CEDO changes the period).
-- Functions only; nothing is deleted from a table.

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
  select gps.current_school_year, gps.current_semester into v_school_year, v_semester
    from public.grading_period_settings gps where gps.id = true;

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
  select gps.current_school_year, gps.current_semester into v_year, v_sem from public.grading_period_settings gps where gps.id = true;
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
  select gps.current_school_year, gps.current_semester into v_year, v_sem from public.grading_period_settings gps where gps.id = true;
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
         select * from public._sdp_compliance_ids($4, $5, coalesce((select array_agg(pg2.sid) from pg pg2), ''{}''::text[]))
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
  select d.scholar_id_number,
         coalesce(sum(d.amount) filter (where d.category = 'community_service'), 0)::integer,
         coalesce(sum(d.amount) filter (where d.category = 'community_volunteerism'), 0)::integer,
         coalesce(sum(d.amount) filter (where d.category = 'formation_program'), 0)::integer
  from public.sdp_reconsideration_debts d
  where d.apply_school_year = p_school_year and d.apply_semester = p_semester
  group by d.scholar_id_number;
end;
$$;
revoke all on function public.scholars_sdp_extra_required(text, text) from public, anon;
grant execute on function public.scholars_sdp_extra_required(text, text) to authenticated;

drop function if exists public.renewal_sdp_after(uuid);
drop function if exists public.scholars_sdp_advanced(text, text);
drop function if exists public._sdp_compliance_saved_plain(text, text);
drop function if exists public._sdp_compliance_view_ids(text, text, text[]);
drop function if exists public.fetch_scholar_sdp_view();
drop function if exists public._sdp_advanced_ids(text, text);
drop function if exists public._sdp_view_period(text);

notify pgrst, 'reload schema';
