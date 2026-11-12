-- ─────────────────────────────────────────────────────────────
-- supabase_migration_realtime_trim.sql
-- LESS WORK FOR THE LIVE PUSH (Supabase Realtime): stop watching three tables that no screen listens to.   Safe to run twice.   Undo: undo_realtime_trim.sql
--
-- The database report showed Realtime's own question (reading the change log) as the third biggest user of database time (about 1,580 seconds). Realtime has to read every change of
-- every table in its list, even for tables nobody listens to. The website listens to: accomplishment_logs, activity_monitors, attendance_records, chat_messages, leave_requests,
-- my_survey_responses, notifications, presentation_responses, quest_word_cloud_entries, staff_account_tags, submission_uploads, submissions.
-- It does NOT listen to attendance_codes, sdp_activities and sdp_attendance (checked in every screen of the website), yet they are in the list. This takes those three out of the list.
-- Nothing in the tables changes. If a screen of a later update needs one of them, the undo (or one line) puts it back.
-- ─────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['attendance_codes', 'sdp_activities', 'sdp_attendance'] loop
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
    end if;
  end loop;
end $$;

-- Result check (shown in the SQL editor)
select tablename as still_in_the_live_push_list from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' order by 1;
