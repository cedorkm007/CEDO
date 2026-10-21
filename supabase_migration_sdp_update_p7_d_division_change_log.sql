-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 7, FILE D of 4: the staff division change history (table division_change_log) can only grow, and only it.admin1 adds to it.
--
-- Today (checked on the live project): any staff account can edit, add or delete lines. After this file: staff can read it, it.admin1 can add a line
-- (the Staff Accounts page does this when a division is changed, with its own account as "changed by"), and nobody can edit or delete a line through the
-- website. Safe to run twice. Undo: undo_sdp_update_p7_d.sql.  Changes ONE table's rules only; run it on its own.
-- ─────────────────────────────────────────────────────────────
set lock_timeout = '5s';

alter table public.division_change_log enable row level security;

drop policy if exists "staff full access" on public.division_change_log;
drop policy if exists "p7 staff read division log" on public.division_change_log;
drop policy if exists "p7 it admin adds division log" on public.division_change_log;

create policy "p7 staff read division log" on public.division_change_log
  for select to authenticated using (public.is_cedo_staff());

create policy "p7 it admin adds division log" on public.division_change_log
  for insert to authenticated with check (public.is_it_admin() and changed_by = auth.uid());
