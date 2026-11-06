-- ─────────────────────────────────────────────────────────────
-- PROGRAM INFORMATION BY SEMESTER — FILE C (run after file B).   Safe to run twice.   Undo: undo_scholarship_program_snapshots_b_c.sql
--
-- Fills a renewal semester (for example 2nd Semester 2026-2027) automatically: when a scholar's renewal ends as Renewed, Renewed (probationary), Reconsidered or Removed, that scholar
-- is added to the semester with the school, program and year level confirmed in the renewal, and the matching status (Regular, Probationary, Reconsidered, Removed).
-- When a renewal is reverted (the application is deleted) or its result is taken away, the scholar leaves the semester again.
-- Test accounts' test windows are ignored. A semester that was saved by hand (such as the "before the renewal" copy of 1st Semester 2026-2027) is never touched.
-- If anything goes wrong in here, the renewal itself still works: the problem is only printed as a warning.
-- Adds one trigger on renewal_records and fills in the scholars already decided. Deletes nothing that exists today.
-- ─────────────────────────────────────────────────────────────
set lock_timeout = '10s';

create or replace function public._program_info_renewal_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.renewal_records%rowtype;
  v_status text;
begin
  begin
    if tg_op = 'DELETE' then r := old; else r := new; end if;
    if exists (select 1 from public.scholar_snapshot_runs x where x.school_year = r.school_year and x.term = r.term and x.source = 'saved') then
      if tg_op = 'DELETE' then return old; else return new; end if;
    end if;
    v_status := case when tg_op = 'DELETE' then null else
      case r.result when 'renewed' then 'Regular' when 'renewed_probationary' then 'Probationary' when 'reconsidered' then 'Reconsidered' when 'removed' then 'Removed' end end;
    if v_status is not null and r.window_id is not null
       and exists (select 1 from public.renewal_windows w where w.id = r.window_id and w.testers is not null) then
      v_status := null;      -- a test window
    end if;
    if v_status is null then
      delete from public.scholar_period_snapshots where school_year = r.school_year and term = r.term and scholar_id_number = r.scholar_id_number;
    else
      insert into public.scholar_period_snapshots (school_year, term, scholar_id_number, id, first_name, last_name, middle_name, year_level, school, status, status_before_removal, barangay, course,
          birthday, civil_status, contact_no, contact_email, father_first_name, father_middle_initial, father_last_name, mother_first_name, mother_middle_initial, mother_last_name, taken_at)
      select r.school_year, r.term, s.scholar_id_number, s.id, s.first_name, s.last_name, s.middle_name,
          coalesce(nullif(btrim(r.confirmed_year_level), ''), s.year_level), coalesce(nullif(btrim(r.confirmed_school), ''), s.school), v_status,
          case when v_status = 'Removed' then s.status_before_removal else null end, s.barangay, coalesce(nullif(btrim(r.confirmed_program), ''), s.course),
          s.birthday, s.civil_status, s.contact_no, s.contact_email, s.father_first_name, s.father_middle_initial, s.father_last_name, s.mother_first_name, s.mother_middle_initial, s.mother_last_name, now()
      from public.scholars s where s.scholar_id_number = r.scholar_id_number
      on conflict (school_year, term, scholar_id_number) do update set
          year_level = excluded.year_level, school = excluded.school, status = excluded.status, status_before_removal = excluded.status_before_removal, course = excluded.course,
          barangay = excluded.barangay, first_name = excluded.first_name, last_name = excluded.last_name, middle_name = excluded.middle_name, taken_at = now();
    end if;
  exception when others then
    raise warning 'Program Information was not updated for a renewal: %', sqlerrm;
  end;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
revoke all on function public._program_info_renewal_sync() from public, anon, authenticated;

drop trigger if exists program_info_renewal_sync on public.renewal_records;
create trigger program_info_renewal_sync
  after insert or update or delete on public.renewal_records
  for each row execute function public._program_info_renewal_sync();

-- The scholars whose renewal was already decided (renewal semesters only; saved copies and test windows are left out).
insert into public.scholar_period_snapshots (school_year, term, scholar_id_number, id, first_name, last_name, middle_name, year_level, school, status, status_before_removal, barangay, course,
    birthday, civil_status, contact_no, contact_email, father_first_name, father_middle_initial, father_last_name, mother_first_name, mother_middle_initial, mother_last_name)
select r.school_year, r.term, s.scholar_id_number, s.id, s.first_name, s.last_name, s.middle_name,
    coalesce(nullif(btrim(r.confirmed_year_level), ''), s.year_level), coalesce(nullif(btrim(r.confirmed_school), ''), s.school),
    case r.result when 'renewed' then 'Regular' when 'renewed_probationary' then 'Probationary' when 'reconsidered' then 'Reconsidered' else 'Removed' end,
    case when r.result = 'removed' then s.status_before_removal else null end, s.barangay, coalesce(nullif(btrim(r.confirmed_program), ''), s.course),
    s.birthday, s.civil_status, s.contact_no, s.contact_email, s.father_first_name, s.father_middle_initial, s.father_last_name, s.mother_first_name, s.mother_middle_initial, s.mother_last_name
from public.renewal_records r
join public.scholars s on s.scholar_id_number = r.scholar_id_number
where r.result in ('renewed', 'renewed_probationary', 'reconsidered', 'removed')
  and not exists (select 1 from public.scholar_snapshot_runs x where x.school_year = r.school_year and x.term = r.term and x.source = 'saved')
  and not exists (select 1 from public.renewal_windows w where w.id = r.window_id and w.testers is not null)
on conflict (school_year, term, scholar_id_number) do nothing;

notify pgrst, 'reload schema';
