-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 8, STEP 1 (run BEFORE the seven files): which database functions on the LIVE project use the scholar tables and run with the CALLER's rights.   READ-ONLY.
--
-- A function marked "runs with the caller's rights" is checked against the table rules for whoever calls it. After Phase 8 a staff member without the right tool
-- would get an empty answer from such a function. Functions that run with the OWNER's rights (the usual kind for this project) are not affected.
-- I need this list because some functions exist only on the live project. Choose "Run without RLS" if asked. Nothing personal is shown: function names only.
-- ─────────────────────────────────────────────────────────────
select p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as inputs,
       case when p.prosecdef then 'owner rights (not affected)' else 'CALLER rights (check me)' end as runs_with,
       (select string_agg(t, ', ' order by t) from unnest(array['scholars', 'scholar_subjects_grades', 'scholar_quest_scores', 'scholar_sdp_category_status', 'attendance_records', 'schools',
                                                              'school_accounts', 'school_grading_configs', 'school_letter_grades', 'grading_period_settings', 'scholar_sdp', 'scholar_services']) as t
         where pg_get_functiondef(p.oid) ~* ('(from|join|update|into|delete from)\s+(public\.)?' || t || '\M')) as tables_used
from pg_proc p
where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
  and exists (select 1 from unnest(array['scholars', 'scholar_subjects_grades', 'scholar_quest_scores', 'scholar_sdp_category_status', 'attendance_records', 'schools', 'school_accounts',
                                         'school_grading_configs', 'school_letter_grades', 'grading_period_settings', 'scholar_sdp', 'scholar_services']) as t
              where pg_get_functiondef(p.oid) ~* ('(from|join|update|into|delete from)\s+(public\.)?' || t || '\M'))
order by p.prosecdef, p.proname;
