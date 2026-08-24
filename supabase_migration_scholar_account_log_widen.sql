-- ─────────────────────────────────────────────────────────────
-- supabase_migration_scholar_account_log_widen.sql
--
-- Fixes "Account History displays nothing" (Scholar Management Tools →
-- History). Root cause: the frontend (ScholarAccountHistoryTab.tsx) and
-- its TypeScript type already expect action values 'reset'/'updated' and
-- a description column, and two Edge Functions
-- (sead-reset-scholar-password, sead-reset-all-scholar-passwords) already
-- call logScholarChange() with action: "reset" + a description — but
-- public.sead_scholar_account_log itself was never migrated to match:
-- its action check constraint still only allowed 'added'/'removed', and
-- it had no description column at all. The frontend's query selects a
-- nonexistent column, fails, and the existing error handling silently
-- returns an empty result rather than surfacing the failure — which is
-- exactly what "displays nothing" looks like from the outside.
--
-- Note on 'updated': the schema is widened to allow it for forward
-- compatibility, but no code path in this codebase currently logs an
-- 'updated' entry — there is no scholar-profile-editing feature yet.
-- That filter will correctly show zero results until such a feature is
-- built; this is not a bug on its own.
-- ─────────────────────────────────────────────────────────────

alter table public.sead_scholar_account_log
  drop constraint if exists sead_scholar_account_log_action_check;

alter table public.sead_scholar_account_log
  add constraint sead_scholar_account_log_action_check
  check (action in ('added', 'removed', 'reset', 'updated'));

alter table public.sead_scholar_account_log
  add column if not exists description text;
