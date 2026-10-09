-- ─────────────────────────────────────────────────────────────
-- supabase_migration_academic_periods.sql
--
-- Phase 2 of the Scholar Grades improvements: a real list of academic periods
-- (school year + term) with a status and an optional submission deadline, and
-- every subject/grade row linked to the period it belongs to.
--
--   1. public.academic_periods — school_year + term (1st Semester / 2nd
--      Semester / Summer, shown as "Summer / Midyear"), status Open / Closed /
--      Archived, optional submission_deadline. Everyone signed in can read it
--      (schools, scholars and staff all need the labels); only CEDO staff with
--      the scholars_grades_monitoring tag change it, through RPCs.
--   2. scholar_subjects_grades.period_id — every row now points at its period.
--      EXISTING GRADES ARE KEPT AND LINKED, not moved or deleted: each distinct
--      (school year, semester) already in the table becomes a period (the
--      current grading period Open, all older ones Closed), and a semester
--      label that is only a spelling variant ("1st Sem", "First Semester", ...)
--      is rewritten to the standard term, with the original text kept in the new
--      legacy_semester column.
--   3. A guard trigger on scholar_subjects_grades: a SCHOOL account can only add,
--      change or delete grades in an OPEN period (the old rule — own scholars only
--      — still applies on top). Staff and other writers are not restricted; if they
--      write to a period that does not exist yet, it is created (Open). New rows
--      always get their period_id filled in.
--   4. set_current_grading_period() now validates the school year / term, creates
--      the period if it is new, refuses an Archived one, and stores the standard
--      term name. The SDP credit period keeps reading the same settings row, so
--      changing the Current Grading Period still changes the SDP credit period
--      (the staff screen now warns about that before saving).
--
-- Nothing is deleted. Safe to re-run.
-- ─────────────────────────────────────────────────────────────

-- ── 1. Term-name normalizer (mirrors normalizeTerm() in src/lib/academicPeriods.ts) ──
create or replace function public.normalize_academic_term(p_term text)
returns text
language sql
immutable
as $$
  select case
    when p_term is null then null
    when lower(btrim(p_term)) ~ '^(1st|first|1)[ ._-]*(sem(ester)?)?$'
      or lower(btrim(p_term)) ~ '^sem(ester)?[ ._-]*(1|i)$' then '1st Semester'
    when lower(btrim(p_term)) ~ '^(2nd|second|2)[ ._-]*(sem(ester)?)?$'
      or lower(btrim(p_term)) ~ '^sem(ester)?[ ._-]*(2|ii)$' then '2nd Semester'
    when lower(btrim(p_term)) ~ '^(summer|mid[ ._-]?year|summer[ /._-]*mid[ ._-]?year|mid[ ._-]?year[ /._-]*summer)$' then 'Summer'
    else null
  end;
$$;

-- ── 2. The periods table ────────────────────────────────────
create table if not exists public.academic_periods (
  id                  uuid primary key default gen_random_uuid(),
  school_year         text not null,
  term                text not null check (term in ('1st Semester', '2nd Semester', 'Summer')),
  status              text not null default 'open' check (status in ('open', 'closed', 'archived')),
  submission_deadline date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (school_year, term)
);

alter table public.academic_periods enable row level security;

drop policy if exists "authenticated reads academic periods" on public.academic_periods;
create policy "authenticated reads academic periods" on public.academic_periods for select
  using (auth.role() = 'authenticated');
-- No insert/update/delete policy on purpose: staff change periods only through
-- upsert_academic_period() / set_current_grading_period() below.

-- ── 3. Link grades to periods, and migrate what is already there ─────
alter table public.scholar_subjects_grades add column if not exists period_id uuid references public.academic_periods(id);
alter table public.scholar_subjects_grades add column if not exists legacy_semester text;
create index if not exists idx_ssg_period on public.scholar_subjects_grades (period_id);

-- 3a. The current grading period first, Open.
insert into public.academic_periods (school_year, term, status)
select btrim(gps.current_school_year), public.normalize_academic_term(gps.current_semester), 'open'
from public.grading_period_settings gps
where gps.id = true
  and btrim(gps.current_school_year) <> ''
  and public.normalize_academic_term(gps.current_semester) is not null
on conflict (school_year, term) do nothing;

-- 3b. Every other (school year, semester) that already has grades: Closed (history —
--     staff can reopen one from the Manage periods screen).
insert into public.academic_periods (school_year, term, status)
select distinct btrim(g.school_year), public.normalize_academic_term(g.semester), 'closed'
from public.scholar_subjects_grades g
where btrim(g.school_year) <> '' and public.normalize_academic_term(g.semester) is not null
on conflict (school_year, term) do nothing;

-- 3c. Link existing rows. A spelling-variant semester is rewritten to the standard
--     term, original kept in legacy_semester. Rows are never deleted.
update public.scholar_subjects_grades g
set period_id = p.id,
    legacy_semester = case when g.semester <> p.term then coalesce(g.legacy_semester, g.semester) else g.legacy_semester end,
    semester = p.term
from public.academic_periods p
where g.period_id is null
  and p.school_year = btrim(g.school_year)
  and p.term = public.normalize_academic_term(g.semester);

-- ── 4. Guard trigger: schools only change grades in Open periods ─────
create or replace function public.scholar_grades_period_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.scholar_subjects_grades;
  v_term text;
  v_year text;
  v_pid uuid;
  v_status text;
  v_old_status text;
  v_is_school boolean := public.is_school_account();
begin
  if tg_op = 'DELETE' then v_row := old; else v_row := new; end if;
  v_year := btrim(v_row.school_year);
  v_term := public.normalize_academic_term(v_row.semester);

  select p.id, p.status into v_pid, v_status
  from public.academic_periods p
  where p.school_year = v_year and p.term = v_term;

  if v_is_school then
    if v_pid is null then
      raise exception 'The % % grading period has not been set up by CEDO yet, so grades cannot be saved for it.', v_year, coalesce(v_term, btrim(v_row.semester));
    end if;
    if v_status <> 'open' then
      raise exception 'Grades for % % are % — schools can only change grades in an Open period.', v_year, v_term, v_status;
    end if;
    if tg_op = 'UPDATE' and old.period_id is not null then
      select status into v_old_status from public.academic_periods where id = old.period_id;
      if v_old_status is distinct from 'open' then
        raise exception 'This grade belongs to a period that is % — schools can only change grades in an Open period.', coalesce(v_old_status, 'not set up');
      end if;
    end if;
  elsif tg_op <> 'DELETE' and v_pid is null and v_term is not null and v_year ~ '^\d{4}-\d{4}$' then
    insert into public.academic_periods (school_year, term, status)
    values (v_year, v_term, 'open')
    on conflict (school_year, term) do update set school_year = excluded.school_year
    returning id into v_pid;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  new.school_year := v_year;
  new.period_id := v_pid;
  if v_term is not null then new.semester := v_term; end if;
  return new;
end;
$$;

drop trigger if exists scholar_grades_period_guard on public.scholar_subjects_grades;
create trigger scholar_grades_period_guard
  before insert or update or delete on public.scholar_subjects_grades
  for each row execute function public.scholar_grades_period_guard();

-- ── 5. Staff: add / change a period ─────────────────────────
create or replace function public.upsert_academic_period(
  p_school_year text,
  p_term text,
  p_status text default null,
  p_deadline date default null,
  p_clear_deadline boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year text := btrim(coalesce(p_school_year, ''));
  v_term text := public.normalize_academic_term(p_term);
  v_id uuid;
  v_current_year text;
  v_current_term text;
begin
  if not public.is_scholars_grades_monitoring_staff() then
    raise exception 'Not authorized to manage academic periods.';
  end if;
  if v_year !~ '^\d{4}-\d{4}$' or substr(v_year, 6, 4)::int <> substr(v_year, 1, 4)::int + 1 then
    raise exception 'School year must look like 2026-2027.';
  end if;
  if v_term is null then
    raise exception 'Term must be 1st Semester, 2nd Semester or Summer.';
  end if;
  if p_status is not null and p_status not in ('open', 'closed', 'archived') then
    raise exception 'Status must be open, closed or archived.';
  end if;

  if p_status = 'archived' then
    select gps.current_school_year, public.normalize_academic_term(gps.current_semester)
      into v_current_year, v_current_term
      from public.grading_period_settings gps where gps.id = true;
    if v_current_year = v_year and v_current_term = v_term then
      raise exception 'This is the Current Grading Period — change the current period before archiving it.';
    end if;
  end if;

  insert into public.academic_periods (school_year, term, status, submission_deadline)
  values (v_year, v_term, coalesce(p_status, 'open'), case when p_clear_deadline then null else p_deadline end)
  on conflict (school_year, term) do update
    set status = coalesce(p_status, public.academic_periods.status),
        submission_deadline = case when p_clear_deadline then null else coalesce(p_deadline, public.academic_periods.submission_deadline) end,
        updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.upsert_academic_period(text, text, text, date, boolean) to authenticated;

-- ── 6. Staff: change the Current Grading Period ─────────────
-- Same name/signature as before. Also changes the period the SDP credits use.
create or replace function public.set_current_grading_period(p_school_year text, p_semester text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year text := btrim(coalesce(p_school_year, ''));
  v_term text := public.normalize_academic_term(p_semester);
  v_status text;
begin
  if not public.is_scholars_grades_monitoring_staff() then
    raise exception 'Not authorized to set the grading period.';
  end if;
  if v_year !~ '^\d{4}-\d{4}$' or substr(v_year, 6, 4)::int <> substr(v_year, 1, 4)::int + 1 then
    raise exception 'School year must look like 2026-2027.';
  end if;
  if v_term is null then
    raise exception 'Term must be 1st Semester, 2nd Semester or Summer.';
  end if;

  select status into v_status from public.academic_periods where school_year = v_year and term = v_term;
  if v_status = 'archived' then
    raise exception '% % is Archived — reopen it from Manage periods before making it the current period.', v_year, v_term;
  end if;
  if v_status is null then
    insert into public.academic_periods (school_year, term, status) values (v_year, v_term, 'open');
  end if;

  update public.grading_period_settings
  set current_school_year = v_year, current_semester = v_term, updated_at = now()
  where id = true;
end;
$$;
grant execute on function public.set_current_grading_period(text, text) to authenticated;

-- ── 7. Result check (shown in the SQL editor) ───────────────
select
  (select count(*) from public.academic_periods) as periods,
  (select count(*) from public.scholar_subjects_grades) as grade_rows,
  (select count(*) from public.scholar_subjects_grades where period_id is not null) as linked_to_a_period,
  (select count(*) from public.scholar_subjects_grades where period_id is null) as still_unlinked,
  (select count(*) from public.scholar_subjects_grades where legacy_semester is not null) as semester_label_standardized;
