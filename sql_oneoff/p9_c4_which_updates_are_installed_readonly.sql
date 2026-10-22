-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 9 follow-up (C4): WHICH of my SQL files are installed on the live project?   READ-ONLY: changes nothing, shows no data.
--
-- It looks for the marks each file leaves (a table, a rule or a function with a known name). Use it when something broke "after an update" and we need to know exactly
-- which files are in place, instead of relying on memory. Send me the result. Choose "Run without RLS" if asked.
-- ─────────────────────────────────────────────────────────────
select step, what_it_is, case when installed then 'INSTALLED' else 'not installed' end as state
from (
  values
  ('Phase 1',  'credit history and code lockdown',                    to_regclass('public.sdp_credit_history') is not null),
  ('Phase 2',  'checklist paging',                                    to_regproc('public.scholars_sdp_checklist_page') is not null),
  ('Phase 2b', 'checklist saved results',                             to_regclass('public.sdp_checklist_saved') is not null),
  ('Phase 3',  'sub-categories',                                      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sdp_activities' and column_name = 'sub_category')),
  ('Phase 3b', 'backfill of old activities (backup table)',           to_regclass('public.sdp_subcategory_backfill_backup') is not null),
  ('Phase 4',  'per-day codes (day on codes)',                        exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'attendance_codes' and column_name = 'day_date')),
  ('Phase 5',  'semester choice for crediting',                       to_regproc('public.move_sdp_credit_semester') is not null),
  ('Phase 6',  'password and sign-in security (marker table)',        to_regclass('public.account_password_flags') is not null),
  ('Phase 7 A','only it.admin1 changes tool tags',                    exists (select 1 from pg_policies where tablename = 'staff_account_tags' and policyname = 'p7 it admin changes tags')),
  ('Phase 7 B','no self-promotion in staff accounts',                 exists (select 1 from pg_policies where tablename = 'users' and policyname = 'p7 staff update users')),
  ('Phase 7 C','scholar account history can only grow',               exists (select 1 from pg_policies where tablename = 'sead_scholar_account_log' and policyname = 'p7 staff add account log')),
  ('Phase 7 D','division history can only grow',                      exists (select 1 from pg_policies where tablename = 'division_change_log' and policyname = 'p7 it admin adds division log')),
  ('Phase 7 E','undone column (Undo upload)',                         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sead_scholar_account_log' and column_name = 'undone')),
  ('Phase 8 A','scholar records follow the tool tags',                exists (select 1 from pg_policies where tablename = 'scholars' and policyname = 'p8 staff with a scholar tool read scholars')),
  ('Phase 8 B','subject grades follow the tool tags',                 exists (select 1 from pg_policies where tablename = 'scholar_subjects_grades' and policyname = 'p8 grades staff read grades')),
  ('Phase 8 C','quest scores follow the tool tags',                   exists (select 1 from pg_policies where tablename = 'scholar_quest_scores' and policyname = 'p8 quest staff read scores')),
  ('Phase 8 D','SDP category status',                                 exists (select 1 from pg_policies where tablename = 'scholar_sdp_category_status' and policyname = 'p8 other staff read sdp status')),
  ('Phase 8 E','two old empty tables',                                exists (select 1 from pg_policies where tablename = 'scholar_services' and policyname = 'p8 scholar management manages scholar_services')),
  ('Phase 8 F','QR attendance records',                               exists (select 1 from pg_policies where tablename = 'attendance_records' and policyname = 'p8 tool staff read attendance records')),
  ('Phase 8 G','schools and the grading period',                      exists (select 1 from pg_policies where tablename = 'schools' and policyname = 'p8 staff read schools')),
  ('Phase 9 A','functions closed to visitors',                        to_regclass('public.p9_closed_functions') is not null),
  ('Phase 9 B','must change 123456',                                  to_regclass('public.p9_default_password_settings') is not null),
  ('Phase 9 C','Forms Management staff open submission files',        exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'staff reads submission uploads' and coalesce(qual, '') like '%forms_management%'))
) as t(step, what_it_is, installed)
order by step;
