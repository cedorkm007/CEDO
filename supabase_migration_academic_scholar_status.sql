-- ─────────────────────────────────────────────────────────────
-- supabase_migration_academic_scholar_status.sql
-- GRADES AND ACADEMIC MANAGEMENT, PHASE 1A: THE ACADEMIC STATUS (Academic / Non-academic) NOW BELONGS TO THE SCHOLAR, NOT TO THE PROGRAM.   Safe to run twice.   Undo: undo_academic_scholar_status.sql
--   * New table scholar_academic_status: one row per scholar WHO HAS a status (Scholar ID, status, an optional "custom passing GWA" of that scholar, where the status came from, who and when). No row = NOT SET.
--   * New table academic_status_history: every change of a scholar's status (old / new, how, who, when), starting with the move of today.
--   * THE MOVE (nobody's renewal result changes): every scholar who is not Removed gets the status that applies TODAY:
--         1) the scholar's own status (the earlier "set by file"), if there is one;
--         2) otherwise the status of the scholar's program in the scholar's school (the placement the staff made);
--         3) otherwise NOTHING: the scholar stays NOT SET (they are not made Academic silently).
--     A special program's own passing GWA is copied to its scholars as their "custom passing GWA", so the number used for them does not change.
--   * The renewal (through _scholar_academic) now reads ONLY the scholar's status + the school's passing GWA for that status (or the scholar's custom passing GWA). A scholar who is NOT SET is checked as Academic, exactly as
--     before (a program that was not placed counted as Academic), and is counted in the warnings below.
--   * The old "set by file" (Grades and Academic Management) now sets the scholar's status in the new table; its functions are replaced. The program tables and the old own-status table are KEPT, hidden, as a backup. Nothing is deleted.
--   * Warnings: academic_not_set_summary() (per school: scholars, how many have no status, whether the school has a passing GWA, i.e. whether the GWA rule is on) and academic_not_set_list(school, limit, offset) (the scholars to fix).
--   Only the accounts that may use the tab (the Scholar Management tag) can read or change any of this.
-- Needs supabase_migration_academic_scholar_overrides.sql.
-- ─────────────────────────────────────────────────────────────

begin;

do $$ begin
  if to_regclass('public.academic_scholar_overrides') is null or to_regprocedure('public._academic_bulk_eval(jsonb)') is null then
    raise exception 'STOPPED, nothing changed: run supabase_migration_academic_scholar_overrides.sql first.';
  end if;
end $$;

-- 1. The status of each scholar, and its history.
create table if not exists public.scholar_academic_status (
  scholar_id_number  text primary key,
  academic_status    text not null check (academic_status in ('academic', 'non_academic')),
  custom_passing_gwa numeric,
  source             text not null default 'manual' check (source in ('manual', 'file', 'own', 'program')),
  reason             text,
  updated_by         uuid,
  updated_at         timestamptz not null default now()
);
create table if not exists public.academic_status_history (
  id             bigint generated always as identity primary key,
  scholar_id_number text not null,
  school_id      uuid,
  old_status     text,
  new_status     text,
  old_custom_gwa numeric,
  new_custom_gwa numeric,
  how            text not null,
  batch_no       integer,
  reason         text,
  by_user        uuid,
  by_label       text not null default '',
  at             timestamptz not null default now()
);
create index if not exists academic_status_history_scholar_idx on public.academic_status_history (scholar_id_number, at desc);
create index if not exists academic_status_history_school_idx on public.academic_status_history (school_id, at desc);
alter table public.scholar_academic_status enable row level security;
alter table public.academic_status_history enable row level security;
revoke all on table public.scholar_academic_status, public.academic_status_history from public, anon, authenticated;

-- 2. THE MOVE: what applies today becomes the scholar's own row. Nothing is overwritten; running it again adds nothing.
do $$
declare v_own integer := 0; v_prog integer := 0;
begin
  with ins as (
    insert into public.scholar_academic_status (scholar_id_number, academic_status, custom_passing_gwa, source, updated_at)
    select o.scholar_id_number, o.academic_status, null, 'own', coalesce(o.updated_at, now())
    from public.academic_scholar_overrides o
    on conflict (scholar_id_number) do nothing
    returning scholar_id_number, academic_status, custom_passing_gwa
  ), h as (
    insert into public.academic_status_history (scholar_id_number, school_id, new_status, new_custom_gwa, how, reason, by_label)
    select i.scholar_id_number, s.school_id, i.academic_status, i.custom_passing_gwa, 'migration', 'Moved from the scholar''s own status', 'System'
    from ins i left join public.scholars s on s.scholar_id_number = i.scholar_id_number
    returning 1
  ) select count(*) into v_own from h;
  with ins as (
    insert into public.scholar_academic_status (scholar_id_number, academic_status, custom_passing_gwa, source)
    select s.scholar_id_number, sp.academic_status, sp.special_passing_gwa, 'program'
    from public.scholars s
    join public.academic_school_programs sp on sp.school_id = s.school_id and sp.program_key = public._program_key(s.course)
    where coalesce(s.status, '') <> 'Removed'
    on conflict (scholar_id_number) do nothing
    returning scholar_id_number, academic_status, custom_passing_gwa
  ), h as (
    insert into public.academic_status_history (scholar_id_number, school_id, new_status, new_custom_gwa, how, reason, by_label)
    select i.scholar_id_number, s.school_id, i.academic_status, i.custom_passing_gwa, 'migration', 'Moved from the status of the scholar''s program', 'System'
    from ins i left join public.scholars s on s.scholar_id_number = i.scholar_id_number
    returning 1
  ) select count(*) into v_prog from h;
  if v_own + v_prog > 0 then
    insert into public.academic_settings_audit (by_label, what) values ('System', 'The academic status moved from the programs to each scholar: ' || v_own || ' from the scholar''s own status, ' || v_prog || ' from the scholar''s program. The rest are Not set.');
  end if;
end $$;

-- 3. The status and the passing GWA the renewal uses: the scholar's status (Not set counts as Academic, is_set = false), the scholar's custom passing GWA if there is one, else the school's passing GWA for that status. null = no passing GWA is set.
create or replace function public._scholar_academic(p_scholar text)
returns table(academic_status text, is_set boolean, passing_gwa numeric, special boolean)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(t.academic_status, 'academic'), t.scholar_id_number is not null,
         coalesce(t.custom_passing_gwa, case coalesce(t.academic_status, 'academic') when 'non_academic' then ss.non_academic_passing_gwa else ss.academic_passing_gwa end),
         t.custom_passing_gwa is not null
  from public.scholars s
  left join public.academic_school_settings ss on ss.school_id = s.school_id
  left join public.scholar_academic_status t on t.scholar_id_number = s.scholar_id_number
  where s.scholar_id_number = p_scholar;
$$;
revoke all on function public._scholar_academic(text) from public, anon, authenticated;

-- 4. The check of the rows of "set by file" (nothing is saved): a row asks for a status; if the scholar already has it nothing changes.
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
  v_new text; v_cur text; v_action text; v_state text;
  v_seen text[] := '{}';
  v_school_name text;
  v_name_tokens text[]; v_file_tokens text[];
begin
  for v_row, v_n in select e.value, e.ordinality::integer from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) with ordinality as e(value, ordinality) loop
    v_i := coalesce(nullif(v_row ->> 'i', '')::integer, v_n);
    v_msgs := '{}'; v_errs := '{}'; v_action := 'skip'; s := null; v_cur := null;
    select x.* into s from public.scholars x where lower(x.scholar_id_number) = lower(btrim(coalesce(v_row ->> 'scholar_id', ''))) limit 1;
    v_new := public._academic_status_of(v_row ->> 'status');
    if s.scholar_id_number is null then v_errs := v_errs || 'Scholar ID not found.'::text; end if;
    if v_new is null then v_errs := v_errs || 'The academic status must be Academic or Non-academic.'::text; end if;
    if s.scholar_id_number is not null and v_new is not null then
      if s.scholar_id_number = any (v_seen) then v_errs := v_errs || 'This scholar is in the file more than once: only the first row is used.'::text; end if;
      v_seen := v_seen || s.scholar_id_number;
    end if;
    if cardinality(v_errs) = 0 then
      select t.academic_status into v_cur from public.scholar_academic_status t where t.scholar_id_number = s.scholar_id_number;
      -- the name, school and program in the file are only compared with the record
      select sc.name into v_school_name from public.schools sc where sc.id = s.school_id;
      v_name_tokens := regexp_split_to_array(lower(regexp_replace(coalesce(s.first_name, '') || ' ' || coalesce(s.middle_name, '') || ' ' || coalesce(s.last_name, ''), '[^[:alnum:]]+', ' ', 'g')), '\s+');
      v_file_tokens := array(select t from unnest(regexp_split_to_array(lower(regexp_replace(coalesce(v_row ->> 'name', ''), '[^[:alnum:]]+', ' ', 'g')), '\s+')) t where t <> '');
      if cardinality(v_file_tokens) > 0 and exists (select 1 from unnest(v_file_tokens) t where not (t = any (v_name_tokens))) then v_msgs := v_msgs || 'The name in the file is different from the scholar''s name on record.'::text; end if;
      if nullif(btrim(coalesce(v_row ->> 'school', '')), '') is not null and lower(btrim(v_row ->> 'school')) <> lower(btrim(coalesce(v_school_name, ''))) then v_msgs := v_msgs || 'The school in the file is different from the scholar''s school on record.'::text; end if;
      if nullif(btrim(coalesce(v_row ->> 'program', '')), '') is not null and public._program_key(v_row ->> 'program') <> public._program_key(s.course) then v_msgs := v_msgs || 'The program in the file is different from the scholar''s program on record.'::text; end if;
      if v_cur is not distinct from v_new then v_action := 'skip'; v_msgs := v_msgs || 'The scholar already has this status: nothing to change.'::text;
      else v_action := 'set'; end if;
    end if;
    v_state := case when cardinality(v_errs) > 0 then 'error' when cardinality(v_msgs) > 0 then 'warning' else 'valid' end;
    v_out := v_out || jsonb_build_object('i', v_i, 'state', v_state, 'action', case when cardinality(v_errs) > 0 then 'none' else v_action end,
      'messages', to_jsonb(v_errs || v_msgs), 'scholar_id', s.scholar_id_number, 'name', case when s.scholar_id_number is null then null else btrim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')) end,
      'school', v_school_name, 'program', s.course, 'program_status', null, 'current_status', v_cur, 'new_status', v_new);
  end loop;
  return v_out;
end;
$$;
revoke all on function public._academic_bulk_eval(jsonb) from public, anon, authenticated;

-- 5. The save of "set by file": the rows are checked again; the status is set; every change is written to the history; the open renewals are checked again in the background.
create or replace function public.academic_bulk_save(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb; e jsonb;
  v_set integer := 0; v_skipped integer := 0; v_errors integer := 0;
  v_old text; v_old_gwa numeric; v_school uuid;
begin
  perform public._academic_require_manager();
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'There are no rows to save.'; end if;
  if jsonb_array_length(p_rows) > 3000 then raise exception 'A file can have at most 3,000 rows.'; end if;
  v := public._academic_bulk_eval(p_rows);
  for e in select x.value from jsonb_array_elements(v) x loop
    if e ->> 'action' = 'set' then
      select t.academic_status, t.custom_passing_gwa into v_old, v_old_gwa from public.scholar_academic_status t where t.scholar_id_number = e ->> 'scholar_id';
      select s.school_id into v_school from public.scholars s where s.scholar_id_number = e ->> 'scholar_id';
      insert into public.scholar_academic_status (scholar_id_number, academic_status, source, updated_by, updated_at) values (e ->> 'scholar_id', e ->> 'new_status', 'file', auth.uid(), now())
      on conflict (scholar_id_number) do update set academic_status = excluded.academic_status, source = 'file', updated_by = excluded.updated_by, updated_at = excluded.updated_at;
      insert into public.academic_status_history (scholar_id_number, school_id, old_status, new_status, old_custom_gwa, new_custom_gwa, how, by_user, by_label)
        values (e ->> 'scholar_id', v_school, v_old, e ->> 'new_status', v_old_gwa, v_old_gwa, 'file', auth.uid(), public._actor_name());
      v_set := v_set + 1;
    elsif e ->> 'state' = 'error' then v_errors := v_errors + 1;
    else v_skipped := v_skipped + 1; end if;
  end loop;
  if v_set > 0 then
    update public.academic_gwa_settings set version = version + 1, updated_at = now() where id;      -- the open renewals are checked again in the background
    insert into public.academic_settings_audit (by_label, what) values (public._actor_name(), 'Bulk upload of scholars'' academic status: ' || v_set || ' set.');
  end if;
  return jsonb_build_object('set', v_set, 'reset', 0, 'skipped', v_skipped, 'errors', v_errors,
    'results', (select coalesce(jsonb_agg(jsonb_build_object('i', (x.value ->> 'i')::integer, 'outcome', case when x.value ->> 'action' = 'set' then 'set' when x.value ->> 'state' = 'error' then 'error' else 'skipped' end,
      'message', x.value -> 'messages' ->> 0)), '[]'::jsonb) from jsonb_array_elements(v) x));
end;
$$;
revoke all on function public.academic_bulk_save(jsonb) from public, anon;
grant execute on function public.academic_bulk_save(jsonb) to authenticated;

-- 6. The scholars whose status was set by hand or by file (to download, correct and upload again). The per-school list comes with the new screen.
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
  select t.scholar_id_number, btrim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')), sc.name, s.course, t.academic_status, null::text
  from public.scholar_academic_status t
  join public.scholars s on s.scholar_id_number = t.scholar_id_number
  left join public.schools sc on sc.id = s.school_id
  where t.source <> 'program'
  order by s.last_name, s.first_name, t.scholar_id_number
  limit 1000;
end;
$$;
revoke all on function public.academic_overrides_list() from public, anon;
grant execute on function public.academic_overrides_list() to authenticated;

-- 7. The warnings: per school how many scholars have no status (and whether the school has a passing GWA: without one the GWA rule is off), and the list of those scholars.
create or replace function public.academic_not_set_summary()
returns table(school_id uuid, school text, scholars bigint, not_set bigint, academic_passing_gwa numeric, non_academic_passing_gwa numeric, rule_on boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._academic_require_manager();
  return query
  select sc.id, coalesce(sc.name, '(no school on record)'), count(*), count(*) filter (where t.scholar_id_number is null),
         ss.academic_passing_gwa, ss.non_academic_passing_gwa, (ss.academic_passing_gwa is not null)
  from public.scholars s
  left join public.schools sc on sc.id = s.school_id
  left join public.academic_school_settings ss on ss.school_id = s.school_id
  left join public.scholar_academic_status t on t.scholar_id_number = s.scholar_id_number
  where coalesce(s.status, '') <> 'Removed'
  group by sc.id, sc.name, ss.academic_passing_gwa, ss.non_academic_passing_gwa
  order by coalesce(sc.name, '(no school on record)');
end;
$$;
revoke all on function public.academic_not_set_summary() from public, anon;
grant execute on function public.academic_not_set_summary() to authenticated;

create or replace function public.academic_not_set_list(p_school uuid default null, p_limit integer default 1000, p_offset integer default 0)
returns table(scholar_id_number text, name text, school text, school_id uuid, program text, year_level text, scholarship_status text, rule_on boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._academic_require_manager();
  return query
  select s.scholar_id_number, btrim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')), sc.name, s.school_id, s.course, s.year_level, s.status, (ss.academic_passing_gwa is not null)
  from public.scholars s
  left join public.schools sc on sc.id = s.school_id
  left join public.academic_school_settings ss on ss.school_id = s.school_id
  where coalesce(s.status, '') <> 'Removed'
    and not exists (select 1 from public.scholar_academic_status t where t.scholar_id_number = s.scholar_id_number)
    and (p_school is null or s.school_id = p_school)
  order by sc.name, s.last_name, s.first_name, s.scholar_id_number
  limit least(greatest(coalesce(p_limit, 1000), 1), 1000) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;
revoke all on function public.academic_not_set_list(uuid, integer, integer) from public, anon;
grant execute on function public.academic_not_set_list(uuid, integer, integer) to authenticated;

notify pgrst, 'reload schema';
commit;
