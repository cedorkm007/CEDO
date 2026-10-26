-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 8, FILE D of 7: who can read and change each scholar's SDP CATEGORY STATUS (table scholar_sdp_category_status, 1,690 rows).
--
-- Today (checked on the live project): this table has the right rule ("SDP staff full access", tag SDP Monitoring) AND a second, broader one ("staff full access":
-- any staff account), and the broader one wins. After this file only the right one is left, plus: Scholar Management, the renewal reviewers and Scholarship Program
-- Information staff may READ. Scholars still read their own (unchanged). The database trigger that keeps this table up to date runs with its own rights and is not
-- affected. Safe to run twice. Undo: undo_sdp_update_p8_d.sql.  Changes ONE table's rules; run it on its own.
-- ─────────────────────────────────────────────────────────────
-- Speed note: every rule below wraps its check in (select …), so the database asks "is this person allowed?" ONCE per request instead of once per row. Without it a page that reads
-- thousands of rows (for example the submissions review list, which reads scholar records) could take seconds and hit the database's 8-second limit.
set lock_timeout = '5s';

alter table public.scholar_sdp_category_status enable row level security;

drop policy if exists "staff full access" on public.scholar_sdp_category_status;
drop policy if exists "p8 other staff read sdp status" on public.scholar_sdp_category_status;

create policy "p8 other staff read sdp status" on public.scholar_sdp_category_status
  for select to authenticated using ((select public.is_sead_staff() or public.can_view_renewals() or public.has_staff_tag('scholarship_program_info')));
