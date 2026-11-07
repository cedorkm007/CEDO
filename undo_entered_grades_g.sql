-- Undo of supabase_migration_entered_grades_g_revert.sql: removes the revert function. Grades that were already reverted stay "waiting for approval" (the Grades Approver can approve them again).
drop function if exists public.renewal_self_grades_revert(uuid, text);
notify pgrst, 'reload schema';
