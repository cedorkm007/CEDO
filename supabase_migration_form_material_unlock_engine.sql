-- ─────────────────────────────────────────────────────────────
-- supabase_migration_form_material_unlock_engine.sql
--
-- Scholar-side condition-evaluation engine for form_materials. Depends on
-- form_materials / form_material_conditions already existing in your
-- database (created by whatever migration you originally ran for the
-- Forms Management tool — those files aren't in this repo copy, so this
-- migration only ALTERs/ADDs, never CREATE TABLEs those two).
--
-- What this does:
--   1. Adds a 5th condition type — "course" (exact match against
--      scholars.course, case/whitespace-insensitive) — alongside the
--      existing quest_subject / formation_activity / sdp_activity /
--      year_level types.
--   2. Adds public.is_form_condition_met(condition_id) — evaluates ONE
--      condition row for the signed-in scholar.
--   3. Adds public.is_form_material_unlocked(material_id) — a material is
--      unlocked only if EVERY one of its non-year_level conditions is met
--      (cumulative AND, not "any one"). A material with zero conditions
--      is unlocked for everyone.
--   4. Adds public.get_my_form_materials() — the RPC the scholar portal
--      calls. Returns every material APPLICABLE to the scholar's year
--      level (i.e. no year_level condition, or the scholar's year level
--      is in it) together with is_unlocked and, for locked materials,
--      which specific conditions are still unmet. A material whose
--      year_level condition excludes this scholar is not returned at all.
--      Locked materials come back with url/file_name blanked out — the
--      PDF filename and the flipbook link are themselves gated, not just
--      the "download" button. Also returns quest_subject_ids — every
--      subject a material has a quest_subject condition on, met or not —
--      so the scholar portal can tell "unlocked AND linked to subject X"
--      apart from "the scholar merely passed subject X" (see
--      QuestsPanel.tsx's "You passed! Check your unlocked Forms" button).
--   5. Updates the "form-materials" storage bucket policy so a scholar can
--      only download a PDF that is_form_material_unlocked() for them —
--      table/RPC visibility alone doesn't grant file access, the file
--      itself is gated the same way scholar_subject_progress already
--      gates subject-certificates (supabase_migration_subject_passing_rate.sql).
--   6. Replaces whatever staff INSERT/UPDATE/DELETE policies currently
--      exist on form_materials / form_material_conditions with ones that
--      require the "forms_management" staff_account_tags tag specifically
--      — not just is_sead_staff() — so the tag is a real security
--      boundary, not just a UI nav gate. Staff SELECT stays open to any
--      is_sead_staff() account (unchanged), matching how every other
--      staff-tool table in this codebase separates "any SEAD staff can
--      look" from "only the specifically-tagged tool can write".
--
-- Run this in the Supabase SQL Editor. Safe to re-run — every statement
-- uses IF EXISTS / IF NOT EXISTS / CREATE OR REPLACE (except
-- get_my_form_materials(), which uses DROP FUNCTION IF EXISTS + CREATE,
-- since changing a table-returning function's columns needs a drop first —
-- CREATE OR REPLACE alone errors on a changed return type; the drop-then-
-- create pair is just as safe to re-run), and the three DO
-- blocks that touch existing constraints/policies look them up by
-- catalog inspection rather than a hardcoded name, since this repo copy
-- doesn't have the original migration to know those names for certain.
-- ─────────────────────────────────────────────────────────────

-- ── 0. Defensive column guarantees ──────────────────────────
-- This repo copy doesn't have the original form_materials-creating
-- migration, so its exact column set is unknown. formsManagementApi.ts /
-- formsApi.ts already assume title, kind, url, description, file_name —
-- add-if-missing rather than guessing why one might be absent (e.g. an
-- earlier partial deploy). No-ops if a column already exists.

alter table public.form_materials add column if not exists title text not null default '';
alter table public.form_materials add column if not exists kind text not null default 'pdf';
alter table public.form_materials add column if not exists url text not null default '';
alter table public.form_materials add column if not exists description text not null default '';
alter table public.form_materials add column if not exists file_name text not null default '';
alter table public.form_materials add column if not exists created_by uuid references public.users(id);
alter table public.form_materials add column if not exists created_at timestamptz not null default now();
alter table public.form_materials add column if not exists updated_at timestamptz not null default now();

-- ── 1. "course" condition type ──────────────────────────────

alter table public.form_material_conditions add column if not exists course text;

-- The original Forms schema makes this column NOT NULL. Its value is only
-- meaningful for year-level rules, but a default protects inserts of all
-- other condition types as well.
alter table public.form_material_conditions
  alter column target_year_levels set default '{}'::text[];

-- Find and drop any existing CHECK constraint that mentions condition_type
-- (whatever it happens to be named in your database), then re-add one that
-- allows all five types. If your database has no such constraint at all,
-- the loop below simply does nothing and the ADD CONSTRAINT still runs.
do $$
declare
  con record;
begin
  for con in
    select conname
    from pg_constraint
    where conrelid = 'public.form_material_conditions'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%condition_type%'
  loop
    execute format('alter table public.form_material_conditions drop constraint %I', con.conname);
  end loop;
end $$;

alter table public.form_material_conditions
  add constraint form_material_conditions_type_check
  check (condition_type in ('quest_subject', 'formation_activity', 'sdp_activity', 'year_level', 'course'));

-- A material can require several conditions (for example, two Quest subjects
-- and a Formation Activity). Remove legacy uniqueness rules that allow only
-- one condition per material or one condition per type; the application still
-- prevents duplicate selections of the same requirement.
do $$
declare
  con record;
  normalized_definition text;
begin
  for con in
    select conname, pg_get_constraintdef(oid) as definition
    from pg_constraint
    where conrelid = 'public.form_material_conditions'::regclass
      and contype = 'u'
  loop
    normalized_definition := regexp_replace(lower(con.definition), '\s+', '', 'g');
    if normalized_definition like 'unique(material_id)%'
       or normalized_definition like 'unique(material_id,condition_type)%' then
      execute format('alter table public.form_material_conditions drop constraint %I', con.conname);
    end if;
  end loop;
end $$;

create index if not exists form_material_conditions_material_id_idx
  on public.form_material_conditions (material_id);

-- ── 2. Per-condition evaluator ──────────────────────────────
-- Evaluates ONE condition row against the signed-in scholar. Reused by
-- both is_form_material_unlocked() (material-level AND) and
-- get_my_form_materials() (to report which specific conditions are unmet).

create or replace function public.is_form_condition_met(p_condition_id uuid)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_scholar public.scholars%rowtype;
  v_cond public.form_material_conditions%rowtype;
begin
  select * into v_scholar from public.scholars where id = auth.uid();
  if not found then
    return false; -- not signed in as a scholar
  end if;

  select * into v_cond from public.form_material_conditions where id = p_condition_id;
  if not found then
    return true; -- condition row is gone — nothing left to fail on
  end if;

  return case v_cond.condition_type
    when 'quest_subject' then exists (
      select 1
      from public.scholar_subject_progress p
      join public.quest_subjects qs on qs.id = v_cond.subject_id
      where p.subject_id = v_cond.subject_id
        and p.scholar_id_number = v_scholar.scholar_id_number
        and p.subject_percentage >= qs.passing_rate_min
        and p.subject_percentage <= qs.passing_rate_max
    )
    when 'formation_activity' then exists (
      select 1 from public.my_completed_activity_attendance() a
      where a.formation_activity_id = v_cond.formation_activity_id
    )
    when 'sdp_activity' then exists (
      select 1 from public.my_completed_activity_attendance() a
      where a.sdp_activity_id = v_cond.sdp_activity_id
    )
    when 'course' then
      v_cond.course is not null and trim(v_cond.course) <> ''
      and lower(trim(v_scholar.course)) = lower(trim(v_cond.course))
    when 'year_level' then
      v_cond.all_year_levels or v_scholar.year_level = any(v_cond.target_year_levels)
    else false
  end;
end;
$$;

grant execute on function public.is_form_condition_met(uuid) to authenticated;

-- ── 3. Per-material unlock evaluator ────────────────────────
-- Cumulative AND across every non-year_level condition. year_level is
-- deliberately excluded here — it's handled as "applicable at all" in
-- get_my_form_materials() and the storage policy, not as an unlock gate.

create or replace function public.is_form_material_unlocked(p_material_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select not exists (
    select 1
    from public.form_material_conditions c
    where c.material_id = p_material_id
      and c.condition_type <> 'year_level'
      and not public.is_form_condition_met(c.id)
  );
$$;

grant execute on function public.is_form_material_unlocked(uuid) to authenticated;

-- ── 4. Scholar-facing RPC ────────────────────────────────────

-- Changing a "returns table (...)" function's columns requires a drop
-- first — CREATE OR REPLACE alone errors on a changed return type.
drop function if exists public.get_my_form_materials();

create function public.get_my_form_materials()
returns table (
  id uuid,
  title text,
  kind text,
  url text,
  description text,
  file_name text,
  is_unlocked boolean,
  unmet_requirements jsonb,
  quest_subject_ids uuid[]
)
language sql
security definer
stable
set search_path = public
as $$
  with me as (
    select * from public.scholars where id = auth.uid()
  )
  select
    m.id,
    m.title,
    m.kind,
    case when public.is_form_material_unlocked(m.id) then m.url else '' end as url,
    m.description,
    case when public.is_form_material_unlocked(m.id) then m.file_name else '' end as file_name,
    public.is_form_material_unlocked(m.id) as is_unlocked,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'type', c.condition_type,
          'label', case
            when c.condition_type = 'quest_subject' then
              coalesce(qs.name, 'Quest subject') || ' (' || qs.passing_rate_min::text || '%–' || qs.passing_rate_max::text || '% required)'
            else coalesce(qs.name, fa.name, sa.name, c.course, '')
          end
        )
        order by c.condition_type
      )
      from public.form_material_conditions c
      left join public.quest_subjects qs on qs.id = c.subject_id
      left join public.formation_activities fa on fa.id = c.formation_activity_id
      left join public.sdp_activities sa on sa.id = c.sdp_activity_id
      where c.material_id = m.id
        and c.condition_type <> 'year_level'
        and not public.is_form_condition_met(c.id)
    ), '[]'::jsonb) as unmet_requirements,
    -- Every quest_subject this material has a condition on — met or not,
    -- unlike unmet_requirements above. This is how the scholar portal's
    -- "You passed! Check your unlocked Forms" button (QuestsPanel.tsx)
    -- knows a material is actually LINKED to a given subject, rather than
    -- just guessing from "the scholar passed something" — it only shows
    -- the button when a material in this array for the current subject is
    -- also is_unlocked. Not a security-sensitive value: subject names/ids
    -- are already visible elsewhere in the scholar portal (Quests tab).
    coalesce((
      select array_agg(c.subject_id)
      from public.form_material_conditions c
      where c.material_id = m.id
        and c.condition_type = 'quest_subject'
        and c.subject_id is not null
    ), array[]::uuid[]) as quest_subject_ids
  from public.form_materials m
  cross join me
  where me.id is not null
    and not exists (
      select 1
      from public.form_material_conditions c
      where c.material_id = m.id
        and c.condition_type = 'year_level'
        and not public.is_form_condition_met(c.id)
    )
  order by m.title;
$$;

grant execute on function public.get_my_form_materials() to authenticated;

-- ── 5. Storage: gate the actual PDF bytes, not just table visibility ──
-- Drop the old "unconditioned materials only" policy (whatever it's
-- actually named in your database — the migration that created it isn't
-- in this repo copy) and any earlier attempt at this same policy name,
-- then install one keyed off is_form_material_unlocked().

do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (coalesce(qual, '') ilike '%form-materials%' or coalesce(with_check, '') ilike '%form-materials%')
  loop
    execute format('drop policy %I on storage.objects', pol.policyname);
  end loop;
end $$;

create policy "scholar downloads unlocked form material" on storage.objects
  for select using (
    bucket_id = 'form-materials'
    and exists (select 1 from public.scholars where id = auth.uid())
    and public.is_form_material_unlocked(split_part(storage.objects.name, '/', 1)::uuid)
    and not exists (
      select 1
      from public.form_material_conditions c
      where c.material_id = split_part(storage.objects.name, '/', 1)::uuid
        and c.condition_type = 'year_level'
        and not public.is_form_condition_met(c.id)
    )
  );

-- Staff (forms_management-tagged, see step 6 below) still needs to manage
-- files regardless of scholar-side unlock state — keep that separate.
drop policy if exists "staff manage form materials" on storage.objects;
create policy "staff manage form materials" on storage.objects
  for all using (
    bucket_id = 'form-materials'
    and exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'forms_management')
  )
  with check (
    bucket_id = 'form-materials'
    and exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'forms_management')
  );

-- ── 6. Tighten staff writes to the forms_management tag specifically ──
-- Table-level RLS is the real boundary the UI nav gate was only ever a
-- stand-in for. Drop whatever non-SELECT policies already exist on these
-- two tables (found by catalog lookup, not a hardcoded name) and replace
-- them with ones scoped to forms_management. SELECT is left untouched for
-- any is_sead_staff() account, matching every other staff tool table in
-- this codebase (broad staff read, tag-gated write).

alter table public.form_materials enable row level security;
alter table public.form_material_conditions enable row level security;

do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'form_materials' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  loop
    execute format('drop policy %I on public.form_materials', pol.policyname);
  end loop;
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'form_material_conditions' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  loop
    execute format('drop policy %I on public.form_material_conditions', pol.policyname);
  end loop;
end $$;

-- Re-assert staff read (in case a dropped policy above was a combined
-- "for all" one that also covered SELECT) — any SEAD staff can still see
-- the Forms Management list, matching the existing read pattern elsewhere.
drop policy if exists "staff read form materials" on public.form_materials;
create policy "staff read form materials" on public.form_materials
  for select using (public.is_sead_staff());

drop policy if exists "staff read form material conditions" on public.form_material_conditions;
create policy "staff read form material conditions" on public.form_material_conditions
  for select using (public.is_sead_staff());

drop policy if exists "forms management staff write" on public.form_materials;
create policy "forms management staff write" on public.form_materials
  for insert with check (
    exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'forms_management')
  );
drop policy if exists "forms management staff update" on public.form_materials;
create policy "forms management staff update" on public.form_materials
  for update using (
    exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'forms_management')
  ) with check (
    exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'forms_management')
  );
drop policy if exists "forms management staff delete" on public.form_materials;
create policy "forms management staff delete" on public.form_materials
  for delete using (
    exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'forms_management')
  );

drop policy if exists "forms management staff write conditions" on public.form_material_conditions;
create policy "forms management staff write conditions" on public.form_material_conditions
  for insert with check (
    exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'forms_management')
  );
drop policy if exists "forms management staff update conditions" on public.form_material_conditions;
create policy "forms management staff update conditions" on public.form_material_conditions
  for update using (
    exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'forms_management')
  ) with check (
    exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'forms_management')
  );
drop policy if exists "forms management staff delete conditions" on public.form_material_conditions;
create policy "forms management staff delete conditions" on public.form_material_conditions
  for delete using (
    exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'forms_management')
  );

-- ── Also required (unchanged from whenever Forms Management was first
-- deployed): scholars need read access to form_materials at the table
-- level too, since get_my_form_materials() re-derives everything from
-- auth.uid() but a scholar's client-side Supabase call to the RPC still
-- needs `authenticated` execute rights (already granted above) — no table
-- SELECT grant to scholars is required beyond that, since the RPC is
-- security definer and reads the tables as its owner, not as the caller.
