-- undo_consultation_renewal_cases_paging.sql: the Renewal Cases tab goes back to the earlier way (every open case, with all its documents, in one request) once the website is also put back.
-- Removes the four new read-only functions and the index. No record is changed or deleted; the older function renewal_consult_cases stays.
-- (Run this ONLY together with putting the previous version of the website back, because the new website needs these functions.)
begin;

drop function if exists public.renewal_consult_cases_page(text, text, text, text, integer, integer, uuid);
drop function if exists public.renewal_consult_case_documents(uuid);
drop function if exists public.renewal_consult_case_counts(text, text, text);
drop function if exists public.renewal_consult_case_terms();
drop index if exists public.renewal_records_consult_case_idx;

notify pgrst, 'reload schema';
commit;
