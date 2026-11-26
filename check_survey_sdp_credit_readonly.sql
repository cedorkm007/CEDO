-- check_survey_sdp_credit_readonly.sql
-- READ ONLY: it only looks. It changes nothing, so there is nothing to undo.
-- Run supabase_migration_survey_credit_fix.sql first, then paste this whole file into the Supabase SQL Editor and press Run.
--
-- First row  : is the bug fixed, and how many credits are missing.
-- Other rows : one line for each missing credit.
--     "WILL RESTORE"     -> restore_survey_sdp_credits.sql would add exactly this credit.
--     "NOT restored: …"  -> left alone, with the reason. Decide these by hand.
-- Check the "semester" column, especially lines marked NOT CERTAIN.

with plan as (select * from public._survey_restore_plan()),
verdict as (
  select case when position('_finalize_survey_gated_attendance' in pg_get_functiondef('public.submit_survey_response(uuid)'::regprocedure)) > 0
              then 'FIXED: finishing a survey gives the SDP credit' else 'PROBLEM: finishing a survey does NOT give the SDP credit' end as result
)
select 0 as row_order,
       v.result as action,
       (select count(*) from plan where action = 'WILL RESTORE')::text || ' credit(s) to restore, ' || (select count(distinct scholar_id_number) from plan where action = 'WILL RESTORE')::text || ' scholar(s); '
         || (select count(*) from plan where action <> 'WILL RESTORE')::text || ' left out' as scholar_id_number,
       null::text as scholar_name, null::text as activity, null::date as date_of_scan, null::date as survey_finished_on, null::text as school_year, null::text as semester, null::text as how_the_semester_was_found
from verdict v
union all
select 1, action, scholar_id_number, scholar_name, activity_name, scan_date, finished_on, school_year, semester, semester_basis from plan
order by row_order, action desc, activity, scholar_name, date_of_scan;
