-- ─────────────────────────────────────────────────────────────
-- supabase_migration_realtime_audit_and_fix.sql
--
-- Reported: adding yourself as a monitor still requires a page refresh
-- to see "Scanning Tools" appear in the sidebar, even though
-- supabase_migration_activity_monitors_realtime.sql was already run.
--
-- Confirmed live (by adding temporary console logging to the app's
-- realtime subscription helper and watching the browser console while
-- inserting/deleting rows via the service role): the app's
-- activity_monitors channel DOES subscribe successfully (status
-- SUBSCRIBED), but genuinely never receives a postgres_changes event for
-- any insert/delete on that table -- while the exact same mechanism
-- (subscribeToTable/useRealtimeRefresh, same session, same page load)
-- DOES receive events for staff_account_tags moments later. Since a page
-- refresh always "fixes" this regardless of publication membership (a
-- fresh load re-runs has_any_monitor_assignment() directly, no realtime
-- involved), the earlier "I see it, now" confirmation never actually
-- exercised the no-refresh path -- this migration is that path's first
-- real test.
--
-- This re-asserts every table the app currently subscribes to via
-- src/lib/supabase.ts's subscribeToTable() / src/app/useRealtimeRefresh.ts
-- (grepped directly from source, not guessed) into the supabase_realtime
-- publication, in one place, so this exact "works until you check the
-- one that was never actually tested" gap can't recur for any of them.
-- ADD TABLE is a no-op if a table is already a member, so this is safe
-- to run regardless of each table's current state.
--
-- Run the SELECT at the bottom afterward and check every row reads
-- true -- that's the actual proof, not just "no error was raised."
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

do $$
declare
  t text;
begin
  foreach t in array array[
    'activity_monitors',       -- src/app/App.tsx:2944 (this bug report)
    'staff_account_tags',      -- src/app/App.tsx:2927 (confirmed already working)
    'submission_uploads',      -- src/sead/pages/SubmissionRosterPanel.tsx:83
    'quest_word_cloud_entries',-- src/sead/components/WordCloudLiveView.tsx:75
    'attendance_records',      -- src/sead/pages/SDPMonitoringTab.tsx:349, FormationActivitiesTab.tsx:397
    'chat_messages',           -- src/app/App.tsx:2493
    'notifications',           -- src/app/App.tsx:3192
    'submissions',             -- src/app/App.tsx:3193
    'leave_requests',          -- src/app/App.tsx:3194
    'accomplishment_logs'      -- src/app/App.tsx:3195
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Verification -- every row must read true. Run this after the block
-- above and check the result grid.
select t as table_name, exists (
  select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t
) as in_realtime_publication
from unnest(array[
  'activity_monitors', 'staff_account_tags', 'submission_uploads', 'quest_word_cloud_entries',
  'attendance_records', 'chat_messages', 'notifications', 'submissions', 'leave_requests', 'accomplishment_logs'
]) as t;
