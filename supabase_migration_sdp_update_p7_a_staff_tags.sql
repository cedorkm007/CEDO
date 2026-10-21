-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 7, FILE A of 4: only the IT administrator can change WHO HAS WHICH TOOL (table staff_account_tags).
--
-- Today (checked on the live project): any staff account can add or remove rows here, so a staff member with no tools could give themselves
-- "SDP Monitoring", "Scholar Management" and so on, and open everything those tools unlock. After this file: every staff member can still READ the tags
-- (the website needs your own tags, and the Staff Accounts page lists everyone's), but only it.admin1 can add, change or remove them.
-- Nothing else changes. The server functions (service key) are not affected. Safe to run twice. Undo: undo_sdp_update_p7_a.sql
-- Changes ONE table's rules only; run it on its own.
-- ─────────────────────────────────────────────────────────────
set lock_timeout = '5s';

alter table public.staff_account_tags enable row level security;

drop policy if exists "staff full access" on public.staff_account_tags;
drop policy if exists "p7 staff read tags" on public.staff_account_tags;
drop policy if exists "p7 it admin changes tags" on public.staff_account_tags;

create policy "p7 staff read tags" on public.staff_account_tags
  for select to authenticated using (public.is_cedo_staff());

create policy "p7 it admin changes tags" on public.staff_account_tags
  for all to authenticated using (public.is_it_admin()) with check (public.is_it_admin());
