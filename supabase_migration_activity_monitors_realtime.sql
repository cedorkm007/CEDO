-- ─────────────────────────────────────────────────────────────
-- supabase_migration_activity_monitors_realtime.sql
--
-- Bug: tagging it.admin1 as a monitor didn't make "Scanning Tools" appear
-- in their sidebar. Confirmed live: the activity_monitors row was created
-- correctly and has_any_monitor_assignment() correctly returns true for
-- that account — the data/RLS side is fine. The missing piece is that a
-- brand-new table is never part of the supabase_realtime publication by
-- default, so App.tsx's useRealtimeRefresh("activity_monitors", ...)
-- subscription (added in this feature's Phase 5) never actually fires —
-- same root cause already hit and fixed for staff_account_tags/
-- submission_uploads (supabase_migration_realtime_tags_and_uploads.sql)
-- and quest_word_cloud_entries (supabase_migration_quest_word_cloud.sql).
-- Without this, a newly-tagged monitor only sees the new tab after a full
-- page refresh or re-login (fetchUserProfile() runs fresh then), not live.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'activity_monitors'
  ) then
    alter publication supabase_realtime add table public.activity_monitors;
  end if;
end $$;
