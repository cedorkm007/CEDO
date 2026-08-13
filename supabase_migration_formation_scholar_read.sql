-- ─────────────────────────────────────────────────────────────
-- supabase_migration_formation_scholar_read.sql
--
-- Lets a scholar read their OWN rows in formation_positions (nothing about
-- anyone else) — backs showing their leadership position(s), if any, on
-- their profile card in the scholar portal.
--
-- Run this AFTER supabase_migration_formation_positions.sql. Safe to re-run.
-- ─────────────────────────────────────────────────────────────

drop policy if exists "scholar reads own positions" on public.formation_positions;
create policy "scholar reads own positions" on public.formation_positions
  for select using (
    scholar_id_number = (select scholar_id_number from public.scholars where id = auth.uid())
  );
