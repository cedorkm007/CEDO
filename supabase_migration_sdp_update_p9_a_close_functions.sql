-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 9, FILE A: close the database functions a visitor does not need.
--
-- By default Supabase lets ANYONE with the public website key (a visitor who is not signed in) run almost every function in the public area. Most check who is
-- calling, but some helpers hand out data when given a Scholar ID. This file takes the "run" permission away from visitors for every function EXCEPT:
--   (a) the eleven that a visitor page really calls: the three sign-in look-ups, the school password request, the scholar emergency page, the audience page of a live
--       presentation (join, answer, state), the financial-assistance status page, and the public survey page (read and answer);
--   (b) functions that a table rule or a table definition uses (a rule, a default value, a check, an index: closing them could turn an empty answer into an error
--       or stop a save);
--   (c) triggers and extension functions.
-- Internal helpers (names starting with an underscore, which the database calls itself and the website never calls) are also closed to signed-in people.
-- Signed-in people keep access to every function they use today. Server functions (service key) and the database's own calls are not affected.
-- Every function it closes is written to a small locked list (public.p9_closed_functions) so that the undo restores exactly those and nothing else.
-- Safe to run twice. Undo: undo_sdp_update_p9_a.sql.  Changes function permissions only (no table rule, no data); adds one small locked table.
-- Preview first with p9_step0_function_access_preview_readonly.sql.
-- ─────────────────────────────────────────────────────────────
set lock_timeout = '5s';

create table if not exists public.p9_closed_functions (
  signature text not null,
  closed_from text not null,                       -- 'visitors' or 'signed-in'
  closed_at timestamptz not null default now(),
  primary key (signature, closed_from)
);
alter table public.p9_closed_functions enable row level security;
revoke all on public.p9_closed_functions from public, anon, authenticated;

do $$
declare
  r record;
begin
  for r in
    with fn as (
      select p.oid, p.proname, p.oid::regprocedure::text as sig,
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
    )
    select fn.*, (proname like '\_%') as internal_helper
    from fn
    where not is_trigger and not in_extension and not used_in_rule
      and proname not in ('resolve_staff_login_email', 'resolve_scholar_login_email', 'resolve_school_login_email', 'request_school_password_reset',
                          'get_public_scholar_emergency_info', 'join_presentation_session', 'submit_presentation_response', 'get_presentation_session_state',
                          'get_financial_assistance_status', 'get_public_survey', 'submit_my_survey_response')
      and (anon_exec or (proname like '\_%' and auth_exec))
  loop
    if r.anon_exec then
      execute format('revoke execute on function %s from public, anon', r.sig);
      execute format('grant execute on function %s to service_role', r.sig);   -- the server functions keep running them, whatever the default grants were
      insert into public.p9_closed_functions (signature, closed_from) values (r.sig, 'visitors') on conflict do nothing;
    end if;
    if r.internal_helper and r.auth_exec then
      execute format('revoke execute on function %s from authenticated', r.sig);
      insert into public.p9_closed_functions (signature, closed_from) values (r.sig, 'signed-in') on conflict do nothing;
    end if;
  end loop;
end $$;
