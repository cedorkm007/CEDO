-- ─────────────────────────────────────────────────────────────
-- supabase_migration_academic_scholar_overrides.sql
-- SCHOLAR MANAGEMENT TOOLS > SCHOLARS > GRADES AND ACADEMIC MANAGEMENT: A SCHOLAR'S OWN ACADEMIC STATUS (for the scholars whose academic status differs from the one of their program), SET IN BULK FROM A FILE.   Safe to run twice.
-- Undo: undo_academic_scholar_overrides.sql
--   * Until now the academic status (Academic / Non-academic) belonged to the PROGRAM of a school. A scholar can now have an OWN status that wins over the program's: it decides which passing GWA the renewal compares the scholar's GWA with
--     (the passing GWA of Academic or of Non-academic of the scholar's school). A scholar without an own status follows the program, exactly as before.
--   * academic_bulk_check(rows): checks a file's rows and saves NOTHING; academic_bulk_save(rows): sets (or takes away) the own status of the scholars whose row passes the same check. Scholars are found by Scholar ID only;
--     the full name, school and program in the file are only compared with the record (a difference is a warning). A row that asks for the status the scholar already follows changes nothing; asking for the program's own status
--     takes the scholar's own status away. Saving makes the open renewals be checked again in the background, like any change of these settings.
--   * academic_overrides_list(): everyone who has an own status now, to download, correct and upload again.
--   Only the accounts that may use the tab (the Scholar Management tag) can do any of this. Adds one table and four functions, and replaces one function (the original is in the undo file). Nothing is deleted.
-- Needs supabase_migration_academic_per_school.sql.
-- ─────────────────────────────────────────────────────────────

begin;

do $$ begin
  if to_regprocedure('public._academic_require_manager()') is null or to_regclass('public.academic_school_programs') is null then
    raise exception 'STOPPED, nothing changed: run supabase_migration_academic_status.sql and supabase_migration_academic_per_school.sql first.';
  end if;
end $$;

-- 1. A scholar's own academic status.
create table if not exists public.academic_scholar_overrides (
  scholar_id_number text primary key,
  academic_status   text not null check (academic_status in ('academic', 'non_academic')),
  updated_by        uuid,
  updated_at        timestamptz not null default now()
);
alter table public.academic_scholar_overrides enable row level security;
revoke all on table public.academic_scholar_overrides from public, anon, authenticated;

-- 2. The academic status and the passing GWA of a scholar: the scholar's own status first, then the program's (a program that is not placed yet counts as ACADEMIC). null = no passing GWA is set.
create or replace function public._scholar_academic(p_scholar text)
returns table(academic_status text, is_set boolean, passing_gwa numeric, special boolean)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(o.academic_status, sp.academic_status, 'academic'), (o.scholar_id_number is not null or sp.program_key is not null),
         case when o.scholar_id_number is not null
              then case o.academic_status when 'non_academic' then ss.non_academic_passing_gwa else ss.academic_passing_gwa end
              else coalesce(sp.special_passing_gwa, case coalesce(sp.academic_status, 'academic') when 'non_academic' then ss.non_academic_passing_gwa else ss.academic_passing_gwa end) end,
         (o.scholar_id_number is null and sp.special_passing_gwa is not null)
  from public.scholars s
  left join public.academic_scholar_overrides o on o.scholar_id_number = s.scholar_id_number
  left join public.academic_school_settings ss on ss.school_id = s.school_id
  left join public.academic_school_programs sp on sp.school_id = s.school_id and sp.program_key = public._program_key(s.course)
  where s.scholar_id_number = p_scholar;
$$;
revoke all on function public._scholar_academic(text) from public, anon, authenticated;

-- 3. Words -> status ("Academic", "non-academic", "Non Academic" ...).
create or replace function public._academic_status_of(p_text text)
returns text
language sql
immutable
as $$
  select case when regexp_replace(lower(btrim(coalesce(p_text, ''))), '[^a-z]', '', 'g') = 'academic' then 'academic'
              when regexp_replace(lower(btrim(coalesce(p_text, ''))), '[^a-z]', '', 'g') = 'nonacademic' then 'non_academic' else null end;
$$;
revoke all on function public._academic_status_of(text) from public, anon, authenticated;

-- 4. The check of the rows of a file (nothing is saved). A row: {i, scholar_id, name, school, program, status}.
create or replace function public._academic_bulk_eval(p_rows jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_row jsonb;
  v_n integer;
  v_i integer;
  s public.scholars%rowtype;
  v_msgs text[]; v_errs text[];
  v_new text; v_prog text; v_cur text; v_own text; v_action text; v_state text;
  v_seen text[] := '{}';
  v_school_name text;
  v_name_tokens text[]; v_file_tokens text[];
begin
  for v_row, v_n in select e.value, e.ordinality::integer from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) with ordinality as e(value, ordinality) loop
    v_i := coalesce(nullif(v_row ->> 'i', '')::integer, v_n);
    v_msgs := '{}'; v_errs := '{}'; v_action := 'skip'; s := null; v_prog := null; v_cur := null; v_own := null;
    select x.* into s from public.scholars x where lower(x.scholar_id_number) = lower(btrim(coalesce(v_row ->> 'scholar_id', ''))) limit 1;
    v_new := public._academic_status_of(v_row ->> 'status');
    if s.scholar_id_number is null then v_errs := v_errs || 'Scholar ID not found.'::text; end if;
    if v_new is null then v_errs := v_errs || 'The academic status must be Academic or Non-academic.'::text; end if;
    if s.scholar_id_number is not null and v_new is not null then
      if s.scholar_id_number = any (v_seen) then v_errs := v_errs || 'This scholar is in the file more than once: only the first row is used.'::text; end if;
      v_seen := v_seen || s.scholar_id_number;
    end if;
    if cardinality(v_errs) = 0 then
      select sp.academic_status into v_prog from public.academic_school_programs sp where sp.school_id = s.school_id and sp.program_key = public._program_key(s.course);
      select o.academic_status into v_own from public.academic_scholar_overrides o where o.scholar_id_number = s.scholar_id_number;
      v_cur := coalesce(v_own, v_prog, 'academic');
      -- the name, school and program in the file are only compared with the record
      select sc.name into v_school_name from public.schools sc where sc.id = s.school_id;
      v_name_tokens := regexp_split_to_array(lower(regexp_replace(coalesce(s.first_name, '') || ' ' || coalesce(s.middle_name, '') || ' ' || coalesce(s.last_name, ''), '[^[:alnum:]]+', ' ', 'g')), '\s+');
      v_file_tokens := array(select t from unnest(regexp_split_to_array(lower(regexp_replace(coalesce(v_row ->> 'name', ''), '[^[:alnum:]]+', ' ', 'g')), '\s+')) t where t <> '');
      if cardinality(v_file_tokens) > 0 and exists (select 1 from unnest(v_file_tokens) t where not (t = any (v_name_tokens))) then v_msgs := v_msgs || 'The name in the file is different from the scholar''s name on record.'::text; end if;
      if nullif(btrim(coalesce(v_row ->> 'school', '')), '') is not null and lower(btrim(v_row ->> 'school')) <> lower(btrim(coalesce(v_school_name, ''))) then v_msgs := v_msgs || 'The school in the file is different from the scholar''s school on record.'::text; end if;
      if nullif(btrim(coalesce(v_row ->> 'program', '')), '') is not null and public._program_key(v_row ->> 'program') <> public._program_key(s.course) then v_msgs := v_msgs || 'The program in the file is different from the scholar''s program on record.'::text; end if;
      if v_new = coalesce(v_prog, 'academic') then
        if v_own is not null then v_action := 'reset'; v_msgs := v_msgs || 'This is the status of the scholar''s program: the scholar''s own status is taken away.'::text;
        else v_action := 'skip'; v_msgs := v_msgs || 'The scholar already follows this status (the program''s): nothing to change.'::text; end if;
      elsif v_own = v_new then v_action := 'skip'; v_msgs := v_msgs || 'The scholar already has this own status: nothing to change.'::text;
      else v_action := 'set'; end if;
    end if;
    v_state := case when cardinality(v_errs) > 0 then 'error' when cardinality(v_msgs) > 0 then 'warning' else 'valid' end;
    v_out := v_out || jsonb_build_object('i', v_i, 'state', v_state, 'action', case when cardinality(v_errs) > 0 then 'none' else v_action end,
      'messages', to_jsonb(v_errs || v_msgs), 'scholar_id', s.scholar_id_number, 'name', case when s.scholar_id_number is null then null else btrim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')) end,
      'school', v_school_name, 'program', s.course, 'program_status', coalesce(v_prog, case when s.scholar_id_number is null then null else 'academic' end), 'current_status', v_cur, 'new_status', v_new);
  end loop;
  return v_out;
end;
$$;
revoke all on function public._academic_bulk_eval(jsonb) from public, anon, authenticated;

create or replace function public.academic_bulk_check(p_rows jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v jsonb;
begin
  perform public._academic_require_manager();
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'There are no rows to check.'; end if;
  if jsonb_array_length(p_rows) > 3000 then raise exception 'A file can have at most 3,000 rows.'; end if;
  v := public._academic_bulk_eval(p_rows);
  return jsonb_build_object('rows', v,
    'valid', (select count(*) from jsonb_array_elements(v) e where e.value ->> 'state' = 'valid'),
    'warning', (select count(*) from jsonb_array_elements(v) e where e.value ->> 'state' = 'warning'),
    'error', (select count(*) from jsonb_array_elements(v) e where e.value ->> 'state' = 'error'),
    'will_set', (select count(*) from jsonb_array_elements(v) e where e.value ->> 'action' = 'set'),
    'will_reset', (select count(*) from jsonb_array_elements(v) e where e.value ->> 'action' = 'reset'));
end;
$$;
revoke all on function public.academic_bulk_check(jsonb) from public, anon;
grant execute on function public.academic_bulk_check(jsonb) to authenticated;

-- 5. The save: the rows are checked again; the own status is set or taken away; the open renewals are checked again in the background.
create or replace function public.academic_bulk_save(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb; e jsonb;
  v_set integer := 0; v_reset integer := 0; v_skipped integer := 0; v_errors integer := 0;
begin
  perform public._academic_require_manager();
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'There are no rows to save.'; end if;
  if jsonb_array_length(p_rows) > 3000 then raise exception 'A file can have at most 3,000 rows.'; end if;
  v := public._academic_bulk_eval(p_rows);
  for e in select x.value from jsonb_array_elements(v) x loop
    if e ->> 'action' = 'set' then
      insert into public.academic_scholar_overrides (scholar_id_number, academic_status, updated_by, updated_at) values (e ->> 'scholar_id', e ->> 'new_status', auth.uid(), now())
      on conflict (scholar_id_number) do update set academic_status = excluded.academic_status, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
      v_set := v_set + 1;
    elsif e ->> 'action' = 'reset' then
      delete from public.academic_scholar_overrides where scholar_id_number = e ->> 'scholar_id'; v_reset := v_reset + 1;
    elsif e ->> 'state' = 'error' then v_errors := v_errors + 1;
    else v_skipped := v_skipped + 1; end if;
  end loop;
  if v_set + v_reset > 0 then
    update public.academic_gwa_settings set version = version + 1, updated_at = now() where id;      -- the open renewals are checked again in the background
    insert into public.academic_settings_audit (by_label, what) values (public._actor_name(), 'Bulk upload of scholars'' own academic status: ' || v_set || ' set, ' || v_reset || ' taken away.');
  end if;
  return jsonb_build_object('set', v_set, 'reset', v_reset, 'skipped', v_skipped, 'errors', v_errors,
    'results', (select coalesce(jsonb_agg(jsonb_build_object('i', (x.value ->> 'i')::integer, 'outcome', case when x.value ->> 'action' = 'set' then 'set' when x.value ->> 'action' = 'reset' then 'reset' when x.value ->> 'state' = 'error' then 'error' else 'skipped' end,
      'message', x.value -> 'messages' ->> 0)), '[]'::jsonb) from jsonb_array_elements(v) x));
end;
$$;
revoke all on function public.academic_bulk_save(jsonb) from public, anon;
grant execute on function public.academic_bulk_save(jsonb) to authenticated;

-- 6. Everyone who has an own status now (to download, correct and upload again).
create or replace function public.academic_overrides_list()
returns table(scholar_id_number text, name text, school text, program text, academic_status text, program_status text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._academic_require_manager();
  return query
  select o.scholar_id_number, btrim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')), sc.name, s.course, o.academic_status,
         coalesce((select sp.academic_status from public.academic_school_programs sp where sp.school_id = s.school_id and sp.program_key = public._program_key(s.course)), 'academic')
  from public.academic_scholar_overrides o
  join public.scholars s on s.scholar_id_number = o.scholar_id_number
  left join public.schools sc on sc.id = s.school_id
  order by s.last_name, s.first_name, o.scholar_id_number;
end;
$$;
revoke all on function public.academic_overrides_list() from public, anon;
grant execute on function public.academic_overrides_list() to authenticated;

notify pgrst, 'reload schema';
commit;
