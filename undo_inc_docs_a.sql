-- UNDO for supabase_migration_inc_docs_a_clearance_kind.sql: the list of kinds goes back to study plan / INC letter / prospectus.
-- Clearance files already uploaded are kept (the old rule is put back as "not validated" so it does not refuse them); nothing is deleted.
set lock_timeout = '5s';

alter table public.renewal_documents drop constraint if exists renewal_documents_kind_check;
alter table public.renewal_documents add constraint renewal_documents_kind_check check (kind in ('study_plan', 'inc_letter', 'prospectus')) not valid;

notify pgrst, 'reload schema';
