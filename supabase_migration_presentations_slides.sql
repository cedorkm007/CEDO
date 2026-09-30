-- ─────────────────────────────────────────────────────────────
-- supabase_migration_presentations_slides.sql
--
-- Phase 2 of "My Presentations" — adds presentation_slides, the table
-- backing the Slides-like editor (left sidebar thumbnails, main preview,
-- right sidebar settings). Ownership scopes through a join to
-- `presentations` (this table has no owner_id column of its own),
-- following the exact idiom already used by
-- research_project_stage_submissions -> research_projects
-- (supabase_migration_research_project_proposals.sql):
-- `using (exists (select 1 from presentations p where p.id = presentation_id and p.owner_id = auth.uid()))`.
--
-- `type` only allows 'title' for now (Phase 2's placeholder slide type,
-- matching the spec's optional "Title / Text slide"); 'word_cloud',
-- 'multiple_choice', and 'ranking' are accepted by the check constraint
-- already so Phase 3 doesn't need another migration just to widen it,
-- but the editor UI doesn't yet let you configure them beyond picking
-- the type.
--
-- Not registered in the supabase_realtime publication -- same reasoning
-- as presentation_folders/presentations in Phase 1: only the owner ever
-- views their own slides while editing, no multi-viewer live-update
-- need yet (that lands in Phase 4 for sessions/responses).
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.presentation_slides (
  id              uuid primary key default gen_random_uuid(),
  presentation_id uuid not null references public.presentations(id) on delete cascade,
  type            text not null default 'title' check (type in ('title', 'word_cloud', 'multiple_choice', 'ranking')),
  order_index     integer not null,
  settings        jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_presentation_slides_presentation on public.presentation_slides (presentation_id, order_index);

alter table public.presentation_slides enable row level security;

drop policy if exists "owner manages own slides" on public.presentation_slides;
create policy "owner manages own slides" on public.presentation_slides for all
  using (exists (select 1 from public.presentations p where p.id = presentation_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from public.presentations p where p.id = presentation_id and p.owner_id = auth.uid()));

-- Presentations' own updated_at should reflect the last time any of its
-- slides changed too (not just the title/folder), so the file manager's
-- "Last Modified" column and sort-by-date stay meaningful once editing
-- actually happens through slides rather than the title field alone.
create or replace function public.touch_presentation_on_slide_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.presentations set updated_at = now() where id = coalesce(new.presentation_id, old.presentation_id);
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_touch_presentation_on_slide_change on public.presentation_slides;
create trigger trg_touch_presentation_on_slide_change
  after insert or update or delete on public.presentation_slides
  for each row execute function public.touch_presentation_on_slide_change();
