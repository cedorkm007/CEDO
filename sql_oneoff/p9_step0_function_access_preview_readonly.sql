-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 9, STEP 0: PREVIEW which database functions would be closed to visitors (and which internal helpers to signed-in people too).   READ-ONLY: changes nothing.
--
-- Why: by default Supabase lets ANYONE with the public website key (a visitor who is not signed in) run almost every function in the public area. Most functions
-- check who is calling, but a few helpers (the SDP credit totals, a scholar's quiz percentage…) hand out data when given a Scholar ID. Phase 9 closes the door
-- on every function a visitor does not need.
--
-- A function is KEPT OPEN to visitors only when: (a) a visitor page really calls it (sign-in look-ups, the school password request, the scholar emergency page,
-- the audience page of a live presentation, the financial-assistance status page, the public survey page); or (b) a table rule uses it (closing it could turn an empty answer into an
-- error); or (c) it is a trigger, or belongs to an extension. Everything else is listed as CLOSE.
-- Internal helpers whose name starts with an underscore are also closed to signed-in people (the database calls them itself, the website never does).
-- Choose "Run without RLS" if asked. Nothing personal is shown. Send me the result (Export as CSV, or copy the rows).
-- ─────────────────────────────────────────────────────────────
with fn as (
  select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as definer,
         has_function_privilege('anon', p.oid, 'execute') as anon_exec,
         has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
         (p.prorettype = 'trigger'::regtype) as is_trigger,
         exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') as in_extension,
         exists (select 1 from pg_policies pol
                 where coalesce(pol.qual, '') || ' ' || coalesce(pol.with_check, '') ~ ('\m' || p.proname || '\('))
         -- also: used by a table definition (a default value, a check, an index, a view): closing it could stop a save
         or exists (select 1 from pg_depend d where d.refclassid = 'pg_proc'::regclass and d.refobjid = p.oid and d.deptype in ('n', 'a')
                    and d.classid in ('pg_attrdef'::regclass, 'pg_constraint'::regclass, 'pg_rewrite'::regclass, 'pg_class'::regclass, 'pg_policy'::regclass)) as used_in_rule
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
),
decided as (
  select fn.*,
         (proname in ('resolve_staff_login_email', 'resolve_scholar_login_email', 'resolve_school_login_email', 'request_school_password_reset',
                      'get_public_scholar_emergency_info', 'join_presentation_session', 'submit_presentation_response', 'get_presentation_session_state',
                      'get_financial_assistance_status', 'get_public_survey', 'submit_my_survey_response')) as visitor_page
  from fn
)
select case
         when is_trigger or in_extension then 'KEEP (trigger or extension)'
         when visitor_page then 'KEEP (a visitor page calls it)'
         when used_in_rule then 'KEEP (a table rule or table definition uses it)'
         when anon_exec then 'CLOSE to visitors' || case when proname like '\_%' and auth_exec then ' AND to signed-in people (internal helper)' else '' end
         when proname like '\_%' and auth_exec then 'CLOSE to signed-in people (internal helper)'
         else 'already closed to visitors' end as decision,
       proname as function_name, args as inputs, case when definer then 'owner rights' else 'caller rights' end as runs_with, anon_exec as visitors_can_run_it_today, auth_exec as signed_in_can_run_it_today
from decided
where not (in_extension and not anon_exec)
order by 1, 2, 3;
