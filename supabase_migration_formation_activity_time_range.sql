-- Adds an end time to existing Formation Activities. Safe to run once or again.
alter table public.formation_activities
  add column if not exists end_time timestamptz;

alter table public.formation_activities
  drop constraint if exists formation_activities_end_time_after_start;

alter table public.formation_activities
  add constraint formation_activities_end_time_after_start
  check (end_time is null or end_time > date_time);
