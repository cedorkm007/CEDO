-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 8, FILE F of 7: who can read and change the QR ATTENDANCE RECORDS (table attendance_records, 5,259 rows).
--
-- Today (checked on the live project): besides the correct rules (SDP Monitoring / Scholar Management staff read; each scholar reads their own) there is a
-- "staff full access" rule: any staff account can read, change and delete every attendance record. After this file nobody changes a record through the website
-- (attendance is recorded only by the scan functions, which run with their own rights and are not affected). READ: Scholar Management, SDP Monitoring,
-- Scholars' Formation, Scholarship Program Information (the profile export), the renewal reviewers and monitors of an activity. Safe to run twice.
-- Undo: undo_sdp_update_p8_f.sql.  Changes ONE table's rules; run it on its own.
-- ─────────────────────────────────────────────────────────────
-- Speed note: every rule below wraps its check in (select …), so the database asks "is this person allowed?" ONCE per request instead of once per row. Without it a page that reads
-- thousands of rows (for example the submissions review list, which reads scholar records) could take seconds and hit the database's 8-second limit.
set lock_timeout = '5s';

alter table public.attendance_records enable row level security;

drop policy if exists "staff full access" on public.attendance_records;
drop policy if exists "p8 tool staff read attendance records" on public.attendance_records;

create policy "p8 tool staff read attendance records" on public.attendance_records
  for select to authenticated
  using ((select public.is_sead_staff() or public.can_view_renewals() or public.has_any_monitor_assignment()
          or exists (select 1 from public.staff_account_tags t where t.staff_id = auth.uid()
                     and t.tag_key in ('sdp_monitoring', 'scholars_formation', 'scholarship_program_info'))));
