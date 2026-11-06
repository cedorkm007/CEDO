-- ─────────────────────────────────────────────────────────────
-- PROGRAM INFORMATION BY SEMESTER — FILE D (run after files B and C).   Safe to run twice.   Undo: undo_scholarship_program_snapshots_b_c.sql
--
-- FIX: a scholar who was renewed but is on Probationary was counted as Regular in the renewal semester (2nd Semester).
-- Reason: the renewal records a normal confirmation as "renewed" even when the scholar is on probation, and the status is kept on the scholar, not on the renewal.
-- Now a renewed scholar takes the scholar's own status (Probationary, Reconsidered, On leave, otherwise Regular), the same rule the Renewed tab of Scholar Renewal uses,
-- and the semester follows the scholar if the status changes later (for example probation lifted after an INC is complied with).
-- This file: replaces the fill-in function, adds one trigger on scholars (status changes), and corrects the rows already filled. Deletes nothing.
-- ─────────────────────────────────────────────────────────────
set lock_timeout = '10s';

create or replace function public._program_info_status_for(p_result text, p_current text)
returns text
language sql
immutable
as $$
  select case p_result
           when 'renewed' then case when p_current in ('Probationary', 'Reconsidered', 'On leave') then p_current else 'Regular' end
           when 'renewed_probationary' then 'Probationary'
           when 'reconsidered' then 'Reconsidered'
           when 'removed' then 'Removed'
         end;
$$;
revoke all on function public._program_info_status_for(text, text) from public, anon;
grant execute on function public._program_info_status_for(text, text) to authenticated;

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
    v_status := case when tg_op = 'DELETE' then null
                     else public._program_info_status_for(r.result, (select s.status from public.scholars s where s.scholar_id_number = r.scholar_id_number)) end;
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

-- When a renewed scholar's status changes later, the renewal semester follows (only for a plain "renewed" result: the other results are fixed by the renewal's decision).
create or replace function public._program_info_scholar_status_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    update public.scholar_period_snapshots p
       set status = public._program_info_status_for(r.result, new.status), taken_at = now()
      from public.renewal_records r
     where r.scholar_id_number = new.scholar_id_number and p.scholar_id_number = r.scholar_id_number
       and p.school_year = r.school_year and p.term = r.term and r.result = 'renewed'
       and not exists (select 1 from public.scholar_snapshot_runs x where x.school_year = p.school_year and x.term = p.term and x.source = 'saved')
       and p.status is distinct from public._program_info_status_for(r.result, new.status);
  exception when others then
    raise warning 'Program Information was not updated for a status change: %', sqlerrm;
  end;
  return new;
end;
$$;
revoke all on function public._program_info_scholar_status_sync() from public, anon, authenticated;

drop trigger if exists program_info_scholar_status_sync on public.scholars;
create trigger program_info_scholar_status_sync
  after update of status on public.scholars
  for each row when (old.status is distinct from new.status)
  execute function public._program_info_scholar_status_sync();

-- Correct the rows already filled: renewed scholars take their own status.
update public.scholar_period_snapshots p
   set status = public._program_info_status_for(r.result, s.status)
  from public.renewal_records r
  join public.scholars s on s.scholar_id_number = r.scholar_id_number
 where r.scholar_id_number = p.scholar_id_number and r.school_year = p.school_year and r.term = p.term and r.result = 'renewed'
   and not exists (select 1 from public.scholar_snapshot_runs x where x.school_year = p.school_year and x.term = p.term and x.source = 'saved')
   and p.status is distinct from public._program_info_status_for(r.result, s.status);

notify pgrst, 'reload schema';
