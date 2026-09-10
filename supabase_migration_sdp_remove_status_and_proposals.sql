-- ─────────────────────────────────────────────────────────────
-- supabase_migration_sdp_remove_status_and_proposals.sql
--
-- Removes the SDP Activities status concept (pending/approved/ongoing/
-- finished/canceled/rescheduled) entirely, and the scholar-submitted
-- proposal flow that was its one real use — staff-created activities
-- already started "approved" automatically, and no scholar has ever
-- actually submitted a proposal (confirmed against live data: zero rows
-- have submitted_by_scholar_id set). Every SDP activity is now
-- staff-created and open to all scholars immediately.
--
-- "scholar reads open activities" filtered on both
-- submitted_by_scholar_id IS NULL and status IN ('approved','ongoing',
-- 'finished') — recreated without the status half, since the column is
-- being dropped. The "scholar submits own proposal" INSERT policy and
-- "scholar reads own proposals" SELECT policy are dropped outright: with
-- the submission UI removed and no historical data to preserve, there's
-- no remaining legitimate write/read path for a scholar to use them.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

drop policy if exists "scholar reads open activities" on public.sdp_activities;
create policy "scholar reads open activities" on public.sdp_activities
  for select using (submitted_by_scholar_id is null);

drop policy if exists "scholar submits own proposal" on public.sdp_activities;
drop policy if exists "scholar reads own proposals" on public.sdp_activities;

alter table public.sdp_activities drop column if exists status;
