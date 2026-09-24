-- ─────────────────────────────────────────────────────────────
-- supabase_migration_scholars_grades_monitoring.sql
--
-- Adds a full grading workflow on top of the existing scholar portal's
-- read-only Grades tab (public.scholar_subjects_grades, previously filled
-- in only by hand via Supabase Studio):
--
--   1. SCHOOLS get their own account type (public.school_accounts) and a
--      portal (see src/school/) to configure their own grading system and
--      enter scholars' subjects+grades — individually or via bulk CSV.
--   2. CEDO STAFF get a new "Scholars' Grades Monitoring" tool (gated by
--      the "scholars_grades_monitoring" tag) to see, by school and
--      program, what % of scholars have COMPLETE current-semester grades,
--      and to drill into any scholar's grades + computed GWA.
--   3. SCHOLARS see their existing Grades tab gain a Subject Code column
--      and a computed GWA, using whichever grading system their school set.
--
-- "Complete" is strict: a scholar counts as complete only once every
-- subject they're enrolled in for the current semester has a non-blank
-- grade. A school first declares a scholar's subject list (grade may be
-- left blank), then fills grades in — both via the same upsert path.
--
-- Run this once in the Supabase SQL Editor. Safe to re-run: every
-- statement uses IF NOT EXISTS / OR REPLACE, and the backfill step is
-- idempotent (re-running it inserts nothing new and touches no already-set
-- school_id).
-- ─────────────────────────────────────────────────────────────

-- ── 1. SCHOOLS — new lookup table, replacing scholars.school free text ──
create table if not exists public.schools (
  id         uuid primary key default gen_random_uuid(),
  name       text unique not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One editable-anytime grading config per school. scale/direction cover
-- numeric grading; uses_letter_grades additionally enables the
-- school_letter_grades table below for schools that grade with letters.
create table if not exists public.school_grading_configs (
  school_id         uuid primary key references public.schools(id) on delete cascade,
  scale_min         numeric not null default 1.0,
  scale_max         numeric not null default 5.0,
  direction         text not null default 'lower_is_better' check (direction in ('lower_is_better', 'higher_is_better')),
  uses_letter_grades boolean not null default false,
  updated_at        timestamptz not null default now()
);

-- A school's own letter→numeric conversion table, editable/addable by the
-- school itself. numeric_value is nullable on purpose: a non-numeric mark
-- (INC, DRP, etc.) can be declared with no numeric equivalent, and is then
-- excluded from GWA rather than counted as 0.
create table if not exists public.school_letter_grades (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools(id) on delete cascade,
  letter        text not null,
  numeric_value numeric,
  created_at    timestamptz not null default now(),
  unique (school_id, letter)
);

-- One login per school, mirroring public.scholars' own-auth-row pattern
-- (id IS the Supabase Auth user id). Created by staff via
-- scripts/create-school-accounts.mjs — schools never self-register.
create table if not exists public.school_accounts (
  id         uuid primary key references auth.users(id) on delete cascade,
  school_id  uuid not null unique references public.schools(id) on delete cascade,
  email      text unique not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Singleton: the one "current school year / semester" both the monitoring
-- %'s and every school's grade-entry screens key off. Nothing like this
-- existed before this migration — without one, "current semester" is
-- ambiguous the moment two schools use different semester labels.
create table if not exists public.grading_period_settings (
  id                 boolean primary key default true check (id),
  current_school_year text not null default '',
  current_semester    text not null default '',
  updated_at          timestamptz not null default now()
);
insert into public.grading_period_settings (id) values (true) on conflict do nothing;

-- ── 2. Extend existing tables ───────────────────────────────
alter table public.scholars add column if not exists school_id uuid references public.schools(id);

alter table public.scholar_subjects_grades add column if not exists subject_code text not null default '';
-- Schools aren't in public.users, so the existing recorded_by FK can't
-- represent them — a separate nullable FK tracks school-entered rows.
alter table public.scholar_subjects_grades add column if not exists recorded_by_school_id uuid references public.schools(id);
-- Blank/null grade = "declared, not yet graded" — the strict completeness
-- rule below depends on being able to tell a declared-but-ungraded row
-- apart from one that was never declared at all.
alter table public.scholar_subjects_grades alter column grade drop not null;

create index if not exists idx_ssg_scholar_period on public.scholar_subjects_grades (scholar_id_number, school_year, semester);
create index if not exists idx_scholars_school_id on public.scholars (school_id);

-- ── 3. Backfill schools from existing free-text scholars.school ─────
-- Groups by case/whitespace-normalized name, picks the most-frequent exact
-- spelling per group as the canonical public.schools.name, then links
-- scholars.school_id by the same normalized match. Safe to re-run: the
-- INSERT no-ops on an existing name, the UPDATE only touches rows still
-- missing a school_id.
--
-- KNOWN LIMITATION: spelling variants beyond case/whitespace (e.g. an
-- abbreviation vs. the full name) will NOT auto-merge and will show up as
-- two separate schools. Review `select name from public.schools order by
-- name` once before creating school logins, and manually UPDATE
-- scholars.school_id for any rows that should collapse into one school.
with normalized as (
  select trim(school) as raw_name, lower(trim(school)) as norm_key, count(*) as cnt
  from public.scholars
  where trim(coalesce(school, '')) <> ''
  group by trim(school), lower(trim(school))
),
ranked as (
  select norm_key, raw_name,
         row_number() over (partition by norm_key order by cnt desc, raw_name) as rn
  from normalized
)
insert into public.schools (name)
select raw_name from ranked where rn = 1
on conflict (name) do nothing;

update public.scholars s
set school_id = sch.id
from public.schools sch
where s.school_id is null
  and trim(coalesce(s.school, '')) <> ''
  and lower(trim(s.school)) = lower(trim(sch.name));

-- ── 4. Helper functions ──────────────────────────────────────
create or replace function public.is_school_account()
returns boolean language sql stable security definer as $$
  select exists (select 1 from public.school_accounts a where a.id = auth.uid());
$$;

create or replace function public.current_school_id()
returns uuid language sql stable security definer as $$
  select school_id from public.school_accounts where id = auth.uid();
$$;

create or replace function public.is_scholars_grades_monitoring_staff()
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from public.staff_account_tags t
    where t.staff_id = auth.uid() and t.tag_key = 'scholars_grades_monitoring'
  );
$$;

-- ── 5. Row Level Security ───────────────────────────────────
alter table public.schools enable row level security;
alter table public.school_grading_configs enable row level security;
alter table public.school_letter_grades enable row level security;
alter table public.school_accounts enable row level security;
alter table public.grading_period_settings enable row level security;

drop policy if exists "staff full access" on public.schools;
create policy "staff full access" on public.schools for all
  using (public.is_cedo_staff()) with check (public.is_cedo_staff());

drop policy if exists "staff full access" on public.school_grading_configs;
create policy "staff full access" on public.school_grading_configs for all
  using (public.is_cedo_staff()) with check (public.is_cedo_staff());

drop policy if exists "staff full access" on public.school_letter_grades;
create policy "staff full access" on public.school_letter_grades for all
  using (public.is_cedo_staff()) with check (public.is_cedo_staff());

drop policy if exists "staff full access" on public.school_accounts;
create policy "staff full access" on public.school_accounts for all
  using (public.is_cedo_staff()) with check (public.is_cedo_staff());

drop policy if exists "staff full access" on public.grading_period_settings;
create policy "staff full access" on public.grading_period_settings for all
  using (public.is_cedo_staff()) with check (public.is_cedo_staff());

-- Everyone signed in (scholars + schools) needs to read the current period.
drop policy if exists "authenticated reads grading period" on public.grading_period_settings;
create policy "authenticated reads grading period" on public.grading_period_settings for select
  using (auth.role() = 'authenticated');

-- School: manages its own config/letters, reads its own school/account row.
drop policy if exists "school manages own config" on public.school_grading_configs;
create policy "school manages own config" on public.school_grading_configs for all
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());

drop policy if exists "school manages own letter grades" on public.school_letter_grades;
create policy "school manages own letter grades" on public.school_letter_grades for all
  using (school_id = public.current_school_id()) with check (school_id = public.current_school_id());

drop policy if exists "school reads own account" on public.school_accounts;
create policy "school reads own account" on public.school_accounts for select
  using (id = auth.uid());

drop policy if exists "school reads own school row" on public.schools;
create policy "school reads own school row" on public.schools for select
  using (id = public.current_school_id());

-- School: read-only on its own scholars (never edits scholar profiles,
-- only grades — see the scholar_subjects_grades policy below).
drop policy if exists "school reads own scholars" on public.scholars;
create policy "school reads own scholars" on public.scholars for select
  using (school_id = public.current_school_id());

-- School: manages grades only for scholars belonging to its own school.
-- Existing staff-full-access and scholar-read-own-rows policies on this
-- table are untouched.
drop policy if exists "school manages own scholars grades" on public.scholar_subjects_grades;
create policy "school manages own scholars grades" on public.scholar_subjects_grades for all
  using (exists (
    select 1 from public.scholars s
    where s.scholar_id_number = scholar_subjects_grades.scholar_id_number
      and s.school_id = public.current_school_id()
  ))
  with check (exists (
    select 1 from public.scholars s
    where s.scholar_id_number = scholar_subjects_grades.scholar_id_number
      and s.school_id = public.current_school_id()
  ));

-- ── 6. Grading config RPCs (school writes its own) ──────────
create or replace function public.upsert_school_grading_config(
  p_scale_min numeric,
  p_scale_max numeric,
  p_direction text,
  p_uses_letter_grades boolean
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

  insert into public.school_grading_configs (school_id, scale_min, scale_max, direction, uses_letter_grades, updated_at)
  values (v_school_id, p_scale_min, p_scale_max, p_direction, p_uses_letter_grades, now())
  on conflict (school_id) do update
    set scale_min = excluded.scale_min,
        scale_max = excluded.scale_max,
        direction = excluded.direction,
        uses_letter_grades = excluded.uses_letter_grades,
        updated_at = now();
end;
$$;
grant execute on function public.upsert_school_grading_config(numeric, numeric, text, boolean) to authenticated;

-- Replace-all pattern (same idea as setStaffTags in src/itadmin/itAdminApi.ts,
-- just server-side): the school always sends its whole intended letter list.
create or replace function public.set_school_letter_grades(p_letters jsonb)
returns void
language plpgsql
security definer
as $$
declare
  v_school_id uuid := public.current_school_id();
  v_row jsonb;
begin
  if v_school_id is null then
    raise exception 'Not authorized — no school account found.';
  end if;

  delete from public.school_letter_grades where school_id = v_school_id;

  for v_row in select * from jsonb_array_elements(coalesce(p_letters, '[]'::jsonb))
  loop
    insert into public.school_letter_grades (school_id, letter, numeric_value)
    values (
      v_school_id,
      trim(v_row->>'letter'),
      case when v_row->>'numericValue' is null or v_row->>'numericValue' = '' then null else (v_row->>'numericValue')::numeric end
    )
    on conflict (school_id, letter) do update set numeric_value = excluded.numeric_value;
  end loop;
end;
$$;
grant execute on function public.set_school_letter_grades(jsonb) to authenticated;

-- ── 7. Grade entry RPCs (school writes) ─────────────────────
-- Backs BOTH "declare a subject" (p_grade null/blank) and "fill a grade in
-- later" (same row, p_id supplied) — one upsert path for both phases of
-- the strict completeness rule.
create or replace function public.upsert_scholar_subject_grade(
  p_id uuid,
  p_scholar_id_number text,
  p_school_year text,
  p_semester text,
  p_subject_code text,
  p_subject text,
  p_grade text
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_school_id uuid := public.current_school_id();
  v_row_id uuid;
begin
  if v_school_id is null then
    raise exception 'Not authorized — no school account found.';
  end if;
  if not exists (select 1 from public.scholars s where s.scholar_id_number = p_scholar_id_number and s.school_id = v_school_id) then
    raise exception 'That scholar does not belong to your school.';
  end if;

  if p_id is not null then
    update public.scholar_subjects_grades
    set subject_code = p_subject_code, subject = p_subject, grade = nullif(trim(p_grade), ''), updated_at = now()
    where id = p_id and scholar_id_number = p_scholar_id_number
      and exists (select 1 from public.scholars s where s.scholar_id_number = p_scholar_id_number and s.school_id = v_school_id)
    returning id into v_row_id;
    if v_row_id is null then
      raise exception 'Grade row not found or not editable by your school.';
    end if;
  else
    insert into public.scholar_subjects_grades
      (scholar_id_number, school_year, semester, subject_code, subject, grade, recorded_by_school_id)
    values
      (p_scholar_id_number, p_school_year, p_semester, p_subject_code, p_subject, nullif(trim(p_grade), ''), v_school_id)
    returning id into v_row_id;
  end if;

  return v_row_id;
end;
$$;
grant execute on function public.upsert_scholar_subject_grade(uuid, text, text, text, text, text, text) to authenticated;

create or replace function public.bulk_upsert_scholar_subject_grades(p_rows jsonb)
returns table(row_index int, ok boolean, error text, id uuid)
language plpgsql
security definer
as $$
declare
  v_row jsonb;
  v_index int := 0;
  v_id uuid;
begin
  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    begin
      v_id := public.upsert_scholar_subject_grade(
        case when v_row->>'id' is null or v_row->>'id' = '' then null else (v_row->>'id')::uuid end,
        v_row->>'scholarIdNumber',
        v_row->>'schoolYear',
        v_row->>'semester',
        coalesce(v_row->>'subjectCode', ''),
        v_row->>'subject',
        v_row->>'grade'
      );
      row_index := v_index; ok := true; error := null; id := v_id;
    exception when others then
      row_index := v_index; ok := false; error := sqlerrm; id := null;
    end;
    v_index := v_index + 1;
    return next;
  end loop;
end;
$$;
grant execute on function public.bulk_upsert_scholar_subject_grades(jsonb) to authenticated;

-- ── 8. Grading-config reads (scholar's own / staff-for-any-scholar) ──
create or replace function public.get_scholar_grading_config()
returns table(scale_min numeric, scale_max numeric, direction text, uses_letter_grades boolean)
language sql stable security definer as $$
  select c.scale_min, c.scale_max, c.direction, c.uses_letter_grades
  from public.school_grading_configs c
  join public.scholars s on s.school_id = c.school_id
  where s.id = auth.uid();
$$;
grant execute on function public.get_scholar_grading_config() to authenticated;

create or replace function public.get_scholar_letter_grades()
returns table(letter text, numeric_value numeric)
language sql stable security definer as $$
  select lg.letter, lg.numeric_value
  from public.school_letter_grades lg
  join public.scholars s on s.school_id = lg.school_id
  where s.id = auth.uid();
$$;
grant execute on function public.get_scholar_letter_grades() to authenticated;

create or replace function public.get_scholar_grading_config_for_staff(p_scholar_id_number text)
returns table(scale_min numeric, scale_max numeric, direction text, uses_letter_grades boolean)
language sql stable security definer as $$
  select c.scale_min, c.scale_max, c.direction, c.uses_letter_grades
  from public.school_grading_configs c
  join public.scholars s on s.school_id = c.school_id
  where s.scholar_id_number = p_scholar_id_number
    and public.is_scholars_grades_monitoring_staff();
$$;
grant execute on function public.get_scholar_grading_config_for_staff(text) to authenticated;

create or replace function public.get_scholar_letter_grades_for_staff(p_scholar_id_number text)
returns table(letter text, numeric_value numeric)
language sql stable security definer as $$
  select lg.letter, lg.numeric_value
  from public.school_letter_grades lg
  join public.scholars s on s.school_id = lg.school_id
  where s.scholar_id_number = p_scholar_id_number
    and public.is_scholars_grades_monitoring_staff();
$$;
grant execute on function public.get_scholar_letter_grades_for_staff(text) to authenticated;

-- ── 9. Grading period (staff sets, everyone reads) ──────────
create or replace function public.get_current_grading_period()
returns table(current_school_year text, current_semester text)
language sql stable security definer as $$
  select current_school_year, current_semester from public.grading_period_settings where id = true;
$$;
grant execute on function public.get_current_grading_period() to authenticated;

create or replace function public.set_current_grading_period(p_school_year text, p_semester text)
returns void
language plpgsql
security definer
as $$
begin
  if not public.is_scholars_grades_monitoring_staff() then
    raise exception 'Not authorized to set the grading period.';
  end if;
  update public.grading_period_settings
  set current_school_year = p_school_year, current_semester = p_semester, updated_at = now()
  where id = true;
end;
$$;
grant execute on function public.set_current_grading_period(text, text) to authenticated;

-- ── 10. Monitoring aggregates (staff reads) ─────────────────
-- A scholar is "complete" for a period iff they have >=1 declared subject
-- row AND every one of those rows has a non-blank grade — a scholar with
-- zero declared subjects is NOT complete (nothing to divide by zero on;
-- they just don't count toward the numerator).
create or replace function public.scholars_grades_monitoring_schools(p_school_year text, p_semester text)
returns table(school_id uuid, school_name text, total_scholars bigint, complete_scholars bigint, percent_complete numeric)
language sql stable security definer as $$
  with period_grades as (
    select scholar_id_number, bool_and(nullif(trim(coalesce(grade, '')), '') is not null) as all_graded
    from public.scholar_subjects_grades
    where school_year = p_school_year and semester = p_semester
    group by scholar_id_number
  )
  select
    sch.id, sch.name,
    count(s.scholar_id_number) as total_scholars,
    count(*) filter (where pg.all_graded) as complete_scholars,
    case when count(s.scholar_id_number) = 0 then 0
      else round(100.0 * count(*) filter (where pg.all_graded) / count(s.scholar_id_number), 1)
    end as percent_complete
  from public.schools sch
  join public.scholars s on s.school_id = sch.id
  left join period_grades pg on pg.scholar_id_number = s.scholar_id_number
  where public.is_scholars_grades_monitoring_staff()
  group by sch.id, sch.name
  order by sch.name;
$$;
grant execute on function public.scholars_grades_monitoring_schools(text, text) to authenticated;

create or replace function public.scholars_grades_monitoring_programs(p_school_id uuid, p_school_year text, p_semester text)
returns table(program text, total_scholars bigint, complete_scholars bigint, percent_complete numeric)
language sql stable security definer as $$
  with period_grades as (
    select scholar_id_number, bool_and(nullif(trim(coalesce(grade, '')), '') is not null) as all_graded
    from public.scholar_subjects_grades
    where school_year = p_school_year and semester = p_semester
    group by scholar_id_number
  )
  select
    coalesce(nullif(trim(s.course), ''), '(No program set)') as program,
    count(s.scholar_id_number) as total_scholars,
    count(*) filter (where pg.all_graded) as complete_scholars,
    case when count(s.scholar_id_number) = 0 then 0
      else round(100.0 * count(*) filter (where pg.all_graded) / count(s.scholar_id_number), 1)
    end as percent_complete
  from public.scholars s
  left join period_grades pg on pg.scholar_id_number = s.scholar_id_number
  where s.school_id = p_school_id and public.is_scholars_grades_monitoring_staff()
  group by coalesce(nullif(trim(s.course), ''), '(No program set)')
  order by program;
$$;
grant execute on function public.scholars_grades_monitoring_programs(uuid, text, text) to authenticated;

create or replace function public.scholars_grades_monitoring_scholars(
  p_search text default null,
  p_school_id uuid default null,
  p_program text default null
)
returns table(
  scholar_id_number text, first_name text, last_name text, middle_name text,
  school_name text, program text
)
language sql stable security definer as $$
  select s.scholar_id_number, s.first_name, s.last_name, s.middle_name,
         coalesce(sch.name, '(No school set)'), coalesce(nullif(trim(s.course), ''), '(No program set)')
  from public.scholars s
  left join public.schools sch on sch.id = s.school_id
  where public.is_scholars_grades_monitoring_staff()
    and (p_school_id is null or s.school_id = p_school_id)
    and (p_program is null or trim(s.course) = p_program)
    and (
      p_search is null or p_search = ''
      or s.scholar_id_number ilike '%' || p_search || '%'
      or s.first_name ilike '%' || p_search || '%'
      or s.last_name ilike '%' || p_search || '%'
    )
  order by s.last_name, s.first_name
  limit 200;
$$;
grant execute on function public.scholars_grades_monitoring_scholars(text, uuid, text) to authenticated;

-- ── 11. School login-lookup RPC ──────────────────────────────
-- Same posture as resolve_scholar_login_email: SECURITY DEFINER, narrow
-- return (email only), so the anon key never needs direct SELECT access.
create or replace function public.resolve_school_login_email(p_school_name text)
returns text
language sql stable security definer as $$
  select a.email
  from public.school_accounts a
  join public.schools sch on sch.id = a.school_id
  where lower(trim(sch.name)) = lower(trim(p_school_name))
  limit 1;
$$;
grant execute on function public.resolve_school_login_email(text) to anon, authenticated;
