-- ─────────────────────────────────────────────────────────────
-- supabase_migration_submission_activities.sql
--
-- Part 1 of the Submission Activity feature (data model + staff CRUD
-- only — no Google Drive integration and no scholar-facing upload UI
-- yet; those are later parts). Creates the two tables staff use to
-- define an activity and its required/optional upload fields:
--
--   submission_activities     — one row per activity ("Certificate of
--                                Participation Drive", etc.)
--   submission_upload_fields  — the ordered list of upload slots each
--                                activity asks for (label, required?,
--                                max files), one-to-many with the above
--
-- Deliberately does NOT create a submissions/uploads table yet — that
-- belongs to Part 2 (scholar-side interface), since its shape depends on
-- decisions not yet made there (how a single upload row relates to a
-- field vs. multiple files per field, etc.). Creating it now would risk
-- getting ahead of that design.
--
-- RLS follows the exact pattern already established for form_materials in
-- supabase_migration_form_material_unlock_engine.sql, since this feature
-- is explicitly "under Forms Management": any is_sead_staff() account can
-- READ (so any SEAD staff member can see what's configured), but only an
-- account with the specific "forms_management" staff_account_tags tag can
-- WRITE (create/edit/delete) — the tag is a real security boundary here,
-- not just a UI nav gate.
--
-- Scholar read access is restricted to activities applicable to their own
-- year level, using the identical all_year_levels/target_year_levels
-- storage shape already used by form_material_conditions' year_level
-- condition type, for consistency with the rest of this codebase.
--
-- Safe to re-run — create-if-not-exists / drop-then-create throughout.
-- ─────────────────────────────────────────────────────────────

-- ── 1. submission_activities ─────────────────────────────────

create table if not exists public.submission_activities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  -- Same shape as form_material_conditions' year_level condition:
  -- all_year_levels overrides target_year_levels when true (the UI is
  -- expected to disable the individual checkboxes once "All Year Levels"
  -- is checked, same as the existing condition editor already does).
  all_year_levels boolean not null default false,
  target_year_levels text[] not null default '{}',
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── 2. submission_upload_fields ──────────────────────────────

create table if not exists public.submission_upload_fields (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.submission_activities(id) on delete cascade,
  label text not null,
  is_required boolean not null default true,
  max_files integer not null default 1 check (max_files >= 1 and max_files <= 20),
  -- Staff-controlled ordering (add/remove/reorder fields) — the UI writes
  -- this on every reorder rather than relying on insertion order, which
  -- isn't guaranteed stable across edits/deletes.
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_submission_upload_fields_activity
  on public.submission_upload_fields (activity_id, sort_order);

-- ── 3. RLS ────────────────────────────────────────────────────

alter table public.submission_activities enable row level security;
alter table public.submission_upload_fields enable row level security;

-- Staff: any SEAD staff account can view every activity (visibility/
-- context, matches how form_materials does it), but only the
-- forms_management-tagged accounts can write.
drop policy if exists "staff read" on public.submission_activities;
create policy "staff read" on public.submission_activities
  for select using (public.is_sead_staff());

drop policy if exists "forms_management staff insert" on public.submission_activities;
create policy "forms_management staff insert" on public.submission_activities
  for insert with check (
    exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'forms_management')
  );

drop policy if exists "forms_management staff update" on public.submission_activities;
create policy "forms_management staff update" on public.submission_activities
  for update using (
    exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'forms_management')
  ) with check (
    exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'forms_management')
  );

drop policy if exists "forms_management staff delete" on public.submission_activities;
create policy "forms_management staff delete" on public.submission_activities
  for delete using (
    exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'forms_management')
  );

drop policy if exists "staff read" on public.submission_upload_fields;
create policy "staff read" on public.submission_upload_fields
  for select using (public.is_sead_staff());

drop policy if exists "forms_management staff insert" on public.submission_upload_fields;
create policy "forms_management staff insert" on public.submission_upload_fields
  for insert with check (
    exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'forms_management')
  );

drop policy if exists "forms_management staff update" on public.submission_upload_fields;
create policy "forms_management staff update" on public.submission_upload_fields
  for update using (
    exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'forms_management')
  ) with check (
    exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'forms_management')
  );

drop policy if exists "forms_management staff delete" on public.submission_upload_fields;
create policy "forms_management staff delete" on public.submission_upload_fields
  for delete using (
    exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'forms_management')
  );

-- Scholar: can read an activity only if it applies to their own year
-- level. No scholar write policy at all in Part 1 — there is nothing for
-- a scholar to write to yet (no submissions table exists until Part 2).
drop policy if exists "scholar reads own-year-level activities" on public.submission_activities;
create policy "scholar reads own-year-level activities" on public.submission_activities
  for select using (
    exists (
      select 1 from public.scholars s
      where s.id = auth.uid()
        and (submission_activities.all_year_levels or s.year_level = any(submission_activities.target_year_levels))
    )
  );

drop policy if exists "scholar reads fields for own-year-level activities" on public.submission_upload_fields;
create policy "scholar reads fields for own-year-level activities" on public.submission_upload_fields
  for select using (
    exists (
      select 1 from public.submission_activities sa
      join public.scholars s on s.id = auth.uid()
      where sa.id = submission_upload_fields.activity_id
        and (sa.all_year_levels or s.year_level = any(sa.target_year_levels))
    )
  );
