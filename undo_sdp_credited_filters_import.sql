-- undo_sdp_credited_filters_import.sql: the filters, the export of everything that matches and the import of the Credited Scholars tab go away; the tab goes back to the earlier update.
-- Removes the new functions, the helper type and the index. No credit, scholar or history line is changed or deleted (credits that were imported stay, and their history lines still say "import").
-- (Run this ONLY together with putting the previous version of the website back, because the new website needs these functions.)
begin;

drop function if exists public.sdp_import_save(uuid, jsonb, text, text);
drop function if exists public.sdp_import_check(uuid, jsonb, text, text);
drop function if exists public._sdp_import_eval(uuid, jsonb, text, text);
drop function if exists public.sdp_not_credited_list(uuid, text, jsonb, text, integer, integer);
drop function if exists public.sdp_credited_list(uuid, jsonb, text, text, text, integer, integer);
drop function if exists public.sdp_credited_facets(uuid, text, jsonb, text);
drop function if exists public.sdp_credited_summary_f(uuid, jsonb, text);
drop function if exists public._sdp_ok(public.sdp_list_row, text, jsonb, text, text);
drop function if exists public._sdp_eligible_rows(uuid);
drop function if exists public._sdp_not_credited_rows(uuid);
drop function if exists public._sdp_credit_rows(uuid);
drop function if exists public._sdp_q(text);
drop function if exists public._sdp_f(jsonb, text, text, text);
drop function if exists public._sdp_d(text);
drop function if exists public._sdp_how_of_source(text);
drop function if exists public._sdp_norm(text);
drop type if exists public.sdp_list_row;
drop index if exists public.sdp_credit_history_credit_idx;

notify pgrst, 'reload schema';
commit;
