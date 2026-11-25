-- undo_daily_records_edit.sql: Daily Records can no longer be edited, and the list is the one it was before.
-- The records stay exactly as they are now (a record that was edited keeps its latest text). The edit history table and the 3 small columns are KEPT on purpose,
-- so that no history is ever lost; they do nothing without the functions and running supabase_migration_daily_records_edit.sql again brings everything back.
-- (Run this ONLY together with putting the previous website version back.)
begin;
drop function if exists public.counseling_update_daily_record(uuid, text, text, text, integer);
drop function if exists public.counseling_record_history(uuid);
drop function if exists public.counseling_daily_record_get(uuid);
drop function if exists public.scholar_counseling_daily_records_page(text, date, date, text[], text[], uuid[], text, text, integer, integer, boolean);
create or replace function public.scholar_counseling_daily_records_page(
  p_search text default '',
  p_from date default null,
  p_to date default null,
  p_visit_types text[] default null,
  p_statuses text[] default null,
  p_consultants uuid[] default null,
  p_sort text default 'date',
  p_dir text default 'desc',
  p_limit integer default 50,
  p_offset integer default 0,
  p_log_export boolean default false
)
returns table(
  id uuid, scholar_id_number text, name text, course text, year_level text, school text, status text, date_visited date,
  consulted_by_id uuid, consulted_by_name text, failed_subjects text, findings text, staff_recommendations text, visit_type text, created_at timestamptz, total_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_q text := replace(replace(replace(btrim(coalesce(p_search, '')), '\', '\\'), '%', '\%'), '_', '\_');
  v_sort text := case when lower(coalesce(p_sort, '')) = 'name' then 'name' else 'date' end;
  v_dir text := case when lower(coalesce(p_dir, '')) = 'asc' then 'asc' else 'desc' end;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_where text;
  v_order text;
  v_total bigint;
begin
  if not public.is_scholar_counseling_staff() then raise exception 'Not authorized to use the Scholar Consultation Tool.'; end if;

  -- only fixed text is put together here; everything the caller typed goes in as a value ($1 ...)
  v_where := 'where ($1 = '''' or s.scholar_id_number ilike ''%'' || $1 || ''%'' or s.first_name ilike ''%'' || $1 || ''%'' or s.last_name ilike ''%'' || $1 || ''%''
                 or concat_ws('' '', s.first_name, s.last_name) ilike ''%'' || $1 || ''%'' or concat_ws('' '', s.last_name, s.first_name) ilike ''%'' || $1 || ''%'')
             and ($2::date is null or r.date_visited >= $2::date) and ($3::date is null or r.date_visited <= $3::date)
             and ($4::text[] is null or r.visit_type = any ($4::text[])) and ($5::text[] is null or r.status = any ($5::text[]))
             and ($6::uuid[] is null or r.consulted_by = any ($6::uuid[]))';
  v_order := case v_sort
    when 'name' then format('lower(s.last_name) %1$s, lower(s.first_name) %1$s, r.date_visited desc, r.created_at desc, r.id', v_dir)
    else format('r.date_visited %1$s, r.created_at %1$s, r.id', v_dir) end;

  execute 'select count(*) from public.scholar_counseling_records r join public.scholars s on s.scholar_id_number = r.scholar_id_number ' || v_where
    into v_total using v_q, p_from, p_to, p_visit_types, p_statuses, p_consultants;

  if coalesce(p_log_export, false) and v_offset = 0 then
    insert into public.renewal_export_log (exported_by, by_label, school_year, term, what, row_count, filter_text)
    values ((select u.id from public.users u where u.id = auth.uid()), public._actor_name(), '—', '—', 'consultation daily records', v_total,
            left(concat_ws('; ', case when v_q <> '' then 'search "' || btrim(p_search) || '"' end, case when p_from is not null then 'from ' || p_from::text end, case when p_to is not null then 'to ' || p_to::text end,
                           case when p_visit_types is not null then 'visit type ' || array_to_string(p_visit_types, '/') end, case when p_statuses is not null then 'status ' || array_to_string(p_statuses, '/') end,
                           case when p_consultants is not null then 'consultants chosen' end), 300));
  end if;

  return query execute
    'select r.id, r.scholar_id_number, btrim(s.first_name || '' '' || s.last_name), s.course, s.year_level, s.school, r.status, r.date_visited,
            r.consulted_by, btrim(coalesce(u.first_name, '''') || '' '' || coalesce(u.last_name, '''')), r.failed_subjects, r.findings, r.staff_recommendations, r.visit_type, r.created_at, $7::bigint
     from public.scholar_counseling_records r join public.scholars s on s.scholar_id_number = r.scholar_id_number left join public.users u on u.id = r.consulted_by ' || v_where
    || ' order by ' || v_order || ' limit ' || v_limit || ' offset ' || v_offset
    using v_q, p_from, p_to, p_visit_types, p_statuses, p_consultants, v_total;
end;
$$;
revoke all on function public.scholar_counseling_daily_records_page(text, date, date, text[], text[], uuid[], text, text, integer, integer, boolean) from public, anon;
grant execute on function public.scholar_counseling_daily_records_page(text, date, date, text[], text[], uuid[], text, text, integer, integer, boolean) to authenticated;
notify pgrst, 'reload schema';
commit;
