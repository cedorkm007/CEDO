-- ─────────────────────────────────────────────────────────────
-- supabase_migration_academic_uploads.sql
-- GRADES AND ACADEMIC MANAGEMENT, PHASE 3: A PRE-FILLED TEMPLATE PER SCHOOL AND A RELIABLE UPLOAD (batches, batch numbers, undo, past uploads, one upload per school at a time).   Safe to run twice.   Undo: undo_academic_uploads.sql
--   * academic_template_rows: the scholars of ONE school with their status today (the screen writes them into the Excel template, read page by page).
--   * Scholar IDs are CLEANED before they are matched: spaces (also hidden ones) and the different dashes are fixed; an ID Excel turned into a number with "E+" is refused with an explanation; an ID that lost its dash
--     or its leading zeros is found again ONLY when exactly one scholar fits (it is a warning, never a guess); an ID that fits two scholars is refused; an ID of ANOTHER school is skipped, so a file can never change another school by accident.
--   * academic_upload_check: checks up to 600 rows and saves NOTHING (row numbers are the file's own). academic_upload_start: opens a numbered batch and LOCKS the school (one upload per school at a time).
--     academic_upload_apply: saves the ready rows of a chunk (500 at a time from the screen); the same file twice changes nothing the second time. academic_upload_finish closes the batch.
--   * academic_upload_list: the past uploads of a school. academic_upload_undo: puts back what a batch changed, for the scholars still at the value that upload set (anybody changed afterwards is left alone and counted); allowed for 30 days.
--   * The history of a scholar and of a school now also shows the batch number.
--   * Every save checks only the open renewals whose passing GWA changes (Phase 2).
--   Only the accounts that may use the tab (the Scholar Management tag) can use these. Adds 1 table, 3 indexes and 9 functions, and replaces 2 functions (originals in the undo file). Nothing is deleted.
-- Needs supabase_migration_academic_recheck_targeted.sql.
-- ─────────────────────────────────────────────────────────────

begin;

do $$ begin
  if to_regprocedure('public.academic_recheck_step(integer)') is null then
    raise exception 'STOPPED, nothing changed: run supabase_migration_academic_recheck_targeted.sql first.';
  end if;
end $$;

-- 1. The uploads.
create table if not exists public.academic_upload_batches (
  id            uuid primary key default gen_random_uuid(),
  batch_no      integer generated always as identity unique,
  school_id     uuid not null,
  file_name     text not null default '',
  total_rows    integer not null default 0,
  set_count     integer not null default 0,
  same_count    integer not null default 0,
  error_count   integer not null default 0,
  warning_count integer not null default 0,
  state         text not null default 'in_progress' check (state in ('in_progress', 'finished', 'undone', 'abandoned')),
  by_user       uuid,
  by_label      text not null default '',
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  undone_at     timestamptz,
  undone_by     text,
  undo_kept     integer
);
create unique index if not exists academic_upload_one_per_school on public.academic_upload_batches (school_id) where state = 'in_progress';
create index if not exists academic_upload_school_idx on public.academic_upload_batches (school_id, started_at desc);
alter table public.academic_upload_batches enable row level security;
revoke all on table public.academic_upload_batches from public, anon, authenticated;

-- 2. Scholar IDs: cleaning and the keys used to find a scholar whose ID lost its dash or its leading zeros (indexed, so 10,000 rows are quick).
create or replace function public._academic_clean_id(p text)
returns text
language sql
immutable
as $$
  select regexp_replace(btrim(translate(coalesce(p, ''), E'‐‑‒–—− ​﻿', '------ ')), '\s+', '', 'g');
$$;
create or replace function public._academic_id_key(p text)
returns text
language sql
immutable
as $$ select lower(regexp_replace(coalesce(p, ''), '[^a-zA-Z0-9]', '', 'g')); $$;
create or replace function public._academic_id_key0(p text)
returns text
language sql
immutable
as $$ select ltrim(lower(regexp_replace(coalesce(p, ''), '[^a-zA-Z0-9]', '', 'g')), '0'); $$;
create index if not exists scholars_id_lower_idx on public.scholars (lower(scholar_id_number));
create index if not exists scholars_id_key_idx on public.scholars (public._academic_id_key(scholar_id_number));
create index if not exists scholars_id_key0_idx on public.scholars (public._academic_id_key0(scholar_id_number));

-- 3. Which scholar a Scholar ID of a file is: exact; else (only when exactly one fits) without the dashes; else without the leading zeros. A scholar of another school is reported as such.
create or replace function public._academic_resolve_id(p_school uuid, p_raw text)
returns table(scholar_id text, other_school boolean, how text, problem text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_c text := public._academic_clean_id(p_raw);
  v_k text; v_k0 text; v_n integer; v_id text; v_sch uuid;
begin
  if v_c = '' then return query select null::text, false, null::text, 'The Scholar ID is empty.'; return; end if;
  if v_c ~ '^[0-9]+([.,][0-9]+)?[eE][+-]?[0-9]+$' then
    return query select null::text, false, null::text, 'Excel changed this Scholar ID into a number (' || v_c || '), so it cannot be read. Format the Scholar ID column as Text and write the ID again.'; return;
  end if;
  -- 1. exactly as written
  select count(*), min(s.scholar_id_number), (array_agg(s.school_id))[1] into v_n, v_id, v_sch from public.scholars s where lower(s.scholar_id_number) = lower(v_c);
  if v_n = 1 then
    return query select v_id, v_sch is distinct from p_school, 'exact'::text, null::text; return;
  end if;
  v_k := public._academic_id_key(v_c); v_k0 := public._academic_id_key0(v_c);
  if v_k = '' then return query select null::text, false, null::text, 'Scholar ID not found.'; return; end if;
  -- 2. without dashes and the like: only the scholars of this school, only when exactly one fits
  select count(*), min(s.scholar_id_number) into v_n, v_id from public.scholars s where s.school_id = p_school and public._academic_id_key(s.scholar_id_number) = v_k;
  if v_n = 1 then return query select v_id, false, 'key'::text, null::text; return; end if;
  if v_n > 1 then return query select null::text, false, null::text, 'This Scholar ID fits more than one scholar of the school: write the full ID.'; return; end if;
  -- 3. without the leading zeros (Excel drops them)
  if v_k0 <> '' then
    select count(*), min(s.scholar_id_number) into v_n, v_id from public.scholars s where s.school_id = p_school and public._academic_id_key0(s.scholar_id_number) = v_k0;
    if v_n = 1 then return query select v_id, false, 'zeros'::text, null::text; return; end if;
    if v_n > 1 then return query select null::text, false, null::text, 'This Scholar ID fits more than one scholar of the school (leading zeros may have been lost): write the full ID.'; return; end if;
  end if;
  -- 4. a scholar of another school
  select count(*), min(s.scholar_id_number) into v_n, v_id from public.scholars s where public._academic_id_key(s.scholar_id_number) = v_k;
  if v_n = 1 then return query select v_id, true, 'key'::text, null::text; return; end if;
  return query select null::text, false, null::text, 'Scholar ID not found.';
end;
$$;
revoke all on function public._academic_resolve_id(uuid, text) from public, anon, authenticated;

-- 4. The check of the rows of a file for ONE school (nothing is saved). A row: {i, scholar_id, name, program, status, custom}.
create or replace function public._academic_upload_eval(p_school uuid, p_rows jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_out jsonb := '[]'::jsonb;
  e jsonb; v_n integer; v_i integer;
  res record; s public.scholars%rowtype;
  v_msgs text[]; v_errs text[];
  v_status text; v_new text; v_cur text; v_cur_c numeric; v_new_c numeric; v_clear boolean; v_c_txt text;
  v_action text; v_state text; v_seen text[] := '{}';
  v_school_name text; v_name_tokens text[]; v_file_tokens text[];
  sc record;
begin
  select * into sc from public._academic_school_scale(p_school);
  for e, v_n in select x.value, x.ordinality::integer from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) with ordinality as x(value, ordinality) loop
    v_i := coalesce(nullif(e ->> 'i', '')::integer, v_n);
    v_msgs := '{}'; v_errs := '{}'; v_action := 'skip'; s := null; v_cur := null; v_cur_c := null; v_new := null; v_new_c := null; v_clear := false;
    select * into res from public._academic_resolve_id(p_school, e ->> 'scholar_id');
    if res.problem is not null then v_errs := v_errs || res.problem;
    elsif res.other_school then
      select x.* into s from public.scholars x where x.scholar_id_number = res.scholar_id;
      select sch.name into v_school_name from public.schools sch where sch.id = s.school_id;
      v_errs := v_errs || ('This scholar belongs to another school (' || coalesce(v_school_name, 'unknown') || '): not changed.')::text;
    else
      select x.* into s from public.scholars x where x.scholar_id_number = res.scholar_id;
      if res.how = 'key' then v_msgs := v_msgs || ('The Scholar ID was read as ' || s.scholar_id_number || ' (the dash or spacing was different).')::text;
      elsif res.how = 'zeros' then v_msgs := v_msgs || ('The Scholar ID was read as ' || s.scholar_id_number || ' (leading zeros were missing).')::text; end if;
      if coalesce(s.status, '') = 'Removed' then v_errs := v_errs || 'This scholar has been removed: not changed.'::text; end if;
      if s.scholar_id_number = any (v_seen) then v_errs := v_errs || 'This scholar is in the file more than once: only the first row is used.'::text; end if;
      v_seen := v_seen || s.scholar_id_number;
    end if;
    -- the status asked for
    v_status := btrim(coalesce(e ->> 'status', ''));
    if v_status = '' then v_msgs := v_msgs || 'The academic status is empty: this scholar is left as is.'::text; v_new := '__keep';
    elsif regexp_replace(lower(v_status), '[^a-z]', '', 'g') in ('notset', 'none', 'clear', 'remove') then v_new := null;
    else
      v_new := public._academic_status_of(v_status);
      if v_new is null then v_errs := v_errs || 'The academic status must be Academic, Non-academic or Not set.'::text; end if;
    end if;
    -- the custom passing GWA (optional): a number on the school's scale, or "none" to take it away
    v_c_txt := btrim(coalesce(e ->> 'custom', ''));
    if v_c_txt <> '' then
      if lower(v_c_txt) in ('none', 'clear', 'remove') then v_clear := true;
      elsif replace(v_c_txt, ',', '.') ~ '^[0-9]+(\.[0-9]+)?$' then
        v_new_c := replace(v_c_txt, ',', '.')::numeric;
        if sc.scale_min is null then v_errs := v_errs || 'This school has no grading setup yet, so a custom passing GWA cannot be set.'::text;
        elsif v_new_c < sc.scale_min or v_new_c > sc.scale_max then v_errs := v_errs || ('The custom passing GWA must be between ' || sc.scale_min || ' and ' || sc.scale_max || ' (the school''s own scale).')::text; end if;
      else v_errs := v_errs || 'The custom passing GWA must be a number (or "none").'::text; end if;
      if v_new is null and v_status <> '' and (v_new_c is not null) then v_errs := v_errs || 'A scholar with no status cannot have a custom passing GWA.'::text; end if;
    end if;
    if cardinality(v_errs) = 0 then
      select t.academic_status, t.custom_passing_gwa into v_cur, v_cur_c from public.scholar_academic_status t where t.scholar_id_number = s.scholar_id_number;
      if v_new = '__keep' then v_new := v_cur; end if;
      select sch.name into v_school_name from public.schools sch where sch.id = s.school_id;
      v_name_tokens := regexp_split_to_array(lower(regexp_replace(coalesce(s.first_name, '') || ' ' || coalesce(s.middle_name, '') || ' ' || coalesce(s.last_name, ''), '[^[:alnum:]]+', ' ', 'g')), '\s+');
      v_file_tokens := array(select t from unnest(regexp_split_to_array(lower(regexp_replace(coalesce(e ->> 'name', ''), '[^[:alnum:]]+', ' ', 'g')), '\s+')) t where t <> '');
      if cardinality(v_file_tokens) > 0 and exists (select 1 from unnest(v_file_tokens) t where not (t = any (v_name_tokens))) then v_msgs := v_msgs || 'The name in the file is different from the scholar''s name on record.'::text; end if;
      if nullif(btrim(coalesce(e ->> 'program', '')), '') is not null and public._program_key(e ->> 'program') <> public._program_key(s.course) then v_msgs := v_msgs || 'The program in the file is different from the scholar''s program on record.'::text; end if;
      if v_new is null and v_new_c is not null then v_errs := v_errs || 'A scholar with no status cannot have a custom passing GWA.'::text; end if;
    end if;
    if cardinality(v_errs) = 0 then
      if v_new is not distinct from v_cur and (v_new is null or (not v_clear and (v_new_c is null or v_new_c is not distinct from v_cur_c)) or (v_clear and v_cur_c is null)) then
        v_action := 'skip'; v_msgs := v_msgs || 'Nothing to change: the scholar already has this.'::text;
      else v_action := 'set'; end if;
    end if;
    v_state := case when cardinality(v_errs) > 0 then 'error' when cardinality(v_msgs) > 0 then 'warning' else 'valid' end;
    v_out := v_out || jsonb_build_object('i', v_i, 'state', v_state, 'action', case when cardinality(v_errs) > 0 then 'none' else v_action end, 'messages', to_jsonb(v_errs || v_msgs),
      'scholar_id', case when res.problem is null and not coalesce(res.other_school, false) then s.scholar_id_number else null end,
      'name', case when s.scholar_id_number is null then null else btrim(coalesce(s.last_name, '') || ', ' || coalesce(s.first_name, '')) end, 'program', s.course,
      'current_status', v_cur, 'new_status', v_new, 'current_custom', v_cur_c, 'new_custom', case when v_clear then null else v_new_c end, 'clear_custom', v_clear);
  end loop;
  return v_out;
end;
$$;
revoke all on function public._academic_upload_eval(uuid, jsonb) from public, anon, authenticated;

create or replace function public.academic_upload_check(p_school uuid, p_rows jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._academic_require_manager();
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'There are no rows to check.'; end if;
  if jsonb_array_length(p_rows) > 600 then raise exception 'At most 600 rows can be checked at a time.'; end if;
  return jsonb_build_object('rows', public._academic_upload_eval(p_school, p_rows));
end;
$$;
revoke all on function public.academic_upload_check(uuid, jsonb) from public, anon;
grant execute on function public.academic_upload_check(uuid, jsonb) to authenticated;

-- 5. Opens a numbered batch and locks the school: one upload per school at a time. A batch left open for more than 3 hours (a closed browser) is released.
create or replace function public.academic_upload_start(p_school uuid, p_file_name text, p_total integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare b public.academic_upload_batches%rowtype; o public.academic_upload_batches%rowtype;
begin
  perform public._academic_require_manager();
  if not exists (select 1 from public.schools where id = p_school) then raise exception 'Choose a school.'; end if;
  update public.academic_upload_batches set state = 'abandoned', finished_at = now() where school_id = p_school and state = 'in_progress' and started_at < now() - interval '3 hours';
  select * into o from public.academic_upload_batches where school_id = p_school and state = 'in_progress';
  if found then raise exception 'Another upload for this school is in progress (batch %, started by % at %). Wait until it finishes, then try again.', o.batch_no, o.by_label, to_char(o.started_at at time zone 'Asia/Manila', 'Mon DD, HH12:MI AM'); end if;
  insert into public.academic_upload_batches (school_id, file_name, total_rows, by_user, by_label) values (p_school, left(coalesce(p_file_name, ''), 200), greatest(coalesce(p_total, 0), 0), auth.uid(), public._actor_name()) returning * into b;
  return jsonb_build_object('id', b.id, 'batch_no', b.batch_no);
exception when unique_violation then
  raise exception 'Another upload for this school is in progress. Wait until it finishes, then try again.';
end;
$$;
revoke all on function public.academic_upload_start(uuid, text, integer) from public, anon;
grant execute on function public.academic_upload_start(uuid, text, integer) to authenticated;

-- 6. Saves the ready rows of a chunk (checked again first). The same rows twice change nothing the second time.
create or replace function public.academic_upload_apply(p_batch uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.academic_upload_batches%rowtype;
  v jsonb; v_set integer := 0; v_same integer := 0; v_err integer := 0; v_warn integer := 0; v_rc text[]; v_queued integer := 0; v_now integer := 0;
begin
  perform public._academic_require_manager();
  select * into b from public.academic_upload_batches where id = p_batch for update;
  if not found then raise exception 'That upload was not found.'; end if;
  if b.state <> 'in_progress' then raise exception 'This upload is already closed.'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'There are no rows to save.'; end if;
  if jsonb_array_length(p_rows) > 600 then raise exception 'At most 600 rows can be saved at a time.'; end if;
  v := public._academic_upload_eval(b.school_id, p_rows);
  select count(*) filter (where x ->> 'action' = 'set'), count(*) filter (where x ->> 'state' <> 'error' and x ->> 'action' = 'skip'), count(*) filter (where x ->> 'state' = 'error'), count(*) filter (where x ->> 'state' = 'warning')
    into v_set, v_same, v_err, v_warn from jsonb_array_elements(v) x;
  if v_set > 0 then
    with src as (
      select x ->> 'scholar_id' id, nullif(x ->> 'new_status', '') ns, (x ->> 'new_custom')::numeric nc, coalesce((x ->> 'clear_custom')::boolean, false) clr
      from jsonb_array_elements(v) x where x ->> 'action' = 'set'
    ), cur as (
      select s.id, s.ns, s.nc, s.clr, t.academic_status os, t.custom_passing_gwa oc,
             case when s.ns is null then null when s.clr then null when s.nc is not null then s.nc else t.custom_passing_gwa end fc
      from src s left join public.scholar_academic_status t on t.scholar_id_number = s.id
    ), hist as (
      insert into public.academic_status_history (scholar_id_number, school_id, old_status, new_status, old_custom_gwa, new_custom_gwa, how, batch_no, by_user, by_label)
      select c.id, b.school_id, c.os, c.ns, c.oc, c.fc, 'upload', b.batch_no, auth.uid(), public._actor_name() from cur c returning 1
    ), up as (
      insert into public.scholar_academic_status (scholar_id_number, academic_status, custom_passing_gwa, source, reason, updated_by, updated_at)
      select c.id, c.ns, c.fc, 'file', 'Upload #' || b.batch_no, auth.uid(), now() from cur c where c.ns is not null
      on conflict (scholar_id_number) do update set academic_status = excluded.academic_status, custom_passing_gwa = excluded.custom_passing_gwa, source = 'file', reason = excluded.reason, updated_by = excluded.updated_by, updated_at = excluded.updated_at
      returning 1
    ), del as (
      delete from public.scholar_academic_status d where d.scholar_id_number in (select c.id from cur c where c.ns is null) returning 1
    )
    select array_agg(c.id) filter (where public._academic_passing_of(b.school_id, c.os, c.oc) is distinct from public._academic_passing_of(b.school_id, c.ns, c.fc)) into v_rc from cur c;
    v_queued := public._academic_enqueue_recheck(v_rc, 'upload');
    if v_queued > 0 and v_queued <= 10 then v_now := public._academic_recheck_process(10); end if;
  end if;
  update public.academic_upload_batches set set_count = set_count + v_set, same_count = same_count + v_same, error_count = error_count + v_err, warning_count = warning_count + v_warn where id = b.id;
  return jsonb_build_object('set', v_set, 'same', v_same, 'errors', v_err, 'rechecks', v_queued, 'rechecked_now', v_now);
end;
$$;
revoke all on function public.academic_upload_apply(uuid, jsonb) from public, anon;
grant execute on function public.academic_upload_apply(uuid, jsonb) to authenticated;

create or replace function public.academic_upload_finish(p_batch uuid, p_errors integer default 0)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare b public.academic_upload_batches%rowtype;
begin
  perform public._academic_require_manager();
  update public.academic_upload_batches set state = 'finished', finished_at = now(), error_count = greatest(error_count, coalesce(p_errors, 0)) where id = p_batch and state = 'in_progress' returning * into b;
  if not found then raise exception 'That upload is not open.'; end if;
  if b.set_count > 0 then
    insert into public.academic_settings_audit (by_label, what) values (b.by_label, 'Upload #' || b.batch_no || ' (' || b.file_name || '): ' || b.set_count || ' scholar(s) changed.');
  end if;
  return jsonb_build_object('batch_no', b.batch_no, 'set', b.set_count, 'same', b.same_count, 'errors', b.error_count);
end;
$$;
revoke all on function public.academic_upload_finish(uuid, integer) from public, anon;
grant execute on function public.academic_upload_finish(uuid, integer) to authenticated;

-- 7. The past uploads of a school.
create or replace function public.academic_upload_list(p_school uuid)
returns table(id uuid, batch_no integer, file_name text, by_label text, started_at timestamptz, finished_at timestamptz, state text, total_rows integer, set_count integer, same_count integer, error_count integer, can_undo boolean, undone_at timestamptz, undo_kept integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._academic_require_manager();
  return query
  select b.id, b.batch_no, b.file_name, b.by_label, b.started_at, b.finished_at, b.state, b.total_rows, b.set_count, b.same_count, b.error_count,
         (b.state = 'finished' and b.set_count > 0 and b.started_at > now() - interval '30 days' and not exists (select 1 from public.academic_upload_batches o where o.school_id = b.school_id and o.state = 'in_progress')),
         b.undone_at, b.undo_kept
  from public.academic_upload_batches b where b.school_id = p_school order by b.batch_no desc limit 50;
end;
$$;
revoke all on function public.academic_upload_list(uuid) from public, anon;
grant execute on function public.academic_upload_list(uuid) to authenticated;

-- 8. Undo an upload: each scholar it changed goes back to what they were before it, but only if they are still at the value the upload set (anybody changed afterwards is left alone and counted).
create or replace function public.academic_upload_undo(p_batch uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.academic_upload_batches%rowtype;
  v_restored integer := 0; v_kept integer := 0; v_rc text[]; v_queued integer := 0;
begin
  perform public._academic_require_manager();
  select * into b from public.academic_upload_batches where id = p_batch for update;
  if not found then raise exception 'That upload was not found.'; end if;
  if b.state <> 'finished' then raise exception 'Only a finished upload can be undone.'; end if;
  if b.started_at < now() - interval '30 days' then raise exception 'An upload can be undone for 30 days; this one is older.'; end if;
  if exists (select 1 from public.academic_upload_batches o where o.school_id = b.school_id and o.state = 'in_progress') then raise exception 'Another upload for this school is in progress: wait until it finishes.'; end if;
  with per as (
    select h.scholar_id_number id,
           (array_agg(h.old_status order by h.id asc))[1] os, (array_agg(h.old_custom_gwa order by h.id asc))[1] oc,
           (array_agg(h.new_status order by h.id desc))[1] ns, (array_agg(h.new_custom_gwa order by h.id desc))[1] nc
    from public.academic_status_history h where h.batch_no = b.batch_no and h.how = 'upload' group by h.scholar_id_number
  ), cur as (
    select p.*, t.academic_status cs, t.custom_passing_gwa cc, (t.academic_status is not distinct from p.ns and t.custom_passing_gwa is not distinct from p.nc) as still
    from per p left join public.scholar_academic_status t on t.scholar_id_number = p.id
  ), ok as (select * from cur where still), hist as (
      insert into public.academic_status_history (scholar_id_number, school_id, old_status, new_status, old_custom_gwa, new_custom_gwa, how, batch_no, reason, by_user, by_label)
      select o.id, b.school_id, o.cs, o.os, o.cc, o.oc, 'undo', b.batch_no, 'Undo of upload #' || b.batch_no, auth.uid(), public._actor_name() from ok o returning 1
  ), up as (
      insert into public.scholar_academic_status (scholar_id_number, academic_status, custom_passing_gwa, source, reason, updated_by, updated_at)
      select o.id, o.os, o.oc, 'manual', 'Undo of upload #' || b.batch_no, auth.uid(), now() from ok o where o.os is not null
      on conflict (scholar_id_number) do update set academic_status = excluded.academic_status, custom_passing_gwa = excluded.custom_passing_gwa, source = 'manual', reason = excluded.reason, updated_by = excluded.updated_by, updated_at = excluded.updated_at
      returning 1
  ), del as (
      delete from public.scholar_academic_status d where d.scholar_id_number in (select o.id from ok o where o.os is null) returning 1
  )
  select (select count(*) from ok), (select count(*) from cur where not still),
         (select array_agg(o.id) filter (where public._academic_passing_of(b.school_id, o.cs, o.cc) is distinct from public._academic_passing_of(b.school_id, o.os, o.oc)) from ok o)
  into v_restored, v_kept, v_rc;
  v_queued := public._academic_enqueue_recheck(v_rc, 'undo');
  update public.academic_upload_batches set state = 'undone', undone_at = now(), undone_by = public._actor_name(), undo_kept = v_kept where id = b.id;
  insert into public.academic_settings_audit (by_label, what) values (public._actor_name(), 'Upload #' || b.batch_no || ' undone: ' || v_restored || ' restored, ' || v_kept || ' left alone (changed since).');
  return jsonb_build_object('restored', v_restored, 'kept', v_kept, 'rechecks', v_queued);
end;
$$;
revoke all on function public.academic_upload_undo(uuid) from public, anon;
grant execute on function public.academic_upload_undo(uuid) to authenticated;

-- 9. The scholars of a school for the template (read page by page, 1,000 at a time).
create or replace function public.academic_template_rows(p_school uuid, p_offset integer default 0, p_limit integer default 1000)
returns table(scholar_id_number text, name text, school text, program text, year_level text, academic_status text, custom_passing_gwa numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._academic_require_manager();
  return query
  select s.scholar_id_number, btrim(coalesce(s.last_name, '') || ', ' || coalesce(s.first_name, '')), sc.name, s.course, s.year_level, t.academic_status, t.custom_passing_gwa
  from public.scholars s join public.schools sc on sc.id = s.school_id left join public.scholar_academic_status t on t.scholar_id_number = s.scholar_id_number
  where s.school_id = p_school and coalesce(s.status, '') <> 'Removed'
  order by lower(coalesce(s.last_name, '')), lower(coalesce(s.first_name, '')), s.scholar_id_number
  limit least(greatest(coalesce(p_limit, 1000), 1), 1000) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;
revoke all on function public.academic_template_rows(uuid, integer, integer) from public, anon;
grant execute on function public.academic_template_rows(uuid, integer, integer) to authenticated;

-- 10. The history now also shows the batch number.
drop function if exists public.academic_status_history_scholar(text);
create or replace function public.academic_status_history_scholar(p_scholar text)
returns table(at timestamptz, old_status text, new_status text, old_custom_gwa numeric, new_custom_gwa numeric, how text, reason text, by_label text, batch_no integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._academic_require_manager();
  return query select h.at, h.old_status, h.new_status, h.old_custom_gwa, h.new_custom_gwa, h.how, h.reason, h.by_label, h.batch_no
  from public.academic_status_history h where h.scholar_id_number = p_scholar order by h.at desc, h.id desc limit 200;
end;
$$;
revoke all on function public.academic_status_history_scholar(text) from public, anon;
grant execute on function public.academic_status_history_scholar(text) to authenticated;

drop function if exists public.academic_status_history_school(uuid, integer, integer);
create or replace function public.academic_status_history_school(p_school uuid, p_limit integer default 50, p_offset integer default 0)
returns table(total bigint, at timestamptz, scholar_id_number text, name text, old_status text, new_status text, old_custom_gwa numeric, new_custom_gwa numeric, how text, reason text, by_label text, batch_no integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._academic_require_manager();
  return query select count(*) over (), h.at, h.scholar_id_number, btrim(coalesce(s.last_name, '') || ', ' || coalesce(s.first_name, '')), h.old_status, h.new_status, h.old_custom_gwa, h.new_custom_gwa, h.how, h.reason, h.by_label, h.batch_no
  from public.academic_status_history h left join public.scholars s on s.scholar_id_number = h.scholar_id_number
  where h.school_id = p_school order by h.at desc, h.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;
revoke all on function public.academic_status_history_school(uuid, integer, integer) from public, anon;
grant execute on function public.academic_status_history_school(uuid, integer, integer) to authenticated;

notify pgrst, 'reload schema';
commit;
