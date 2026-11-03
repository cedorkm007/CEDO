-- ─────────────────────────────────────────────────────────────
-- INC DOCUMENTS, FILE A: the clearance becomes a kind of renewal document.   Safe to run twice.   Undo: undo_inc_docs_a.sql
-- Changes ONE table (renewal_documents): its list of allowed kinds also takes 'clearance'. Nothing is deleted.
-- ─────────────────────────────────────────────────────────────
set lock_timeout = '5s';

alter table public.renewal_documents drop constraint if exists renewal_documents_kind_check;
alter table public.renewal_documents add constraint renewal_documents_kind_check check (kind in ('study_plan', 'inc_letter', 'prospectus', 'clearance'));

notify pgrst, 'reload schema';
