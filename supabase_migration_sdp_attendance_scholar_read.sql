-- ─────────────────────────────────────────────────────────────
-- supabase_migration_sdp_attendance_scholar_read.sql
--
-- sdp_attendance had exactly one RLS policy — "sdp staff full access"
-- (has_staff_tag('sdp_monitoring')) — meaning scholars could never read
-- their own credited attendance at all. Confirmed by reading pg_policy
-- directly: no scholar-facing policy existed. This went unnoticed
-- because the only two callers of a query shaped this way
-- (fetchScholarSDPHistory's staff-side consumers, ScholarListPanel.tsx
-- and SDPHistoryModal.tsx) both run as staff. The new scholar-facing
-- fetchScholarSDPCreditCounts() is the first scholar-session caller,
-- which is what surfaced this — it silently returned an empty list
-- instead of erroring, because RLS denial looks like "no rows" rather
-- than an access error.
--
-- Mirrors the exact idiom already used for the same purpose on
-- attendance_records ("scholar reads own attendance").
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

drop policy if exists "scholar reads own sdp attendance" on public.sdp_attendance;
create policy "scholar reads own sdp attendance" on public.sdp_attendance
  for select using (
    scholar_id_number in (select s.scholar_id_number from public.scholars s where s.id = auth.uid())
  );
