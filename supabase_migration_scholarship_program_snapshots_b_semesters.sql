-- ─────────────────────────────────────────────────────────────
-- PROGRAM INFORMATION BY SEMESTER — FILE B (run this first, then file C).   Safe to run twice.   Undo: undo_scholarship_program_snapshots_b_c.sql
--
-- Changes the idea of the previous file: nobody saves a semester by hand any more.
--   • 1st Semester 2026-2027 = the scholars BEFORE the renewal: this file saves that copy once, right now (only if it was not saved yet).
--   • Every renewal semester (for example 2nd Semester 2026-2027) is filled automatically by file C as scholars are renewed.
-- This file: marks which semesters are a saved copy and which fill from the renewal, saves the one "before the renewal" copy, and adds the list of semesters the page offers.
-- Changes only scholar_snapshot_runs (one new column). Deletes nothing. Who may use it: staff with the Scholarship Program Information tag only.
-- ─────────────────────────────────────────────────────────────
set lock_timeout = '10s';

alter table public.scholar_snapshot_runs add column if not exists source text not null default 'saved';
alter table public.scholar_snapshot_runs drop constraint if exists scholar_snapshot_runs_source_check;
alter table public.scholar_snapshot_runs add constraint scholar_snapshot_runs_source_check check (source in ('saved', 'renewal'));

-- The one copy of "before the renewal": 1st Semester 2026-2027, taken from the scholars as they are now. Nothing happens if it already exists.
do $$
declare v_n integer;
begin
  if exists (select 1 from public.scholar_snapshot_runs where school_year = '2026-2027' and term = '1st Semester') then return; end if;
  delete from public.scholar_period_snapshots where school_year = '2026-2027' and term = '1st Semester';
  insert into public.scholar_period_snapshots (school_year, term, scholar_id_number, id, first_name, last_name, middle_name, year_level, school, status, status_before_removal, barangay, course,
      birthday, civil_status, contact_no, contact_email, father_first_name, father_middle_initial, father_last_name, mother_first_name, mother_middle_initial, mother_last_name)
  select '2026-2027', '1st Semester', s.scholar_id_number, s.id, s.first_name, s.last_name, s.middle_name, s.year_level, s.school, s.status, s.status_before_removal, s.barangay, s.course,
      s.birthday, s.civil_status, s.contact_no, s.contact_email, s.father_first_name, s.father_middle_initial, s.father_last_name, s.mother_first_name, s.mother_middle_initial, s.mother_last_name
  from public.scholars s;
  get diagnostics v_n = row_count;
  insert into public.scholar_snapshot_runs (school_year, term, taken_at, taken_by, taken_by_name, scholar_count, source)
  values ('2026-2027', '1st Semester', now(), null, '', v_n, 'saved');
end $$;

-- A semester that fills from the renewal cannot be saved by hand (that would overwrite what the renewal has filled in).
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
  if not found and exists (select 1 from public.renewal_windows w where w.school_year = p_school_year and w.term = p_term and w.testers is null) then
    raise exception '% % fills in by itself as scholars are renewed, so it cannot be saved by hand.', p_term, p_school_year;
  end if;
  delete from public.scholar_period_snapshots where school_year = p_school_year and term = p_term;
  insert into public.scholar_period_snapshots (school_year, term, scholar_id_number, id, first_name, last_name, middle_name, year_level, school, status, status_before_removal, barangay, course,
      birthday, civil_status, contact_no, contact_email, father_first_name, father_middle_initial, father_last_name, mother_first_name, mother_middle_initial, mother_last_name)
  select p_school_year, p_term, s.scholar_id_number, s.id, s.first_name, s.last_name, s.middle_name, s.year_level, s.school, s.status, s.status_before_removal, s.barangay, s.course,
      s.birthday, s.civil_status, s.contact_no, s.contact_email, s.father_first_name, s.father_middle_initial, s.father_last_name, s.mother_first_name, s.mother_middle_initial, s.mother_last_name
  from public.scholars s;
  get diagnostics v_n = row_count;
  insert into public.scholar_snapshot_runs (school_year, term, taken_at, taken_by, taken_by_name, scholar_count, source)
  values (p_school_year, p_term, now(), auth.uid(),
          coalesce((select btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) from public.users u where u.id = auth.uid()), ''), v_n, 'saved')
  on conflict (school_year, term) do update set taken_at = excluded.taken_at, taken_by = excluded.taken_by, taken_by_name = excluded.taken_by_name, scholar_count = excluded.scholar_count, source = 'saved';
  return v_n;
end;
$$;
revoke all on function public.scholar_snapshot_take(text, text, boolean) from public, anon;
grant execute on function public.scholar_snapshot_take(text, text, boolean) to authenticated;

-- The semesters the page offers: the saved copies, and every semester that has a real (not test) renewal window — those fill in from the renewal.
create or replace function public.program_info_periods()
returns table(period_school_year text, period_term text, kind text, updated_at timestamptz, updated_by_name text, scholars bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_scholarship_program_staff() then raise exception 'Not authorized to view Scholarship Program Information.'; end if;
  return query
  select r.school_year, r.term, 'saved'::text, r.taken_at, r.taken_by_name, r.scholar_count::bigint
  from public.scholar_snapshot_runs r where r.source = 'saved'
  union all
  select p.school_year, p.term, 'renewal'::text,
         (select max(s.taken_at) from public.scholar_period_snapshots s where s.school_year = p.school_year and s.term = p.term),
         ''::text,
         (select count(*) from public.scholar_period_snapshots s where s.school_year = p.school_year and s.term = p.term)
  from (select distinct w.school_year, w.term from public.renewal_windows w
         where w.testers is null
           and not exists (select 1 from public.scholar_snapshot_runs r2 where r2.school_year = w.school_year and r2.term = w.term and r2.source = 'saved')) p;
end;
$$;
revoke all on function public.program_info_periods() from public, anon;
grant execute on function public.program_info_periods() to authenticated;

notify pgrst, 'reload schema';
