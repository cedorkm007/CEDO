-- ─────────────────────────────────────────────────────────────
-- supabase_migration_formation_positions.sql
--
-- Backs "Scholars' Formation Tools" — a new staff tab (gated by the
-- 'scholars_formation' tag) for tagging scholars with leadership
-- positions across three structures: School-based Organization,
-- Community-based Organization, and the Volunteer Iskolar-Leaders
-- Program (VIP).
--
-- ONE generic table covers all three, rather than a bespoke table per
-- structure — every position (school president, cluster head, barangay
-- chairperson, VIP director, a committee seat, a plain "member" roster
-- entry...) is just a row identifying WHERE it is (org_type + org_key),
-- WHAT it is (role_key + role_label), WHICH slot if the role can repeat
-- (slot_order — e.g. multiple college directors or committee seats), and
-- WHO holds it (scholar_id_number, null = vacant).
--
--   org_type            org_key
--   'school'             the school name (from scholars.school)
--   'community_cluster'  cluster code, 'A'..'H'
--   'community_barangay' the barangay name
--   'vip_top'            '' (just one org-wide top structure)
--   'vip_department'     department key, e.g. 'advocacy_programs', 'members'
--
-- Run this AFTER supabase_migration_staff_tool_tags.sql (reuses the
-- staff_account_tags table). Safe to re-run.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.formation_positions (
  id           uuid primary key default gen_random_uuid(),
  org_type     text not null check (org_type in ('school', 'community_cluster', 'community_barangay', 'vip_top', 'vip_department')),
  org_key      text not null default '',
  role_key     text not null,
  role_label   text not null default '',
  slot_order   int not null default 0,
  scholar_id_number text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (org_type, org_key, role_key, slot_order)
);

create index if not exists idx_formation_positions_org on public.formation_positions (org_type, org_key);
create index if not exists idx_formation_positions_scholar on public.formation_positions (scholar_id_number);

create or replace function public.is_formation_staff()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'scholars_formation'
  );
$$;

alter table public.formation_positions enable row level security;

drop policy if exists "formation staff manage positions" on public.formation_positions;
create policy "formation staff manage positions" on public.formation_positions
  for all using (public.is_formation_staff()) with check (public.is_formation_staff());
