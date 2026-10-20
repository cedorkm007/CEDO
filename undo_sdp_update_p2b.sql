-- UNDO for supabase_migration_sdp_update_p2b_saved_results.sql
-- Puts the two Phase 2 functions back as they were (they work everyone out each time again) and removes the saved totals.
-- Credits, activities and everything else are untouched.
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

drop function if exists public._sdp_compliance_saved(text, text);
drop function if exists public._sdp_saved_totals_ensure(text, text);
drop function if exists public._sdp_data_fingerprint();
drop table if exists public.sdp_checklist_saved_state;
drop table if exists public.sdp_checklist_saved;
notify pgrst, 'reload schema';
