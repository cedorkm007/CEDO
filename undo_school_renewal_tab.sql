-- UNDO for supabase_migration_school_renewal_tab.sql: the three functions the School Portal's Renewal tab reads are removed. Nothing else is touched.
drop function if exists public.school_renewal_summary(text, text);
drop function if exists public.school_renewal_list(text, text);
drop function if exists public._school_renewal_rows(text, text);
drop function if exists public.school_renewal_windows();

notify pgrst, 'reload schema';
