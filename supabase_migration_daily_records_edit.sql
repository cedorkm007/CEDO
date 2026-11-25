-- ─────────────────────────────────────────────────────────────
-- supabase_migration_daily_records_edit.sql
-- CONSULTATION TOOL > DAILY RECORDS: THE FINDINGS AND THE STAFF RECOMMENDATIONS CAN BE EDITED AFTER THE VISIT.   Safe to run twice.   Undo: undo_daily_records_edit.sql
--   * Only the staff member who wrote the record can edit it, and only the Findings and the Staff recommendations (max 20,000 characters each). The database itself refuses anybody else.
--   * Every edit is kept in an edit history that can only be added to: who, when, the old text, the new text and an optional reason. Nobody can change or delete a history line.
--   * If the same record was changed in another window since it was opened, the save is stopped (nothing is lost) so a newer edit is never overwritten.
--   * Adds 3 columns to the records (how many times edited, when, by whom; 0 / empty for every record that exists now), 1 new table (the history), 4 new functions,
--     and replaces 1 function (the Daily Records list: it also says "Edited"). No record, no text and no other table is changed or deleted.
-- Needs supabase_migration_consultation_daily_records_paging.sql.
-- ─────────────────────────────────────────────────────────────

begin;

do $$ begin
  if to_regclass('public.scholar_counseling_records') is null or to_regprocedure('public.is_scholar_counseling_staff()') is null
     or to_regprocedure('public.scholar_counseling_daily_records_page(text,date,date,text[],text[],uuid[],text,text,integer,integer,boolean)') is null then
    raise exception 'STOPPED, nothing changed: run supabase_migration_consultation_daily_records_paging.sql first.';
  end if;
end $$;

-- 1. How many times a record was edited, when and by whom (0 / empty for every record that exists now).
alter table public.scholar_counseling_records add column if not exists edit_count integer not null default 0;
alter table public.scholar_counseling_records add column if not exists last_edited_at timestamptz;
alter table public.scholar_counseling_records add column if not exists last_edited_by uuid references public.users(id) on delete set null;

-- 2. The edit history: one line per saved edit, never changed, never deleted.
create table if not exists public.scholar_counseling_record_edits (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.scholar_counseling_records(id) on delete cascade,
  edit_no integer not null,
  edited_by uuid references public.users(id) on delete set null,
  edited_by_name text not null default '',
  edited_at timestamptz not null default now(),
  old_findings text not null default '',
  new_findings text not null default '',
  old_staff_recommendations text not null default '',
  new_staff_recommendations text not null default '',
  reason text not null default '',
  unique (record_id, edit_no)
);
create index if not exists scholar_counseling_record_edits_record_idx on public.scholar_counseling_record_edits (record_id, edit_no desc);
alter table public.scholar_counseling_record_edits enable row level security;
revoke all on public.scholar_counseling_record_edits from public, anon, authenticated;      -- read and written only through the functions below

-- No change and no deletion, for anybody. (Only when the whole record is removed — the scholar was deleted — does its history go with it.)
create or replace function public._counseling_edit_history_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.scholar_counseling_records r where r.id = old.record_id) then
    return old;
  end if;
  raise exception 'The edit history can only be added to. It cannot be changed or deleted.';
end;
$$;
drop trigger if exists scholar_counseling_record_edits_guard on public.scholar_counseling_record_edits;
create trigger scholar_counseling_record_edits_guard before update or delete on public.scholar_counseling_record_edits
  for each row execute function public._counseling_edit_history_guard();

-- 3. Edit the findings and the staff recommendations of ONE record. Only the staff member who wrote it. Returns what happened:
--    {ok:true, changed:true|false, edit_count, last_edited_at, edited_by_name}   or   {ok:false, conflict:true, edit_count, findings, staff_recommendations} (changed meanwhile: nothing saved).
create or replace function public.counseling_update_daily_record(
  p_id uuid, p_findings text, p_staff_recommendations text, p_reason text default '', p_expected_edit_count integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.scholar_counseling_records%rowtype;
  v_f text := btrim(coalesce(p_findings, ''));
  v_s text := btrim(coalesce(p_staff_recommendations, ''));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_name text;
  v_n integer;
  v_at timestamptz := now();
begin
  if not public.is_scholar_counseling_staff() then raise exception 'Not authorized to use the Scholar Consultation Tool.'; end if;
  select * into r from public.scholar_counseling_records where id = p_id for update;
  if not found then raise exception 'That record was not found.'; end if;
  if r.consulted_by is distinct from auth.uid() then raise exception 'Only the staff member who wrote this record can edit it.'; end if;
  if char_length(v_f) > 20000 then raise exception 'The findings are too long (the limit is 20,000 characters).'; end if;
  if char_length(v_s) > 20000 then raise exception 'The staff recommendations are too long (the limit is 20,000 characters).'; end if;
  if char_length(v_reason) > 500 then raise exception 'The reason is too long (the limit is 500 characters).'; end if;

  if p_expected_edit_count is not null and p_expected_edit_count <> r.edit_count then
    return jsonb_build_object('ok', false, 'conflict', true, 'edit_count', r.edit_count, 'findings', r.findings, 'staff_recommendations', r.staff_recommendations);
  end if;
  if v_f = btrim(r.findings) and v_s = btrim(r.staff_recommendations) then
    return jsonb_build_object('ok', true, 'changed', false, 'edit_count', r.edit_count);
  end if;

  select coalesce(nullif(btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), ''), 'Staff') into v_name from public.users u where u.id = auth.uid();
  v_name := coalesce(v_name, 'Staff');
  v_n := r.edit_count + 1;
  insert into public.scholar_counseling_record_edits (record_id, edit_no, edited_by, edited_by_name, edited_at, old_findings, new_findings, old_staff_recommendations, new_staff_recommendations, reason)
  values (r.id, v_n, auth.uid(), v_name, v_at, r.findings, v_f, r.staff_recommendations, v_s, v_reason);
  update public.scholar_counseling_records set findings = v_f, staff_recommendations = v_s, edit_count = v_n, last_edited_at = v_at, last_edited_by = auth.uid() where id = r.id;
  return jsonb_build_object('ok', true, 'changed', true, 'edit_count', v_n, 'last_edited_at', v_at, 'edited_by_name', v_name);
end;
$$;
revoke all on function public.counseling_update_daily_record(uuid, text, text, text, integer) from public, anon;
grant execute on function public.counseling_update_daily_record(uuid, text, text, text, integer) to authenticated;

-- 4. The history of one record, newest first. Any consultation staff (they can already read every record).
create or replace function public.counseling_record_history(p_id uuid)
returns table(edit_no integer, edited_at timestamptz, edited_by_name text, reason text, old_findings text, new_findings text, old_staff_recommendations text, new_staff_recommendations text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_scholar_counseling_staff() then raise exception 'Not authorized to use the Scholar Consultation Tool.'; end if;
  return query
  select e.edit_no, e.edited_at, e.edited_by_name, e.reason, e.old_findings, e.new_findings, e.old_staff_recommendations, e.new_staff_recommendations
  from public.scholar_counseling_record_edits e where e.record_id = p_id order by e.edit_no desc;
end;
$$;
revoke all on function public.counseling_record_history(uuid) from public, anon;
grant execute on function public.counseling_record_history(uuid) to authenticated;

-- 5. ONE record, in the same shape as a row of the list (to open a record that is not on the page that is showing).
create or replace function public.counseling_daily_record_get(p_id uuid)
returns table(
  id uuid, scholar_id_number text, name text, course text, year_level text, school text, status text, date_visited date,
  consulted_by_id uuid, consulted_by_name text, failed_subjects text, findings text, staff_recommendations text, visit_type text, created_at timestamptz,
  edit_count integer, last_edited_at timestamptz, edited_by_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_scholar_counseling_staff() then raise exception 'Not authorized to use the Scholar Consultation Tool.'; end if;
  return query
  select r.id, r.scholar_id_number, btrim(s.first_name || ' ' || s.last_name), s.course, s.year_level, s.school, r.status, r.date_visited,
         r.consulted_by, btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), r.failed_subjects, r.findings, r.staff_recommendations, r.visit_type, r.created_at,
         r.edit_count, r.last_edited_at, btrim(coalesce(eu.first_name, '') || ' ' || coalesce(eu.last_name, ''))
  from public.scholar_counseling_records r
  join public.scholars s on s.scholar_id_number = r.scholar_id_number
  left join public.users u on u.id = r.consulted_by
  left join public.users eu on eu.id = r.last_edited_by
  where r.id = p_id;
end;
$$;
revoke all on function public.counseling_daily_record_get(uuid) from public, anon;
grant execute on function public.counseling_daily_record_get(uuid) to authenticated;

-- 6. The Daily Records list, with the three new columns (edit_count, last_edited_at, edited_by_name). Everything else is exactly as before.
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
  consulted_by_id uuid, consulted_by_name text, failed_subjects text, findings text, staff_recommendations text, visit_type text, created_at timestamptz,
  edit_count integer, last_edited_at timestamptz, edited_by_name text, total_count bigint
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
            r.consulted_by, btrim(coalesce(u.first_name, '''') || '' '' || coalesce(u.last_name, '''')), r.failed_subjects, r.findings, r.staff_recommendations, r.visit_type, r.created_at,
            r.edit_count, r.last_edited_at, btrim(coalesce(eu.first_name, '''') || '' '' || coalesce(eu.last_name, '''')), $7::bigint
     from public.scholar_counseling_records r join public.scholars s on s.scholar_id_number = r.scholar_id_number left join public.users u on u.id = r.consulted_by
     left join public.users eu on eu.id = r.last_edited_by ' || v_where
    || ' order by ' || v_order || ' limit ' || v_limit || ' offset ' || v_offset
    using v_q, p_from, p_to, p_visit_types, p_statuses, p_consultants, v_total;
end;
$$;
revoke all on function public.scholar_counseling_daily_records_page(text, date, date, text[], text[], uuid[], text, text, integer, integer, boolean) from public, anon;
grant execute on function public.scholar_counseling_daily_records_page(text, date, date, text[], text[], uuid[], text, text, integer, integer, boolean) to authenticated;

notify pgrst, 'reload schema';
commit;
