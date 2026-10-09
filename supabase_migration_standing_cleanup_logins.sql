-- ─────────────────────────────────────────────────────────────
-- supabase_migration_standing_cleanup_logins.sql
--
-- Phase 7 (final) of the Scholar Grades improvements. Run AFTER
-- supabase_migration_submission_audit_documents.sql. Nothing is deleted; the only data change made
-- automatically is linking scholars whose school name already matches a school but who have no
-- school link (school_id) — see the one-time link in section 2. Safe to re-run.
--
--   1. SCHOLARSHIP STANDING — each school saves a retention requirement on its own grading scale
--      (school_grading_configs.retention_threshold, e.g. 2.50 or better / 85 or better). The app
--      derives Good standing / At risk / Below requirement from the scholar's GWA.
--   2. SCHOOL CLEANUP — school_aliases (old spellings kept after a merge), resolve_school_id(),
--      merge_schools(), assign_scholars_school(), standardize_scholar_school_names(). A trigger on
--      scholars keeps the school NAME and the school LINK in step, so choosing a school from the
--      list (or typing a known spelling) always ends up linked.
--   3. SEARCH — scholars_grades_monitoring_scholars_page(): filters (school, program, year level)
--      and paging with a total count, replacing the "stops at 200" list; scholar_filter_options().
--   4. LOGINS — a school signs in with its username OR its login email (no longer its school
--      name); IT can set a username for an account that has none (set_school_username); a school
--      that cannot sign in can ask for a reset (request_school_password_reset), IT sees the
--      requests and resets the password with the existing reset action.
--
-- Who may do what is enforced here in the database, not only on the screens.
-- ─────────────────────────────────────────────────────────────

-- ── 0. Helpers ──────────────────────────────────────────────
-- The one IT administrator account (same rule as the edge functions' requireItAdmin).
create or replace function public.is_it_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.users u where u.id = auth.uid() and lower(u.username) = 'it.admin1');
$$;

-- A school name with case, surrounding spaces and repeated spaces ignored.
create or replace function public._school_key(p_name text)
returns text
language sql
immutable
as $$
  select lower(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')));
$$;

-- ── 1. Retention requirement ────────────────────────────────
alter table public.school_grading_configs add column if not exists retention_threshold numeric;

drop function if exists public.upsert_school_grading_config(numeric, numeric, text, boolean);

create or replace function public.upsert_school_grading_config(
  p_scale_min numeric,
  p_scale_max numeric,
  p_direction text,
  p_uses_letter_grades boolean,
  p_retention_threshold numeric default null
)
returns void
language plpgsql
security definer
as $$
declare
  v_school_id uuid := public.current_school_id();
begin
  if v_school_id is null then
    raise exception 'Not authorized — no school account found.';
  end if;
  if p_direction not in ('lower_is_better', 'higher_is_better') then
    raise exception 'Invalid direction: %', p_direction;
  end if;
  if p_scale_max <= p_scale_min then
    raise exception 'The scale maximum must be higher than the minimum.';
  end if;
  if p_retention_threshold is not null and (p_retention_threshold < p_scale_min or p_retention_threshold > p_scale_max) then
    raise exception 'The retention requirement must be on your grading scale (% to %).', p_scale_min::float8, p_scale_max::float8;
  end if;

  insert into public.school_grading_configs (school_id, scale_min, scale_max, direction, uses_letter_grades, retention_threshold, updated_at)
  values (v_school_id, p_scale_min, p_scale_max, p_direction, p_uses_letter_grades, p_retention_threshold, now())
  on conflict (school_id) do update
    set scale_min = excluded.scale_min,
        scale_max = excluded.scale_max,
        direction = excluded.direction,
        uses_letter_grades = excluded.uses_letter_grades,
        retention_threshold = excluded.retention_threshold,
        updated_at = now();
end;
$$;
grant execute on function public.upsert_school_grading_config(numeric, numeric, text, boolean, numeric) to authenticated;

-- ── 2. School aliases + keeping a scholar's school name and link in step ──
create table if not exists public.school_aliases (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  alias      text not null,
  alias_key  text generated always as (public._school_key(alias)) stored,
  merged_at  timestamptz not null default now(),
  merged_by  uuid,
  unique (alias_key)
);
alter table public.school_aliases enable row level security;
drop policy if exists "staff reads school aliases" on public.school_aliases;
create policy "staff reads school aliases" on public.school_aliases for select
  using (public.is_scholars_grades_monitoring_staff() or public.is_cedo_staff());

-- Which school does this name mean? Official name first, then any alias; case/spacing ignored. NULL if none.
create or replace function public.resolve_school_id(p_name text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from (
    select s.id, 1 as rank from public.schools s where public._school_key(s.name) = public._school_key(p_name)
    union all
    select a.school_id, 2 from public.school_aliases a where a.alias_key = public._school_key(p_name)
  ) m
  where public._school_key(p_name) <> ''
  order by rank
  limit 1;
$$;
grant execute on function public.resolve_school_id(text) to authenticated;

-- The scholar's school NAME and school LINK follow each other:
--   * choosing a school (school_id) writes the official name into scholars.school;
--   * typing a name (scholars.school) links the school when the name or an alias matches, and writes the official
--     spelling; a name that matches nothing clears the link, so the scholar shows up in the "No school set" list.
create or replace function public.scholars_school_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_name text;
begin
  if tg_op = 'INSERT' then
    if new.school_id is not null then
      select name into v_name from public.schools where id = new.school_id;
      if v_name is not null then new.school := v_name; end if;
    elsif btrim(coalesce(new.school, '')) <> '' then
      v_id := public.resolve_school_id(new.school);
      if v_id is not null then
        new.school_id := v_id;
        select name into new.school from public.schools where id = v_id;
      end if;
    end if;
  elsif new.school_id is distinct from old.school_id then
    if new.school_id is not null then
      select name into v_name from public.schools where id = new.school_id;
      if v_name is not null then new.school := v_name; end if;
    end if;
  elsif new.school is distinct from old.school then
    v_id := public.resolve_school_id(new.school);
    new.school_id := v_id;
    if v_id is not null then
      select name into new.school from public.schools where id = v_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists scholars_school_sync on public.scholars;
create trigger scholars_school_sync
  before insert or update of school, school_id on public.scholars
  for each row execute function public.scholars_school_sync();

-- One-time link: scholars whose school name already matches a school but who were added after the original backfill.
--    Only school_id is filled in (the trigger also writes the official spelling for those rows). Nothing else changes.
update public.scholars s
set school_id = public.resolve_school_id(s.school)
where s.school_id is null
  and btrim(coalesce(s.school, '')) <> ''
  and public.resolve_school_id(s.school) is not null;

-- ── 3. Merge schools ────────────────────────────────────────
create or replace function public.merge_schools(p_keep_id uuid, p_merge_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src uuid;
  v_name text;
  v_keep_name text;
  v_blockers text[] := '{}';
  v_moved int := 0;
  v_aliases int := 0;
  v_n int;
  v_removed int := 0;
begin
  if not (public.is_scholars_grades_monitoring_staff() or public.is_cedo_staff()) then
    raise exception 'Not authorized to merge schools.';
  end if;
  select name into v_keep_name from public.schools where id = p_keep_id;
  if v_keep_name is null then raise exception 'The school to keep was not found.'; end if;
  if p_merge_ids is null or cardinality(p_merge_ids) = 0 then raise exception 'Choose at least one school to merge into % .', v_keep_name; end if;
  if p_keep_id = any(p_merge_ids) then raise exception 'A school cannot be merged into itself.'; end if;

  -- A school that already has a login, submission, correction request or document cannot simply disappear.
  for v_src in select distinct unnest(p_merge_ids) loop
    select name into v_name from public.schools where id = v_src;
    if v_name is null then raise exception 'One of the schools to merge was not found.'; end if;
    if exists (select 1 from public.school_accounts where school_id = v_src) then v_blockers := array_append(v_blockers, v_name || ' (has a school account — IT must delete it first)'); end if;
    if exists (select 1 from public.school_period_submissions where school_id = v_src)
       or exists (select 1 from public.grade_correction_requests where school_id = v_src)
       or exists (select 1 from public.grade_documents where school_id = v_src) then
      v_blockers := array_append(v_blockers, v_name || ' (already has submissions, correction requests or documents)');
    end if;
  end loop;
  if cardinality(v_blockers) > 0 then
    raise exception 'These schools cannot be merged yet: %', array_to_string(v_blockers, '; ');
  end if;

  for v_src in select distinct unnest(p_merge_ids) loop
    select name into v_name from public.schools where id = v_src;

    -- Keep the grading setup if the school we keep has none yet.
    if not exists (select 1 from public.school_grading_configs where school_id = p_keep_id)
       and exists (select 1 from public.school_grading_configs where school_id = v_src) then
      insert into public.school_grading_configs (school_id, scale_min, scale_max, direction, uses_letter_grades, retention_threshold)
        select p_keep_id, scale_min, scale_max, direction, uses_letter_grades, retention_threshold from public.school_grading_configs where school_id = v_src;
      insert into public.school_letter_grades (school_id, letter, numeric_value)
        select p_keep_id, letter, numeric_value from public.school_letter_grades where school_id = v_src
        on conflict (school_id, letter) do nothing;
    end if;

    -- The old spelling stays as an alias; aliases of the old school move along.
    update public.school_aliases set school_id = p_keep_id where school_id = v_src;
    if public._school_key(v_name) <> public._school_key(v_keep_name) then
      insert into public.school_aliases (school_id, alias, merged_by) values (p_keep_id, v_name, auth.uid())
      on conflict (alias_key) do update set school_id = excluded.school_id;
      v_aliases := v_aliases + 1;
    end if;

    update public.scholars set school_id = p_keep_id where school_id = v_src;
    get diagnostics v_n = row_count;
    v_moved := v_moved + v_n;

    update public.scholar_grade_audit set school_id = p_keep_id where school_id = v_src;
    delete from public.schools where id = v_src;
    v_removed := v_removed + 1;
  end loop;

  return jsonb_build_object('scholarsMoved', v_moved, 'aliasesAdded', v_aliases, 'schoolsRemoved', v_removed, 'keptName', v_keep_name);
end;
$$;
grant execute on function public.merge_schools(uuid, uuid[]) to authenticated;

-- Give selected scholars a school (the "No school set" list).
create or replace function public.assign_scholars_school(p_scholar_ids text[], p_school_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n int;
begin
  if not (public.is_scholars_grades_monitoring_staff() or public.is_cedo_staff()) then
    raise exception 'Not authorized to assign schools.';
  end if;
  if not exists (select 1 from public.schools where id = p_school_id) then raise exception 'That school was not found.'; end if;
  update public.scholars set school_id = p_school_id where scholar_id_number = any(p_scholar_ids);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
grant execute on function public.assign_scholars_school(text[], uuid) to authenticated;

-- Scholars whose written school name differs from their school's official name (spacing, capitals...). Count + examples.
create or replace function public.scholar_school_spelling_variants()
returns table(school_name text, variant text, scholars bigint)
language sql
stable
security definer
set search_path = public
as $$
  select sch.name, s.school, count(*)
  from public.scholars s join public.schools sch on sch.id = s.school_id
  where (public.is_scholars_grades_monitoring_staff() or public.is_cedo_staff())
    and s.school is distinct from sch.name
  group by sch.name, s.school
  order by count(*) desc, sch.name
  limit 200;
$$;
grant execute on function public.scholar_school_spelling_variants() to authenticated;

-- Rewrite those names to the official spelling (explicit action: it changes scholar rows).
create or replace function public.standardize_scholar_school_names()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n int;
begin
  if not (public.is_scholars_grades_monitoring_staff() or public.is_cedo_staff()) then
    raise exception 'Not authorized to standardize school names.';
  end if;
  update public.scholars s set school = sch.name
  from public.schools sch
  where s.school_id = sch.id and s.school is distinct from sch.name;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
grant execute on function public.standardize_scholar_school_names() to authenticated;

-- ── 3b. Scholar search with filters and paging ──────────────
create or replace function public.scholars_grades_monitoring_scholars_page(
  p_search text default null,
  p_school_id uuid default null,
  p_program text default null,
  p_year_level text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table(
  scholar_id_number text, first_name text, last_name text, middle_name text,
  school_id uuid, school_name text, program text, year_level text, total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select s.scholar_id_number, s.first_name, s.last_name, s.middle_name,
         s.school_id, coalesce(sch.name, '(No school set)'),
         coalesce(nullif(trim(s.course), ''), '(No program set)'),
         coalesce(nullif(trim(s.year_level), ''), '(Not set)'),
         count(*) over ()
  from public.scholars s
  left join public.schools sch on sch.id = s.school_id
  where public.is_scholars_grades_monitoring_staff()
    and s.status <> 'Removed'
    and (p_school_id is null or s.school_id = p_school_id)
    and (p_program is null or coalesce(nullif(trim(s.course), ''), '(No program set)') = p_program)
    and (p_year_level is null or coalesce(nullif(trim(s.year_level), ''), '(Not set)') = p_year_level)
    and (
      p_search is null or btrim(p_search) = ''
      or s.scholar_id_number ilike '%' || btrim(p_search) || '%'
      or (coalesce(s.first_name, '') || ' ' || coalesce(s.middle_name, '') || ' ' || coalesce(s.last_name, '')) ilike '%' || btrim(p_search) || '%'
      or (coalesce(s.last_name, '') || ' ' || coalesce(s.first_name, '')) ilike '%' || btrim(p_search) || '%'
    )
  order by s.last_name, s.first_name, s.scholar_id_number
  limit greatest(1, least(coalesce(p_limit, 50), 500))
  offset greatest(0, coalesce(p_offset, 0));
$$;
grant execute on function public.scholars_grades_monitoring_scholars_page(text, uuid, text, text, integer, integer) to authenticated;

-- Programs and year levels that exist (optionally within one school), for the filter dropdowns.
create or replace function public.scholar_filter_options(p_school_id uuid default null)
returns table(kind text, value text)
language sql
stable
security definer
set search_path = public
as $$
  select 'program', v from (
    select distinct coalesce(nullif(trim(s.course), ''), '(No program set)') as v
    from public.scholars s where s.status <> 'Removed' and (p_school_id is null or s.school_id = p_school_id)
  ) a where public.is_scholars_grades_monitoring_staff()
  union all
  select 'year_level', v from (
    select distinct coalesce(nullif(trim(s.year_level), ''), '(Not set)') as v
    from public.scholars s where s.status <> 'Removed' and (p_school_id is null or s.school_id = p_school_id)
  ) b where public.is_scholars_grades_monitoring_staff()
  order by 1, 2;
$$;
grant execute on function public.scholar_filter_options(uuid) to authenticated;

-- ── 4. School logins: username or email; reset requests ─────
-- Same name and parameter as before so the deployed login page keeps working. A school types its USERNAME or its
-- login EMAIL; the school name no longer signs anyone in.
create or replace function public.resolve_school_login_email(p_school_name text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select a.email
  from public.school_accounts a
  where btrim(coalesce(p_school_name, '')) <> ''
    and (lower(a.username) = lower(btrim(p_school_name)) or lower(a.email) = lower(btrim(p_school_name)))
  limit 1;
$$;
grant execute on function public.resolve_school_login_email(text) to anon, authenticated;

-- IT assigns (or changes) a username for an existing account — the login email stays as it is.
create or replace function public.set_school_username(p_account_id uuid, p_username text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_username text := lower(btrim(coalesce(p_username, '')));
begin
  if not public.is_it_admin() then raise exception 'Only the IT administrator can set a school username.'; end if;
  if char_length(v_username) not between 3 and 30 or v_username !~ '^[a-z0-9]+([._-][a-z0-9]+)*$' then
    raise exception 'Username must be 3-30 characters: lowercase letters and numbers, with single dots, dashes or underscores between them.';
  end if;
  if exists (select 1 from public.school_accounts where lower(username) = v_username and id <> p_account_id) then
    raise exception 'The username "%" is already taken.', v_username;
  end if;
  update public.school_accounts set username = v_username, updated_at = now() where id = p_account_id;
  if not found then raise exception 'School account not found.'; end if;
end;
$$;
grant execute on function public.set_school_username(uuid, text) to authenticated;

-- "Forgot password": a school that cannot sign in asks CEDO. Public (no sign-in possible), reveals nothing about which
-- accounts exist, and holds at most one open request per account.
create table if not exists public.school_password_reset_requests (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.school_accounts(id) on delete cascade,
  requested_at timestamptz not null default now(),
  handled_at   timestamptz,
  handled_by   uuid
);
create unique index if not exists school_reset_one_open_per_account
  on public.school_password_reset_requests (account_id) where handled_at is null;
alter table public.school_password_reset_requests enable row level security;
drop policy if exists "it admin reads reset requests" on public.school_password_reset_requests;
create policy "it admin reads reset requests" on public.school_password_reset_requests for select
  using (public.is_it_admin());

create or replace function public.request_school_password_reset(p_login text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if btrim(coalesce(p_login, '')) = '' then return; end if;
  select a.id into v_id from public.school_accounts a
  where lower(a.username) = lower(btrim(p_login)) or lower(a.email) = lower(btrim(p_login))
  limit 1;
  if v_id is not null then
    insert into public.school_password_reset_requests (account_id) values (v_id) on conflict do nothing;
  end if;
end;
$$;
grant execute on function public.request_school_password_reset(text) to anon, authenticated;

create or replace function public.mark_school_reset_handled(p_account_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_it_admin() then raise exception 'Only the IT administrator can handle reset requests.'; end if;
  update public.school_password_reset_requests set handled_at = now(), handled_by = auth.uid()
  where account_id = p_account_id and handled_at is null;
end;
$$;
grant execute on function public.mark_school_reset_handled(uuid) to authenticated;

-- Tell the API layer to pick up the new functions right away.
notify pgrst, 'reload schema';

-- ── 5. Result check (shown in the SQL editor) ───────────────
select
  (select count(*) from public.scholars where school_id is null and status <> 'Removed') as scholars_still_without_a_school,
  (select count(*) from public.scholars s join public.schools sch on sch.id = s.school_id where s.school is distinct from sch.name) as scholars_with_a_different_spelling,
  (select count(*) from public.school_accounts where username is null) as school_accounts_without_a_username,
  (select count(*) from public.school_aliases) as aliases;
