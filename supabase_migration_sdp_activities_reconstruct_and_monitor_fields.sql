-- ─────────────────────────────────────────────────────────────
-- supabase_migration_sdp_activities_reconstruct_and_monitor_fields.sql
--
-- Phase 1 of the per-activity attendance monitor feature.
--
-- public.sdp_activities has no CREATE TABLE, and no staff write RLS,
-- committed in ANY migration in this repo — confirmed by exhaustive grep;
-- it exists live only. The `create table if not exists` below is a
-- defensive, best-effort reconstruction (inferred from
-- src/sead/sdpMonitorApi.ts's rowToActivity/NewApprovedActivityInput/
-- createApprovedActivity) — since the table already exists live, this
-- statement is a guaranteed no-op today; it exists only so a FRESH
-- environment wouldn't be missing the table entirely. It is not a
-- substitute for confirming the live schema via `\d public.sdp_activities`
-- when convenient — not blocking for this migration, since every
-- following statement uses `add column if not exists` regardless.
--
-- The actual live change here: sdp_activities gains created_by, going
-- forward only (new activities get it; existing rows stay null — no
-- backfill, per the confirmed decision that old activities simply start
-- with zero monitors until a current sdp_monitoring-tagged staff member
-- adds some).
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.sdp_activities (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null,
  submitted_by_scholar_id text references public.scholars(scholar_id_number),
  category                text,
  nature                  text[] not null default '{}',
  organization            text not null default '',
  date_time               timestamptz,
  end_time                timestamptz,
  venue                   text not null default '',
  project_head            text not null default '',
  head_cluster            text not null default '',
  budgetary_requirement   text not null default '',
  source_of_fund          text[] not null default '{}',
  source_of_fund_other    text not null default '',
  rationale               text not null default '',
  link_with_org           text not null default '',
  objectives              jsonb not null default '[]',
  target_partners         text[] not null default '{}',
  target_partners_other   text not null default '',
  specific_role           text[] not null default '{}',
  work_plan               jsonb not null default '[]',
  program_flow            jsonb not null default '[]',
  budget_items            jsonb not null default '[]',
  pubmat_path             text,
  activity_type           text not null default 'one_time',
  recurring_dates         jsonb not null default '[]',
  credits                 integer not null default 1,
  reviewed_by             uuid references public.users(id),
  reviewed_at             timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

alter table public.sdp_activities add column if not exists created_by uuid references public.users(id);

-- Idempotent no-op on the live DB (RLS is already enabled there). Included
-- so a freshly created table (the `create table if not exists` above
-- actually running, not no-op'ing) never ends up with RLS off, which
-- would mean wide-open read/write until some later migration turns it on.
-- Note this migration set does NOT reconstruct sdp_activities' baseline
-- staff CREATE/DELETE policies (those are untracked/live-only and
-- explicitly out of scope — this feature only touches UPDATE/SELECT, in
-- the next migration) — a genuinely fresh environment would still need
-- those written from scratch before staff could create activities at all.
alter table public.sdp_activities enable row level security;
