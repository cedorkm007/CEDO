-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 8, FILE G of 7: the SCHOOL tables and the grading-period setting (small tables: schools 22 rows, school_accounts 1, school_grading_configs 1,
-- school_letter_grades 4, grading_period_settings 1).
--
-- Today (checked on the live project): any staff account can read AND change all five (rename a school, change a school's grading scale, switch the current
-- grading period, or edit the school's login record). After this file:
--   • schools: every staff account may READ the school names (the screens need them); only Scholar Management and Grades Monitoring staff may change them;
--   • school_accounts (the schools' login records): only it.admin1;
--   • school_grading_configs and school_letter_grades: READ and CHANGE only by Grades Monitoring and Scholar Management (each school still manages its own: unchanged);
--   • grading_period_settings: everybody signed in still READS it (unchanged); only Grades Monitoring and Scholar Management staff change it.
-- Server functions are not affected. Safe to run twice. Undo: undo_sdp_update_p8_g.sql.  Changes five SMALL tables' rules; run it on its own.
-- ─────────────────────────────────────────────────────────────
-- Speed note: every rule below wraps its check in (select …), so the database asks "is this person allowed?" ONCE per request instead of once per row. Without it a page that reads
-- thousands of rows (for example the submissions review list, which reads scholar records) could take seconds and hit the database's 8-second limit.
set lock_timeout = '5s';

alter table public.schools enable row level security;
drop policy if exists "staff full access" on public.schools;
drop policy if exists "p8 staff read schools" on public.schools;
drop policy if exists "p8 grades and scholar staff change schools" on public.schools;
create policy "p8 staff read schools" on public.schools for select to authenticated using ((select public.is_cedo_staff()));
create policy "p8 grades and scholar staff change schools" on public.schools for all to authenticated
  using ((select public.is_scholars_grades_monitoring_staff() or public.is_sead_staff()))
  with check ((select public.is_scholars_grades_monitoring_staff() or public.is_sead_staff()));

alter table public.school_accounts enable row level security;
drop policy if exists "staff full access" on public.school_accounts;
drop policy if exists "p8 it admin manages school accounts" on public.school_accounts;
create policy "p8 it admin manages school accounts" on public.school_accounts for all to authenticated
  using ((select public.is_it_admin())) with check ((select public.is_it_admin()));

alter table public.school_grading_configs enable row level security;
drop policy if exists "staff full access" on public.school_grading_configs;
drop policy if exists "p8 grades staff manage school grading configs" on public.school_grading_configs;
create policy "p8 grades staff manage school grading configs" on public.school_grading_configs for all to authenticated
  using ((select public.is_scholars_grades_monitoring_staff() or public.is_sead_staff()))
  with check ((select public.is_scholars_grades_monitoring_staff() or public.is_sead_staff()));

alter table public.school_letter_grades enable row level security;
drop policy if exists "staff full access" on public.school_letter_grades;
drop policy if exists "p8 grades staff manage school letter grades" on public.school_letter_grades;
create policy "p8 grades staff manage school letter grades" on public.school_letter_grades for all to authenticated
  using ((select public.is_scholars_grades_monitoring_staff() or public.is_sead_staff()))
  with check ((select public.is_scholars_grades_monitoring_staff() or public.is_sead_staff()));

alter table public.grading_period_settings enable row level security;
drop policy if exists "staff full access" on public.grading_period_settings;
drop policy if exists "p8 grades staff change grading period" on public.grading_period_settings;
create policy "p8 grades staff change grading period" on public.grading_period_settings for all to authenticated
  using ((select public.is_scholars_grades_monitoring_staff() or public.is_sead_staff()))
  with check ((select public.is_scholars_grades_monitoring_staff() or public.is_sead_staff()));
