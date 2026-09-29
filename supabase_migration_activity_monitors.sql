-- ─────────────────────────────────────────────────────────────
-- supabase_migration_activity_monitors.sql
--
-- Phase 1 of the per-activity attendance monitor feature.
--
-- A single polymorphic table for which staff can edit/scan a given SDP or
-- Formation activity — no per-activity staff-assignment table existed
-- anywhere in this schema before this. The activity's creator is treated
-- as an implicit monitor (via created_by, not a row in this table) by the
-- is_activity_monitor() helper added in the next migration — this table
-- only holds EXPLICITLY assigned monitors beyond the creator.
--
-- RLS policies land in the next migration (supabase_migration_
-- activity_monitor_helpers_and_policies.sql), since they need
-- is_activity_monitor()-adjacent logic. Enabling RLS here with zero
-- policies yet is safe — it means "deny all" until that migration lands,
-- not "allow all."
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.activity_monitors (
  id            uuid primary key default gen_random_uuid(),
  activity_type text not null check (activity_type in ('sdp', 'formation')),
  activity_id   uuid not null,
  staff_id      uuid not null references public.users(id) on delete cascade,
  assigned_by   uuid references public.users(id),
  created_at    timestamptz not null default now(),
  unique (activity_type, activity_id, staff_id)
);

create index if not exists idx_activity_monitors_staff on public.activity_monitors (staff_id);
create index if not exists idx_activity_monitors_activity on public.activity_monitors (activity_type, activity_id);

alter table public.activity_monitors enable row level security;
