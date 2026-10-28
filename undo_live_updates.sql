-- UNDO for supabase_migration_live_updates.sql: removes the three "has anything changed" functions and their two helpers. The portals then simply stop updating by themselves
-- (they keep working; people refresh the page as before). Nothing else is touched.
drop function if exists public.school_live_stamp();
drop function if exists public.staff_live_stamp();
drop function if exists public.scholar_live_stamp();
drop function if exists public._live_can(text);
drop function if exists public._live_part(text, text);
notify pgrst, 'reload schema';
