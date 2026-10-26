-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 8, FILE B of 7: who can read and change the SUBJECT GRADES (table scholar_subjects_grades).
--
-- Today (checked on the live project): any staff account can read, change and delete every grade. After this file: READ by Grades Monitoring, Scholar
-- Management and the renewal reviewers; CHANGE, ADD, DELETE only by Grades Monitoring and Scholar Management. Scholars still read their own grades, and a school
-- still manages its own scholars' grades (unchanged). Server functions (service key, or run with owner rights) are not affected.
-- Safe to run twice. Undo: undo_sdp_update_p8_b.sql.  Changes ONE table's rules; run it on its own.
-- ─────────────────────────────────────────────────────────────
-- Speed note: every rule below wraps its check in (select …), so the database asks "is this person allowed?" ONCE per request instead of once per row. Without it a page that reads
-- thousands of rows (for example the submissions review list, which reads scholar records) could take seconds and hit the database's 8-second limit.
set lock_timeout = '5s';

alter table public.scholar_subjects_grades enable row level security;

drop policy if exists "staff full access" on public.scholar_subjects_grades;
drop policy if exists "p8 grades staff read grades" on public.scholar_subjects_grades;
drop policy if exists "p8 grades staff manage grades" on public.scholar_subjects_grades;

create policy "p8 grades staff read grades" on public.scholar_subjects_grades
  for select to authenticated using ((select public.is_scholars_grades_monitoring_staff() or public.is_sead_staff() or public.can_view_renewals()));

create policy "p8 grades staff manage grades" on public.scholar_subjects_grades
  for all to authenticated
  using ((select public.is_scholars_grades_monitoring_staff() or public.is_sead_staff()))
  with check ((select public.is_scholars_grades_monitoring_staff() or public.is_sead_staff()));
