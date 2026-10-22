-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 8, FILE A of 7: who can read and change the SCHOLAR RECORDS (table scholars, about 7,141 rows).
--
-- Today (checked on the live project): the rule is "staff full access": any staff account, even one with no tools, can read every scholar's full record
-- (birthday, address, phone, school…) and change or delete it. The tool tags only hide menus.
-- After this file:
--   • READ: staff who hold a tool that needs scholar records: Scholar Management, Grades Monitoring, SDP Monitoring, Scholars' Formation, Scholarship Program
--     Information, Scholar Consultation, Scholar Renewal Evaluator, SEAD Division Head, Forms Management, Research Project Monitoring, Quest Management,
--     the Head of SEAD and Super Admins (the renewal reports), and anyone assigned as a monitor of an activity. Staff with none of these read no scholar records.
--   • CHANGE, ADD, DELETE: only Scholar Management staff (the Scholars tab). The server functions (service key) are not affected.
--   • Scholars still read their own record, and a school still reads its own scholars (unchanged).
-- Safe to run twice. Undo: undo_sdp_update_p8_a.sql.  Changes ONE table's rules; run it on its own.
-- ─────────────────────────────────────────────────────────────
-- Speed note: every rule below wraps its check in (select …), so the database asks "is this person allowed?" ONCE per request instead of once per row. Without it a page that reads
-- thousands of rows (for example the submissions review list, which reads scholar records) could take seconds and hit the database's 8-second limit.
set lock_timeout = '5s';

create or replace function public._p8_can_read_scholars()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    public.is_sead_staff()
    or public.has_any_monitor_assignment()
    or public.can_view_renewals()
    or public.can_view_renewal_reports()
    or exists (select 1 from public.staff_account_tags t
               where t.staff_id = auth.uid()
                 and t.tag_key in ('scholars_grades_monitoring', 'sdp_monitoring', 'scholars_formation', 'scholarship_program_info',
                                   'forms_management', 'research_project_monitoring', 'quest_management'))
  );
$$;
revoke all on function public._p8_can_read_scholars() from public, anon;
grant execute on function public._p8_can_read_scholars() to authenticated;

alter table public.scholars enable row level security;

drop policy if exists "staff full access" on public.scholars;
drop policy if exists "p8 staff with a scholar tool read scholars" on public.scholars;
drop policy if exists "p8 scholar management manages scholars" on public.scholars;

create policy "p8 staff with a scholar tool read scholars" on public.scholars
  for select to authenticated using ((select public._p8_can_read_scholars()));

create policy "p8 scholar management manages scholars" on public.scholars
  for all to authenticated using ((select public.is_sead_staff())) with check ((select public.is_sead_staff()));
