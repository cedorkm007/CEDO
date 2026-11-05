-- ─────────────────────────────────────────────────────────────
-- SCHOLARSHIP PROGRAM INFORMATION BY SEMESTER AND ACADEMIC YEAR (saved snapshots).   Safe to run twice.   Undo: undo_scholarship_program_snapshots.sql
--
-- The system keeps only each scholar's CURRENT status, school, program, year level and barangay, so the past cannot be looked up later. This file adds SNAPSHOTS: a staff member with the
-- "Scholarship Program Information" tag saves, for a chosen semester and academic year, a copy of the scholars' information as it is at that moment. The page can then show any saved
-- semester exactly as it was saved (the numbers by status, barangay, school, year level and program, the scholar lists and the exports), next to the live data.
--
--   1. scholar_period_snapshots   one row per scholar per saved semester (the same information the page shows: no passwords, no grades, no documents)
--   2. scholar_snapshot_runs      which semesters were saved, when, by whom, and how many scholars
--   3. scholar_snapshot_take()    saves a semester. A semester that was already saved is NOT overwritten unless the person chooses to save it again
--   4. nine read functions        the same numbers the live page shows, from a saved semester
--   5. renewal_ongoing()          is a renewal window open now? (the page says its live numbers are subject to change while one is)
-- Creates two tables and eleven functions. Changes no existing table. Deletes nothing. Who may use it: staff with the Scholarship Program Information tag only.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.scholar_period_snapshots (
  snapshot_id            uuid primary key default gen_random_uuid(),
  school_year            text not null,
  term                   text not null,
  scholar_id_number      text not null,
  id                     uuid,
  first_name             text, last_name text, middle_name text,
  year_level             text, school text, status text, status_before_removal text, barangay text, course text,
  birthday               date, civil_status text, contact_no text, contact_email text,
  father_first_name      text, father_middle_initial text, father_last_name text,
  mother_first_name      text, mother_middle_initial text, mother_last_name text,
  taken_at               timestamptz not null default now(),
  unique (school_year, term, scholar_id_number)
);
create index if not exists scholar_period_snapshots_period_idx on public.scholar_period_snapshots (school_year, term, status);
alter table public.scholar_period_snapshots enable row level security;
revoke all on public.scholar_period_snapshots from public, anon;
grant select on public.scholar_period_snapshots to authenticated;
drop policy if exists "program info staff read snapshots" on public.scholar_period_snapshots;
create policy "program info staff read snapshots" on public.scholar_period_snapshots for select to authenticated using (public.is_scholarship_program_staff());
-- no insert / update / delete policy: scholar_snapshot_take() is the only way to write

create table if not exists public.scholar_snapshot_runs (
  school_year   text not null,
  term          text not null,
  taken_at      timestamptz not null default now(),
  taken_by      uuid,
  taken_by_name text not null default '',
  scholar_count integer not null default 0,
  primary key (school_year, term)
);
alter table public.scholar_snapshot_runs enable row level security;
revoke all on public.scholar_snapshot_runs from public, anon;
grant select on public.scholar_snapshot_runs to authenticated;
drop policy if exists "program info staff read snapshot runs" on public.scholar_snapshot_runs;
create policy "program info staff read snapshot runs" on public.scholar_snapshot_runs for select to authenticated using (public.is_scholarship_program_staff());

-- ── Saving a semester ───────────────────────────────────────
create or replace function public.scholar_snapshot_take(p_school_year text, p_term text, p_replace boolean default false)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.scholar_snapshot_runs%rowtype;
  v_n integer;
begin
  if not public.is_scholarship_program_staff() then raise exception 'Not authorized to save Scholarship Program Information.'; end if;
  if p_school_year !~ '^\d{4}-\d{4}$' then raise exception 'The academic year must look like 2026-2027.'; end if;
  if p_term not in ('1st Semester', '2nd Semester', 'Summer') then raise exception 'Choose 1st Semester, 2nd Semester or Summer.'; end if;
  select * into v_run from public.scholar_snapshot_runs where school_year = p_school_year and term = p_term;
  if found and not coalesce(p_replace, false) then
    raise exception '% % was already saved on % (% scholars). Choose "Save again" if you want to replace it with the information as it is now.', p_term, p_school_year, to_char(v_run.taken_at at time zone 'Asia/Manila', 'Mon DD, YYYY'), v_run.scholar_count;
  end if;
  delete from public.scholar_period_snapshots where school_year = p_school_year and term = p_term;
  insert into public.scholar_period_snapshots (school_year, term, scholar_id_number, id, first_name, last_name, middle_name, year_level, school, status, status_before_removal, barangay, course,
      birthday, civil_status, contact_no, contact_email, father_first_name, father_middle_initial, father_last_name, mother_first_name, mother_middle_initial, mother_last_name)
  select p_school_year, p_term, s.scholar_id_number, s.id, s.first_name, s.last_name, s.middle_name, s.year_level, s.school, s.status, s.status_before_removal, s.barangay, s.course,
      s.birthday, s.civil_status, s.contact_no, s.contact_email, s.father_first_name, s.father_middle_initial, s.father_last_name, s.mother_first_name, s.mother_middle_initial, s.mother_last_name
  from public.scholars s;
  get diagnostics v_n = row_count;
  insert into public.scholar_snapshot_runs (school_year, term, taken_at, taken_by, taken_by_name, scholar_count)
  values (p_school_year, p_term, now(), auth.uid(),
          coalesce((select btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) from public.users u where u.id = auth.uid()), ''), v_n)
  on conflict (school_year, term) do update set taken_at = excluded.taken_at, taken_by = excluded.taken_by, taken_by_name = excluded.taken_by_name, scholar_count = excluded.scholar_count;
  return v_n;
end;
$$;
revoke all on function public.scholar_snapshot_take(text, text, boolean) from public, anon;
grant execute on function public.scholar_snapshot_take(text, text, boolean) to authenticated;

-- ── The same numbers as the live page, from a saved semester ──
create or replace function public.scholarship_status_counts_snapshot(p_school_year text, p_term text)
returns table(regular_count bigint, probationary_count bigint, on_leave_count bigint, reconsidered_count bigint, removed_count bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_scholarship_program_staff() then raise exception 'Not authorized to view Scholarship Program Information.'; end if;
  return query
  select count(*) filter (where s.status = 'Regular'), count(*) filter (where s.status = 'Probationary'), count(*) filter (where s.status = 'On leave'),
         count(*) filter (where s.status = 'Reconsidered'), count(*) filter (where s.status = 'Removed')
  from public.scholar_period_snapshots s where s.school_year = p_school_year and s.term = p_term;
end;
$$;
revoke all on function public.scholarship_status_counts_snapshot(text, text) from public, anon;
grant execute on function public.scholarship_status_counts_snapshot(text, text) to authenticated;

create or replace function public.scholars_by_barangay_snapshot(p_school_year text, p_term text)
returns table(barangay text, scholar_count bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_scholarship_program_staff() then raise exception 'Not authorized to view Scholarship Program Information.'; end if;
  return query select s.barangay, count(*) from public.scholar_period_snapshots s where s.school_year = p_school_year and s.term = p_term and s.status <> 'Removed' group by s.barangay;
end;
$$;
revoke all on function public.scholars_by_barangay_snapshot(text, text) from public, anon;
grant execute on function public.scholars_by_barangay_snapshot(text, text) to authenticated;

create or replace function public.scholars_by_school_snapshot(p_school_year text, p_term text)
returns table(school text, scholar_count bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_scholarship_program_staff() then raise exception 'Not authorized to view Scholarship Program Information.'; end if;
  return query select s.school, count(*) from public.scholar_period_snapshots s
    where s.school_year = p_school_year and s.term = p_term and s.school is not null and s.school <> '' and s.status <> 'Removed' group by s.school;
end;
$$;
revoke all on function public.scholars_by_school_snapshot(text, text) from public, anon;
grant execute on function public.scholars_by_school_snapshot(text, text) to authenticated;

create or replace function public.scholars_by_school_year_level_snapshot(p_school_year text, p_term text, p_school text)
returns table(year_level text, scholar_count bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_scholarship_program_staff() then raise exception 'Not authorized to view Scholarship Program Information.'; end if;
  return query select s.year_level, count(*) from public.scholar_period_snapshots s
    where s.school_year = p_school_year and s.term = p_term and s.school = p_school and s.year_level is not null and s.year_level <> '' and s.status <> 'Removed' group by s.year_level;
end;
$$;
revoke all on function public.scholars_by_school_year_level_snapshot(text, text, text) from public, anon;
grant execute on function public.scholars_by_school_year_level_snapshot(text, text, text) to authenticated;

create or replace function public.scholars_by_school_year_level_course_snapshot(p_school_year text, p_term text, p_school text, p_year_level text)
returns table(course text, scholar_count bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_scholarship_program_staff() then raise exception 'Not authorized to view Scholarship Program Information.'; end if;
  return query select s.course, count(*) from public.scholar_period_snapshots s
    where s.school_year = p_school_year and s.term = p_term and s.school = p_school and s.year_level = p_year_level and s.course is not null and s.course <> '' and s.status <> 'Removed' group by s.course;
end;
$$;
revoke all on function public.scholars_by_school_year_level_course_snapshot(text, text, text, text) from public, anon;
grant execute on function public.scholars_by_school_year_level_course_snapshot(text, text, text, text) to authenticated;

create or replace function public.scholars_by_year_level_for_status_snapshot(p_school_year text, p_term text, p_status text)
returns table(year_level text, scholar_count bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_scholarship_program_staff() then raise exception 'Not authorized to view Scholarship Program Information.'; end if;
  return query select s.year_level, count(*) from public.scholar_period_snapshots s
    where s.school_year = p_school_year and s.term = p_term and s.status = p_status and s.year_level is not null and s.year_level <> '' group by s.year_level;
end;
$$;
revoke all on function public.scholars_by_year_level_for_status_snapshot(text, text, text) from public, anon;
grant execute on function public.scholars_by_year_level_for_status_snapshot(text, text, text) to authenticated;

create or replace function public.scholars_by_school_for_status_snapshot(p_school_year text, p_term text, p_status text)
returns table(school text, scholar_count bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_scholarship_program_staff() then raise exception 'Not authorized to view Scholarship Program Information.'; end if;
  return query select s.school, count(*) from public.scholar_period_snapshots s
    where s.school_year = p_school_year and s.term = p_term and s.status = p_status and s.school is not null and s.school <> '' group by s.school;
end;
$$;
revoke all on function public.scholars_by_school_for_status_snapshot(text, text, text) from public, anon;
grant execute on function public.scholars_by_school_for_status_snapshot(text, text, text) to authenticated;

create or replace function public.scholars_by_barangay_for_status_snapshot(p_school_year text, p_term text, p_status text)
returns table(barangay text, scholar_count bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_scholarship_program_staff() then raise exception 'Not authorized to view Scholarship Program Information.'; end if;
  return query select s.barangay, count(*) from public.scholar_period_snapshots s
    where s.school_year = p_school_year and s.term = p_term and s.status = p_status and s.barangay is not null and s.barangay <> '' group by s.barangay;
end;
$$;
revoke all on function public.scholars_by_barangay_for_status_snapshot(text, text, text) from public, anon;
grant execute on function public.scholars_by_barangay_for_status_snapshot(text, text, text) to authenticated;

create or replace function public.scholars_by_course_for_status_snapshot(p_school_year text, p_term text, p_status text)
returns table(course text, scholar_count bigint)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_scholarship_program_staff() then raise exception 'Not authorized to view Scholarship Program Information.'; end if;
  return query select s.course, count(*) from public.scholar_period_snapshots s
    where s.school_year = p_school_year and s.term = p_term and s.status = p_status and s.course is not null and s.course <> '' group by s.course;
end;
$$;
revoke all on function public.scholars_by_course_for_status_snapshot(text, text, text) from public, anon;
grant execute on function public.scholars_by_course_for_status_snapshot(text, text, text) to authenticated;

-- ── Is a renewal window open now? (any normal window; a test window for test accounts does not count) ──
create or replace function public.renewal_ongoing()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.renewal_windows w
                 where w.testers is null and (now() at time zone 'Asia/Manila')::date between w.opens_on and w.closes_on);
$$;
revoke all on function public.renewal_ongoing() from public, anon;
grant execute on function public.renewal_ongoing() to authenticated;

notify pgrst, 'reload schema';
