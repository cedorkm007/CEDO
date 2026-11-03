-- UNDO for supabase_migration_school_grading_rules_c_functions.sql: the functions that check, save and read a school's grading rules are removed.
-- The rules and audit rows already saved stay in the tables of file A (remove them with undo_school_grading_rules_a.sql if you want them gone too). Nothing else is touched.
drop function if exists public.school_grading_rules_save(jsonb, jsonb, text);
drop function if exists public.staff_school_grading_rules_version(uuid);
drop function if exists public.staff_school_grading_rules(uuid);
drop function if exists public.school_grading_rules_version(uuid);
drop function if exists public.school_grading_rules_overview();
drop function if exists public._grading_overview(uuid);
drop function if exists public._grading_version_json(uuid);
drop function if exists public._grading_rules_check(jsonb, numeric, numeric, text, jsonb, text[]);
drop function if exists public._grading_equivalent_value(text, numeric, numeric, jsonb);
drop function if exists public._grading_next_period(text, text);
drop function if exists public._grading_period_rank(text, text);

notify pgrst, 'reload schema';
