-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 7, FILE E (optional): makes "Undo upload" work for scholar bulk uploads.
--
-- The function behind "Undo upload" marks each undone line of the scholar account history with undone = true and skips lines already undone, but the live table
-- (sead_scholar_account_log) has no "undone" column, so the function stops with an error. This adds the column (yes/no, "no" for every existing line).
-- It changes no existing value and does not rewrite the 24,000 lines (adding a column with a fixed default is instant). Safe to run twice.
-- Undo: undo_sdp_update_p7_e.sql.  Changes ONE table (adds one column); run it on its own, after file C.
-- ─────────────────────────────────────────────────────────────
set lock_timeout = '5s';

alter table public.sead_scholar_account_log add column if not exists undone boolean not null default false;
