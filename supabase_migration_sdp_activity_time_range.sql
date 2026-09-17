-- Adds an end time to SDP activities, mirroring
-- supabase_migration_formation_activity_time_range.sql's exact shape for
-- Formation Activities — the "New Approved Activity" form's single
-- Date/Time field becomes a From/To pair (date_time = start, end_time =
-- end). Safe to run once or again.
alter table public.sdp_activities
  add column if not exists end_time timestamptz;

alter table public.sdp_activities
  drop constraint if exists sdp_activities_end_time_after_start;

alter table public.sdp_activities
  add constraint sdp_activities_end_time_after_start
  check (end_time is null or end_time > date_time);
