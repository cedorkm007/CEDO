-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 2b: SAVED TOTALS for the SDP Checklist.   Run AFTER supabase_migration_sdp_update_p2_checklist_paging.sql.
-- Safe to re-run.   Undo: undo_sdp_update_p2b.sql
--
-- Why: the counts at the top and the Complied / Not complied buttons (and sorting by a credit column or Result) need EVERYONE's result, and working
-- that out for ~8,000 scholars took more than 2 seconds on your real database.
-- How: the database keeps each scholar's totals per semester in a small new table (sdp_checklist_saved). Before using them it takes a quick
-- "fingerprint" of the credit data (credits, activities' category and credits, saved-for-later credits). If the fingerprint is the same as when the totals were
-- saved, they are used as they are (fast). If ANYTHING changed (a credit added, removed or moved to another semester, an activity's category or credits
-- changed, a scholar removed), the totals for that semester are worked out again once and saved again, so a stale answer is never shown.
-- No automatic rules are put on the credit tables, so scanning is not touched in any way. The first request after a change is as slow as before; the
-- following ones are fast. Only ADDS two small tables and functions and replaces the two functions of Phase 2 (same answers); nothing else changes.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.sdp_checklist_saved (
  school_year text not null,
  semester text not null,
  scholar_id_number text not null,
  community_service integer not null default 0,
  community_volunteerism integer not null default 0,
  formation_program integer not null default 0,
  primary key (school_year, semester, scholar_id_number)
);
create table if not exists public.sdp_checklist_saved_state (
  school_year text not null,
  semester text not null,
  fingerprint text not null,
  saved_at timestamptz not null default now(),
  primary key (school_year, semester)
);
-- Nobody reaches these tables from the website; only the functions below (which check who is asking) use them.
alter table public.sdp_checklist_saved enable row level security;
alter table public.sdp_checklist_saved_state enable row level security;
revoke all on public.sdp_checklist_saved from public, anon, authenticated;
revoke all on public.sdp_checklist_saved_state from public, anon, authenticated;

-- The fingerprint: how many credit rows there are and a number made from every row's id, scholar, activity and semester; the same for activities
-- (category and credits) and for saved-for-later credits. Any add, remove or change of those makes it different.
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

-- Brings the saved totals of ONE semester up to date if the credit data changed since they were saved.
create or replace function public._sdp_saved_totals_ensure(p_school_year text, p_semester text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fp text := public._sdp_data_fingerprint();
begin
  if exists (select 1 from public.sdp_checklist_saved_state s where s.school_year = p_school_year and s.semester = p_semester and s.fingerprint = v_fp) then
    return;
  end if;
  -- One person at a time works the totals out; whoever waits finds them ready.
  perform pg_advisory_xact_lock(hashtext('sdp_checklist_saved:' || p_school_year || '/' || p_semester));
  v_fp := public._sdp_data_fingerprint();
  if exists (select 1 from public.sdp_checklist_saved_state s where s.school_year = p_school_year and s.semester = p_semester and s.fingerprint = v_fp) then
    return;
  end if;
  delete from public.sdp_checklist_saved where school_year = p_school_year and semester = p_semester;
  insert into public.sdp_checklist_saved (school_year, semester, scholar_id_number, community_service, community_volunteerism, formation_program)
  select p_school_year, p_semester, t.scholar_id_number,
         coalesce(sum(t.total) filter (where t.category = 'community_service'), 0)::integer,
         coalesce(sum(t.total) filter (where t.category = 'community_volunteerism'), 0)::integer,
         coalesce(sum(t.total) filter (where t.category = 'formation_program'), 0)::integer
  from public._sdp_period_totals_ids(p_school_year, p_semester, null) t
  group by t.scholar_id_number;
  insert into public.sdp_checklist_saved_state (school_year, semester, fingerprint, saved_at)
  values (p_school_year, p_semester, v_fp, now())
  on conflict (school_year, semester) do update set fingerprint = excluded.fingerprint, saved_at = excluded.saved_at;
end;
$$;
revoke all on function public._sdp_saved_totals_ensure(text, text) from public, anon, authenticated;

-- The same result rules as _sdp_compliance, over the saved totals.
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

-- The two Phase 2 functions again: the same answers, but the work for everyone now uses the saved totals.
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

create or replace function public.scholars_sdp_checklist_summary(p_school_year text, p_semester text)
returns table(total bigint, complied bigint, not_complied bigint, applicable boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_staff_tag('sdp_monitoring') then
    raise exception 'Not authorized to view the SDP checklist.';
  end if;
  perform public._sdp_saved_totals_ensure(p_school_year, p_semester);
  return query
  select count(*), count(*) filter (where c.complied is true), count(*) filter (where c.complied is false),
         not (coalesce(p_semester, '') ilike 'summer%')
  from public._sdp_compliance_saved(p_school_year, p_semester) c;
end;
$$;
revoke all on function public.scholars_sdp_checklist_summary(text, text) from public, anon;
grant execute on function public.scholars_sdp_checklist_summary(text, text) to authenticated;

notify pgrst, 'reload schema';
