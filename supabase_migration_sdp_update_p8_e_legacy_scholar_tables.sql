-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 8, FILE E of 7: two old, EMPTY scholar tables (scholar_sdp and scholar_services, 0 rows each on the live project).
--
-- Today: any staff account can read and change them. After this file: only Scholar Management staff can (scholars still read their own, unchanged).
-- The tables are empty and nothing on the website writes to them, so nothing visible changes; this only closes the door. Safe to run twice.
-- Undo: undo_sdp_update_p8_e.sql.  Changes two EMPTY tables' rules; run it on its own.
-- ─────────────────────────────────────────────────────────────
-- Speed note: every rule below wraps its check in (select …), so the database asks "is this person allowed?" ONCE per request instead of once per row. Without it a page that reads
-- thousands of rows (for example the submissions review list, which reads scholar records) could take seconds and hit the database's 8-second limit.
set lock_timeout = '5s';

alter table public.scholar_sdp enable row level security;
drop policy if exists "staff full access" on public.scholar_sdp;
drop policy if exists "p8 scholar management manages scholar_sdp" on public.scholar_sdp;
create policy "p8 scholar management manages scholar_sdp" on public.scholar_sdp
  for all to authenticated using ((select public.is_sead_staff())) with check ((select public.is_sead_staff()));

alter table public.scholar_services enable row level security;
drop policy if exists "staff full access" on public.scholar_services;
drop policy if exists "p8 scholar management manages scholar_services" on public.scholar_services;
create policy "p8 scholar management manages scholar_services" on public.scholar_services
  for all to authenticated using ((select public.is_sead_staff())) with check ((select public.is_sead_staff()));
