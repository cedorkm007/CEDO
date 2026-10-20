-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 4: STEP 3 of 4: one new optional column on credits (the day a credit is for)
-- Undo: see the undo_p4_* files.
-- WHY THIS IS IN SMALL STEPS: a change to a table needs a brief exclusive lock on it. Done for three tables in one run, it can meet a scholar's scan at the
-- same moment and the database cancels one of them ("deadlock detected"). Each step below touches ONE table, and gives up after 5 seconds instead of waiting
-- (if you see "lock timeout", just run the same step again a moment later). Run the steps in order, one at a time. Each is safe to run twice.
-- ─────────────────────────────────────────────────────────────
set lock_timeout = '5s';

alter table public.sdp_attendance add column if not exists activity_day date;      -- the day of the activity a credit is for; empty = not tied to a day
