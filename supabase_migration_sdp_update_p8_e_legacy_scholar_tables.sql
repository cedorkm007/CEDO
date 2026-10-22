-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 8, FILE E of 7: two old, EMPTY scholar tables (scholar_sdp and scholar_services, 0 rows each on the live project).
--
-- Today: any staff account can read and change them. After this file: only Scholar Management staff can (scholars still read their own, unchanged).
-- The tables are empty and nothing on the website writes to them, so nothing visible changes; this only closes the door. Safe to run twice.
-- Undo: undo_sdp_update_p8_e.sql.  Changes two EMPTY tables' rules; run it on its own.
-- ─────────────────────────────────────────────────────────────
set lock_timeout = '5s';

alter table public.scholar_sdp enable row level security;
drop policy if exists "staff full access" on public.scholar_sdp;
drop policy if exists "p8 scholar management manages scholar_sdp" on public.scholar_sdp;
create policy "p8 scholar management manages scholar_sdp" on public.scholar_sdp
  for all to authenticated using (public.is_sead_staff()) with check (public.is_sead_staff());

alter table public.scholar_services enable row level security;
drop policy if exists "staff full access" on public.scholar_services;
drop policy if exists "p8 scholar management manages scholar_services" on public.scholar_services;
create policy "p8 scholar management manages scholar_services" on public.scholar_services
  for all to authenticated using (public.is_sead_staff()) with check (public.is_sead_staff());
