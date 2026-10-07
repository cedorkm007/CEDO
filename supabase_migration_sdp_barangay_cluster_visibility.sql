-- ─────────────────────────────────────────────────────────────
-- supabase_migration_sdp_barangay_cluster_visibility.sql
--
-- SDP activities can now be limited to scholars living in particular
-- barangays and/or clusters, on top of the existing year-level limit
-- (supabase_migration_sdp_eligibility.sql).
--
--   target_barangays  barangay names, exactly as stored on scholars.barangay
--   target_clusters   cluster codes 'A'..'H'
--
-- RULES
--   * Both empty                    -> visible to every scholar (today's
--                                      behavior; every existing row keeps it).
--   * Either (or both) filled       -> a scholar sees the activity if their
--                                      barangay is one of the checked
--                                      barangays, OR their barangay belongs
--                                      to one of the checked clusters.
--   * Year level still applies too  -> barangay/cluster is an additional
--                                      AND, never a replacement.
--   * A scholar with no barangay on file can't be matched, so a restricted
--     activity is hidden from them (6 of ~7,100 scholars at the time of
--     writing). Unrestricted activities are unaffected.
--
-- ENFORCEMENT is the scholar read policy on sdp_activities (the only
-- policy that lets a scholar read these rows), so this is a real
-- database-level restriction, not just a hidden list in the UI.
--
-- The barangay -> cluster mapping below MUST match CLUSTER_OF in
-- src/lib/cdoBarangays.ts (that file is what the staff forms and the
-- scholar address field use). Barangay 1-40 are all Cluster G there.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

alter table public.sdp_activities add column if not exists target_barangays text[] not null default '{}';
alter table public.sdp_activities add column if not exists target_clusters  text[] not null default '{}';

alter table public.sdp_activities drop constraint if exists sdp_activities_target_clusters_check;
alter table public.sdp_activities add constraint sdp_activities_target_clusters_check
  check (target_clusters <@ array['A','B','C','D','E','F','G','H']);

create or replace function public.cdo_cluster_of_barangay(p_barangay text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when n in ('bugo', 'puerto', 'agusan', 'balubal', 'tablon') then 'A'
    when n in ('lumbia', 'canito-an', 'pagatpat', 'san simon', 'baikingon') then 'B'
    when n in ('dansolihon', 'tignapoloan', 'besigan', 'mambuaya', 'bayanga') then 'C'
    when n in ('indahag', 'balulang', 'macasandig', 'nazareth', 'camaman-an') then 'D'
    when n in ('bonbon', 'bayabas', 'kauswagan', 'bulua', 'iponan') then 'E'
    when n in ('f. s. catanico', 'gusa', 'lapasan', 'cugman', 'macabalan') then 'F'
    when n in ('carmen', 'patag', 'puntod', 'consolacion', 'calaanan') then 'G'
    when n in ('taglimao', 'tuburan', 'pigsag-an', 'tumpagon', 'pagalungan', 'tagpangi') then 'H'
    when n ~ '^barangay ([1-9]|[1-3][0-9]|40)$' then 'G'
    else null
  end
  from (select lower(trim(coalesce(p_barangay, ''))) as n) x;
$$;

create or replace function public.sdp_activity_visible_to_barangay(p_barangays text[], p_clusters text[], p_scholar_barangay text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select
    (coalesce(cardinality(p_barangays), 0) = 0 and coalesce(cardinality(p_clusters), 0) = 0)
    or (
      nullif(trim(coalesce(p_scholar_barangay, '')), '') is not null
      and (
        exists (select 1 from unnest(p_barangays) b where lower(trim(b)) = lower(trim(p_scholar_barangay)))
        or public.cdo_cluster_of_barangay(p_scholar_barangay) = any(p_clusters)
      )
    );
$$;

-- Same policy as supabase_migration_sdp_eligibility.sql, plus the
-- barangay/cluster clause. The year-level clause is unchanged.
drop policy if exists "scholar reads open activities" on public.sdp_activities;
create policy "scholar reads open activities" on public.sdp_activities for select
  using (
    submitted_by_scholar_id is null
    and (
      all_year_levels or exists (
        select 1 from public.scholars
        where scholars.id = auth.uid() and scholars.year_level = any(sdp_activities.target_year_levels)
      )
    )
    and (
      (cardinality(target_barangays) = 0 and cardinality(target_clusters) = 0)
      or exists (
        select 1 from public.scholars s
        where s.id = auth.uid()
          and public.sdp_activity_visible_to_barangay(sdp_activities.target_barangays, sdp_activities.target_clusters, s.barangay)
      )
    )
  );
