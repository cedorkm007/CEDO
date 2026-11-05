-- Undo of supabase_migration_renewal_revert_application.sql: removes the "Revert application" functions and the revert log.
-- Applications that were already reverted stay reverted (this does not bring them back).
drop function if exists public.renewal_revert_application(uuid, text);
drop function if exists public._renewal_revert_record(uuid, text, uuid, text, boolean);
drop policy if exists "renewal staff read the revert log" on public.renewal_reverts;
drop table if exists public.renewal_reverts;
