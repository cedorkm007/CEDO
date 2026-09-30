-- ─────────────────────────────────────────────────────────────
-- supabase_migration_presentation_responses_realtime_fix.sql
--
-- Reported during Phase 4 live testing: the presenter's live results
-- panel never updated when the audience submitted a vote -- required
-- navigating away and back (a fresh fetch) to see it. This is the same
-- "subscribed successfully but no event ever arrives" class of bug
-- already hit and fixed for activity_monitors
-- (supabase_migration_activity_monitors_realtime.sql) and audited
-- across the app in supabase_migration_realtime_audit_and_fix.sql --
-- confirmed again live here with the same temporary-console-logging
-- technique: the presentation_responses channel reports status
-- SUBSCRIBED, but a real INSERT/UPDATE on the table never triggers the
-- 'postgres_changes' callback, even though
-- supabase_migration_presentations_sessions.sql already included an
-- `alter publication supabase_realtime add table` guard for it.
--
-- Re-asserts that registration (a no-op if it's actually already
-- there) and, unlike last time, verifies with a SELECT you can actually
-- read the result of, rather than trusting silence.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'presentation_responses'
  ) then
    alter publication supabase_realtime add table public.presentation_responses;
  end if;
end $$;

-- Verification -- must read true.
select exists (
  select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'presentation_responses'
) as presentation_responses_in_realtime_publication;
