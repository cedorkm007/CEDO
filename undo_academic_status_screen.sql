-- undo_academic_status_screen.sql: removes the eight functions of the school screen (Phase 1B). The statuses, the history and the index stay as they are (nothing is deleted); the screen of the previous website version
-- does not use these functions. (Run this ONLY together with putting the previous website version back.)
begin;
drop function if exists public.academic_status_of_scholars(text[]);
drop function if exists public.academic_status_history_school(uuid, integer, integer);
drop function if exists public.academic_status_history_scholar(text);
drop function if exists public.academic_status_apply(uuid, jsonb, text[], text, numeric, boolean, text, integer);
drop function if exists public.academic_status_impact(uuid, jsonb, text[], text, numeric, boolean);
drop function if exists public._academic_check_change(uuid, text, numeric, boolean);
drop function if exists public.academic_school_facets(uuid);
drop function if exists public.academic_school_scholars(uuid, jsonb, text, text, integer, integer);
drop function if exists public._academic_filter_ids(uuid, jsonb, text[]);
notify pgrst, 'reload schema';
commit;
