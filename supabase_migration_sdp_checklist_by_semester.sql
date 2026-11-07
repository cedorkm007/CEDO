-- ─────────────────────────────────────────────────────────────
-- SDP CHECKLIST BY SEMESTER (like Scholarship Program Information).   Safe to run twice.   Undo: undo_sdp_checklist_by_semester.sql
-- Run AFTER supabase_migration_sdp_after_renewal.sql.
--
--   * The CURRENT semester (for example 1st Semester 2026-2027) shows everyone's SDP as it stands BEFORE the renewal. Renewed scholars are no longer swapped to the next
--     semester there (that mixed the two).
--   * The semester AFTER the current one, while a renewal window exists for it (for example 2nd Semester 2026-2027), is a view of its own that lists only the scholars
--     RENEWED for it, with their SDP after the renewal: 3 credits per category used, what is above carried on, what an approved reconsideration found lacking added to
--     the requirement. It fills in as renewals are confirmed. Windows that are tests (with testers) are not counted. When CEDO makes that semester the current one,
--     it becomes a normal view of everyone.
--   * The scholar's own SDP tab and the "After the renewal" box of the renewal detail are NOT changed (a renewed scholar still sees the next semester right away).
--   * Replaces 4 functions (the list of who is "advanced", the saved results, the checklist page and its counts) and adds 3 small ones. No table is changed. Nothing is deleted.
-- ─────────────────────────────────────────────────────────────
do $$ begin
  if to_regprocedure('public._sdp_advanced_ids(text,text)') is null or to_regprocedure('public.scholars_sdp_checklist_page(text,text,text,text,text,text,integer,integer)') is null then
    raise exception 'STOPPED, nothing changed: run supabase_migration_sdp_after_renewal.sql first.';
  end if;
end $$;

-- 1. Is this semester the one being renewed? The semester right after the current grading period, with a renewal window (not a test) for it.
create or replace function public._sdp_renewal_view(p_school_year text, p_semester text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.grading_period_settings g
    cross join lateral public._sdp_next_semester(g.current_school_year, g.current_semester) n
    join public.renewal_windows w on w.school_year = n.school_year and w.term = n.semester and w.testers is null
    where g.id = true and n.school_year = p_school_year and n.semester = p_semester
  );
$$;
revoke all on function public._sdp_renewal_view(text, text) from public, anon, authenticated;

-- 2. The scholars renewed for a semester (a test window does not count).
create or replace function public._sdp_renewed_ids(p_school_year text, p_semester text)
returns table(scholar_id_number text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct r.scholar_id_number
  from public.renewal_records r
  left join public.renewal_windows w on w.id = r.window_id
  where r.school_year = p_school_year and r.term = p_semester and r.stage = 'renewed' and (w.id is null or w.testers is null);
$$;
revoke all on function public._sdp_renewed_ids(text, text) from public, anon, authenticated;

-- 3. Nobody is swapped to the next semester inside the current semester any more (the renewal semester has its own view). Everything built on this list follows.
create or replace function public._sdp_advanced_ids(p_school_year text, p_semester text)
returns table(scholar_id_number text)
language sql
stable
security definer
set search_path = public
as $$
  select null::text where false;
$$;
revoke all on function public._sdp_advanced_ids(text, text) from public, anon, authenticated;

-- 4. The saved results: for the renewal semester, the renewed scholars' own numbers for THAT semester; otherwise as before.
create or replace function public._sdp_compliance_saved(p_school_year text, p_semester text)
returns table(
  scholar_id_number text, community_service integer, community_volunteerism integer, formation_program integer,
  applicable boolean, complied boolean, missing text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public._sdp_renewal_view(p_school_year, p_semester) then
    return query
    select c.scholar_id_number, c.community_service, c.community_volunteerism, c.formation_program, c.applicable, c.complied, c.missing
    from public._sdp_compliance_ids(p_school_year, p_semester, array(select x.scholar_id_number from public._sdp_renewed_ids(p_school_year, p_semester) x)) c;
  else
    return query select p.scholar_id_number, p.community_service, p.community_volunteerism, p.formation_program, p.applicable, p.complied, p.missing
    from public._sdp_compliance_saved_plain(p_school_year, p_semester) p;
  end if;
end;
$$;
revoke all on function public._sdp_compliance_saved(text, text) from public, anon, authenticated;

-- 5. The Checklist page.
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
  v_ren boolean := public._sdp_renewal_view(p_school_year, p_semester);      -- the semester after the current one, while it is being renewed: only the renewed scholars
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
           and (not $6 or s.scholar_id_number in (select x.scholar_id_number from public._sdp_renewed_ids($4, $5) x))
           and ($1 = '''' or position($1 in lower(s.first_name || '' '' || s.last_name)) > 0 or position($1 in lower(s.scholar_id_number)) > 0)
       ), pg as (
         select m.*, count(*) over () as total from matched m order by ' || replace(v_order, '@', 'm') || ' limit $2 offset $3
       ), comp as (
         select * from public._sdp_compliance_view_ids($4, $5, coalesce((select array_agg(pg2.sid) from pg pg2), ''{}''::text[]))
       )
       select pg.sid, pg.nm, c.community_service, c.community_volunteerism, c.formation_program, c.applicable, c.complied, c.missing, pg.total
       from pg join comp c on c.scholar_id_number = pg.sid
       order by ' || replace(v_order, '@', 'pg')
    using v_q, v_size, v_off, p_school_year, p_semester, v_ren;
  else
    -- The filter or the sort depends on the result itself, so it needs everyone's result: taken from the saved totals (brought up to date first if any credit changed).
    if not v_ren then perform public._sdp_saved_totals_ensure(p_school_year, p_semester); end if;
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

-- 6. The three counts above the list.
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
  if not public._sdp_renewal_view(p_school_year, p_semester) then perform public._sdp_saved_totals_ensure(p_school_year, p_semester); end if;
  return query
  select count(*), count(*) filter (where c.complied is true), count(*) filter (where c.complied is false),
         not (coalesce(p_semester, '') ilike 'summer%')
  from public._sdp_compliance_saved(p_school_year, p_semester) c;
end;
$$;
revoke all on function public.scholars_sdp_checklist_summary(text, text) from public, anon;
grant execute on function public.scholars_sdp_checklist_summary(text, text) to authenticated;

-- 7. For the screen's Semester picker: the semester being renewed (if there is one), how many scholars are renewed for it so far, and whether its renewal window is open right now.
create or replace function public.sdp_checklist_renewal_period()
returns table(school_year text, semester text, renewed bigint, ongoing boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.has_staff_tag('sdp_monitoring') or public.can_view_renewals()) then raise exception 'Not authorized to view the SDP checklist.'; end if;
  return query
  select n.school_year, n.semester,
         (select count(*) from public._sdp_renewed_ids(n.school_year, n.semester)),
         exists (select 1 from public.renewal_windows w where w.school_year = n.school_year and w.term = n.semester and w.testers is null
                   and (now() at time zone 'Asia/Manila')::date between w.opens_on and w.closes_on)
  from public.grading_period_settings g
  cross join lateral public._sdp_next_semester(g.current_school_year, g.current_semester) n
  where g.id = true and public._sdp_renewal_view(n.school_year, n.semester);
end;
$$;
revoke all on function public.sdp_checklist_renewal_period() from public, anon;
grant execute on function public.sdp_checklist_renewal_period() to authenticated;

notify pgrst, 'reload schema';
