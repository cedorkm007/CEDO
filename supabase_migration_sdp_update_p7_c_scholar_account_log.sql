-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 7, FILE C of 4: the scholar account history (table sead_scholar_account_log) can only grow.
--
-- Today (checked on the live project): any staff account can edit or delete lines of this history (it holds about 24,000 lines: who added, reset, removed
-- or changed a scholar). After this file: staff can still read it and add lines (the website writes a line for each change, with their own account as
-- "performed by"), but nobody can edit or delete a line through the website. The server functions (service key), which write most lines and mark
-- an undone bulk upload, are not affected. Safe to run twice. Undo: undo_sdp_update_p7_c.sql.  Changes ONE table's rules only; run it on its own.
-- ─────────────────────────────────────────────────────────────
set lock_timeout = '5s';

alter table public.sead_scholar_account_log enable row level security;

drop policy if exists "staff full access" on public.sead_scholar_account_log;
drop policy if exists "p7 staff read account log" on public.sead_scholar_account_log;
drop policy if exists "p7 staff add account log" on public.sead_scholar_account_log;

create policy "p7 staff read account log" on public.sead_scholar_account_log
  for select to authenticated using (public.is_cedo_staff());

create policy "p7 staff add account log" on public.sead_scholar_account_log
  for insert to authenticated with check (public.is_cedo_staff() and performed_by = auth.uid());
