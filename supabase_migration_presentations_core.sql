-- ─────────────────────────────────────────────────────────────
-- supabase_migration_presentations_core.sql
--
-- Phase 1 of "My Presentations" — a new staff tool (Drive-like folders +
-- presentations feeding into a future Slides-like editor, see the
-- approved plan). This migration only builds the file-manager layer:
-- folders and presentations, each strictly owned by one staff member.
--
-- Ownership/RLS follows the exact idiom already used by
-- research_projects (supabase_migration_research_project_proposals.sql):
-- a single `for all using (owner_id = auth.uid()) with check (...)`
-- policy per table, no helper function needed since ownership is a
-- direct column. No other staff member can see or touch another's rows
-- through these policies at all.
--
-- Not registered in the supabase_realtime publication yet -- nothing
-- about a private, single-viewer file manager needs live cross-session
-- updates. That gets added in Phase 4 for the tables that actually need
-- it (sessions/responses), following the guarded idempotent pattern
-- established in supabase_migration_realtime_audit_and_fix.sql.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.presentation_folders (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references public.users(id) on delete cascade,
  parent_folder_id uuid references public.presentation_folders(id) on delete cascade,
  name             text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.presentations (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.users(id) on delete cascade,
  folder_id  uuid references public.presentation_folders(id) on delete cascade, -- null = root
  title      text not null default 'Untitled presentation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_presentation_folders_owner_parent on public.presentation_folders (owner_id, parent_folder_id);
create index if not exists idx_presentations_owner_folder on public.presentations (owner_id, folder_id);

alter table public.presentation_folders enable row level security;
alter table public.presentations enable row level security;

drop policy if exists "owner manages own folders" on public.presentation_folders;
create policy "owner manages own folders" on public.presentation_folders for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "owner manages own presentations" on public.presentations;
create policy "owner manages own presentations" on public.presentations for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
