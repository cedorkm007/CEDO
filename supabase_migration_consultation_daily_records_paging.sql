-- ─────────────────────────────────────────────────────────────
-- supabase_migration_consultation_daily_records_paging.sql
-- CONSULTATION TOOL > DAILY RECORDS: LOAD IN PAGES (nothing cut off at 1,000 rows), SEARCH / FILTER / SORT BY THE DATABASE, AN EXPORT OF EVERYTHING THAT MATCHES, AND A FAST SCHOLAR ID LOOKUP.
-- Safe to run twice.   Undo: undo_consultation_daily_records_paging.sql   (It adds indexes and two read-only functions; it changes and deletes no record.)
--
--   * scholar_counseling_daily_records_page(...): ONE PAGE of the Daily Records with the true total, filtered by search, date range, visit type, status and consultant, sorted by date visited or name.
--     Only consultation staff can use it. The old function (scholar_counseling_daily_records) stays: the scholar's "Counseling History" still uses it.
--   * The same function, asked for page after page, is also how the Export downloads ALL the records that match the filters. When an export starts (p_log_export = true, first page) it is written to the
--     export log (who, when, how many, which filters), like the other exports of personal details.
--   * scholar_counseling_consultants(): the staff who logged visits, for the Consultant filter.
--   * Indexes for what the page sorts and filters by, and one for the Scholar ID lookup that ignores capital letters (the Bulk Add uses it for every row).
-- ─────────────────────────────────────────────────────────────

begin;

do $$ begin
  if to_regclass('public.scholar_counseling_records') is null or to_regprocedure('public.is_scholar_counseling_staff()') is null or to_regclass('public.renewal_export_log') is null then
    raise exception 'STOPPED, nothing changed: run the Scholar Consultation and the Scholar Renewal report files first.';
  end if;
end $$;

-- 1. Indexes (an index that exists is left alone).
create index if not exists scholar_counseling_records_date_page_idx on public.scholar_counseling_records (date_visited desc, created_at desc, id);
create index if not exists scholar_counseling_records_consulted_by_idx on public.scholar_counseling_records (consulted_by, date_visited desc);
create index if not exists scholar_counseling_records_visit_type_idx on public.scholar_counseling_records (visit_type);
create index if not exists scholar_counseling_records_status_idx on public.scholar_counseling_records (status);
create index if not exists scholars_lower_scholar_id_idx on public.scholars (lower(scholar_id_number));      -- exact lookup that ignores capitals (Bulk Add)

-- 2. One page of the Daily Records.
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

-- 3. The staff who logged visits (for the Consultant filter).
create or replace function public.scholar_counseling_consultants()
returns table(id uuid, name text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_scholar_counseling_staff() then raise exception 'Not authorized to use the Scholar Consultation Tool.'; end if;
  return query
  select x.cid, coalesce(nullif(btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), ''), 'Unknown staff')
  from (select distinct r.consulted_by as cid from public.scholar_counseling_records r) x
  left join public.users u on u.id = x.cid
  order by 2;
end;
$$;
revoke all on function public.scholar_counseling_consultants() from public, anon;
grant execute on function public.scholar_counseling_consultants() to authenticated;

notify pgrst, 'reload schema';

commit;
