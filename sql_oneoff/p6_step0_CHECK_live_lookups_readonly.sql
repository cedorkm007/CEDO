-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 6 — STEP 0 of 3: LOOK at the three sign-in look-up functions as they are on the live project.   READ-ONLY: changes nothing.
-- Step 1 (the Phase 6 database update) replaces these three functions so that they answer the same way for every name. The staff one was made on the
-- live project and is not in our files, so please run this first and send me the result, to make sure the replacement keeps everything it does today.
-- ─────────────────────────────────────────────────────────────
select p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as inputs,
       p.prosecdef as runs_with_owner_rights,
       pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('resolve_staff_login_email', 'resolve_school_login_email', 'resolve_scholar_login_email')
order by p.proname;
