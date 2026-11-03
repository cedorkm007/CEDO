-- UNDO for supabase_migration_renewal_tabs.sql: the lists of Applications, Renewed and Not applied lose the functions they read from. Nothing is deleted from a table.

drop function if exists public.renewal_tab_options(text, text);
drop function if exists public.renewal_tab_counts(text, text, text, text, uuid[], text[], text[], text[], text, text);
drop function if exists public.renewal_tab_list(text, text, text, text, text, uuid[], text[], text[], text[], text, text, integer, integer);
drop function if exists public._renewal_tab_rows(text, text, text, text, uuid[], text[], text[], text[], text, text);

notify pgrst, 'reload schema';
