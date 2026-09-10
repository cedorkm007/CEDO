-- ─────────────────────────────────────────────────────────────
-- supabase_migration_scholarship_program_info_fix_tag_gate.sql
--
-- Bug fix: every RPC behind the "Scholarship Program Information" tab
-- (phases 1-3, plus the later status-breakdown migrations) checked
-- public.is_sead_staff() — a boolean flag on public.users completely
-- unrelated to the "scholarship_program_info" tag it.admin1 actually
-- grants from the Staff Accounts page. A staff account tagged for this
-- tool (but not separately flagged is_sead_staff) sees the sidebar item
-- and the page shell, but every data RPC raises "Not authorized to view
-- Scholarship Program Information." — the page loads with zero data.
--
-- Fixed by gating on the tag itself, the same pattern
-- is_research_monitoring_staff() already established for Research
-- Project Monitoring: a small named helper reading staff_account_tags,
-- with every affected RPC re-created to call it instead.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

create or replace function public.is_scholarship_program_staff()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.staff_account_tags t
    where t.staff_id = auth.uid() and t.tag_key = 'scholarship_program_info'
  );
$$;
grant execute on function public.is_scholarship_program_staff() to authenticated;

-- ── Phase 1 ──────────────────────────────────────────────────
create or replace function public.scholarship_status_counts()
returns table (
  regular_count bigint,
  probationary_count bigint,
  on_leave_count bigint,
  reconsidered_count bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_scholarship_program_staff() then
    raise exception 'Not authorized to view Scholarship Program Information.';
  end if;

  return query
  select
    count(*) filter (where status = 'Regular'),
    count(*) filter (where status = 'Probationary'),
    count(*) filter (where status = 'On leave'),
    count(*) filter (where status = 'Reconsidered')
  from public.scholars;
end;
$$;

-- ── Phase 2 ──────────────────────────────────────────────────
create or replace function public.scholars_by_barangay()
returns table (
  barangay text,
  scholar_count bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_scholarship_program_staff() then
    raise exception 'Not authorized to view Scholarship Program Information.';
  end if;

  return query
  select s.barangay, count(*) as scholar_count
  from public.scholars s
  group by s.barangay;
end;
$$;

-- ── Phase 3 ──────────────────────────────────────────────────
create or replace function public.scholars_by_school()
returns table (
  school text,
  scholar_count bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_scholarship_program_staff() then
    raise exception 'Not authorized to view Scholarship Program Information.';
  end if;

  return query
  select s.school, count(*) as scholar_count
  from public.scholars s
  where s.school is not null and s.school != ''
  group by s.school;
end;
$$;

create or replace function public.scholars_by_school_year_level(p_school text)
returns table (
  year_level text,
  scholar_count bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_scholarship_program_staff() then
    raise exception 'Not authorized to view Scholarship Program Information.';
  end if;

  return query
  select s.year_level, count(*) as scholar_count
  from public.scholars s
  where s.school = p_school and s.year_level is not null and s.year_level != ''
  group by s.year_level;
end;
$$;

create or replace function public.scholars_by_school_year_level_course(p_school text, p_year_level text)
returns table (
  course text,
  scholar_count bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_scholarship_program_staff() then
    raise exception 'Not authorized to view Scholarship Program Information.';
  end if;

  return query
  select s.course, count(*) as scholar_count
  from public.scholars s
  where s.school = p_school and s.year_level = p_year_level and s.course is not null and s.course != ''
  group by s.course;
end;
$$;

-- ── Status stat-card drill-down (Year Level / School / Barangay) ──
create or replace function public.scholars_by_year_level_for_status(p_status text)
returns table (
  year_level text,
  scholar_count bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_scholarship_program_staff() then
    raise exception 'Not authorized to view Scholarship Program Information.';
  end if;

  return query
  select s.year_level, count(*) as scholar_count
  from public.scholars s
  where s.status = p_status and s.year_level is not null and s.year_level != ''
  group by s.year_level;
end;
$$;

create or replace function public.scholars_by_school_for_status(p_status text)
returns table (
  school text,
  scholar_count bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_scholarship_program_staff() then
    raise exception 'Not authorized to view Scholarship Program Information.';
  end if;

  return query
  select s.school, count(*) as scholar_count
  from public.scholars s
  where s.status = p_status and s.school is not null and s.school != ''
  group by s.school;
end;
$$;

create or replace function public.scholars_by_barangay_for_status(p_status text)
returns table (
  barangay text,
  scholar_count bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_scholarship_program_staff() then
    raise exception 'Not authorized to view Scholarship Program Information.';
  end if;

  return query
  select s.barangay, count(*) as scholar_count
  from public.scholars s
  where s.status = p_status and s.barangay is not null and s.barangay != ''
  group by s.barangay;
end;
$$;

-- ── Status stat-card drill-down (Course) ─────────────────────
create or replace function public.scholars_by_course_for_status(p_status text)
returns table (
  course text,
  scholar_count bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_scholarship_program_staff() then
    raise exception 'Not authorized to view Scholarship Program Information.';
  end if;

  return query
  select s.course, count(*) as scholar_count
  from public.scholars s
  where s.status = p_status and s.course is not null and s.course != ''
  group by s.course;
end;
$$;
