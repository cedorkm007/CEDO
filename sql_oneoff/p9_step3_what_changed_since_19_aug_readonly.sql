-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 9, STEP 3: WHAT CHANGED SINCE 19 AUGUST 2026 (the day the first test sign-up appeared)?   READ-ONLY: changes nothing.
--
-- Why: three accounts that look like security tests were created on 19 August and 20 September. They never signed in, but whoever made them could also have
-- called functions with only the public website key. This looks for anything unusual in the records those functions or a stray account could touch:
-- sign-in account activity, staff roles and tool tags, SDP credits and their history, attendance codes and sessions, grades, scholar account history, anonymous
-- presentation votes. The database does not record who called a function without an account, so this can show UNUSUAL PATTERNS, not prove who did what.
-- Each part runs on its own: if a part is not possible on your project it says "skipped" and the others still run. It shows counts, dates, user names of staff
-- and the part of an email after the @ (never a scholar's name). Choose "Run without RLS" if asked. Send me the result (Export as CSV, or copy the rows).
-- To change the start day, change 2026-08-19 in each part (it is written 11 times).
-- ─────────────────────────────────────────────────────────────
drop table if exists pg_temp._rv;
create temp table _rv (n serial, part text, thing text, detail text);

-- 1. Sign-in accounts: new accounts since the start day, by email domain and whether they ever signed in.
do $$ begin
  insert into _rv (part, thing, detail)
  select '1. NEW SIGN-IN ACCOUNTS', split_part(au.email, '@', 2) || ' | ' || case when au.last_sign_in_at is null then 'never signed in' else 'has signed in' end || ' | ' || case when au.email_confirmed_at is null then 'NOT confirmed' else 'confirmed' end, count(*)::text
  from auth.users au where au.created_at >= timestamptz '2026-08-19 00:00:00+08' group by 2 order by 2;
exception when others then insert into _rv (part, thing, detail) values ('1. NEW SIGN-IN ACCOUNTS', 'skipped', sqlerrm); end $$;

-- 2. The sign-in service's own log (sign-ups, password or email changes, recovery requests, deletions) by day.
do $$ begin
  insert into _rv (part, thing, detail)
  select '2. SIGN-IN LOG', to_char(l.created_at, 'YYYY-MM-DD') || ' | ' || coalesce(l.payload ->> 'action', '?'), count(*)::text || ' event(s), ' || count(distinct l.ip_address)::text || ' address(es)'
  from auth.audit_log_entries l
  where l.created_at >= timestamptz '2026-08-19 00:00:00+08' and coalesce(l.payload ->> 'action', '') in ('user_signedup', 'user_repeated_signup', 'user_modified', 'user_recovery_requested', 'user_deleted', 'user_invited', 'user_confirmation_requested')
  group by 2 order by 2;
exception when others then insert into _rv (part, thing, detail) values ('2. SIGN-IN LOG', 'skipped', sqlerrm); end $$;

-- 3. Staff accounts: administrator roles now, and any staff row created or changed since the start day.
do $$ begin
  insert into _rv (part, thing, detail)
  select '3. STAFF ROLES', u.username, 'role ' || coalesce(u.role, '?') || ' | admin ' || coalesce(u.is_admin::text, '?') || ' | created ' || to_char(u.created_at, 'YYYY-MM-DD') || ' | changed ' || to_char(u.updated_at, 'YYYY-MM-DD')
  from public.users u where u.role is distinct from 'staff' or u.is_admin or u.created_at >= timestamptz '2026-08-19 00:00:00+08' or u.updated_at >= timestamptz '2026-08-19 00:00:00+08' order by u.username;
exception when others then insert into _rv (part, thing, detail) values ('3. STAFF ROLES', 'skipped', sqlerrm); end $$;

-- 4. Tool tags given since the start day (who holds what). A tag nobody remembers giving is worth asking about.
do $$ begin
  insert into _rv (part, thing, detail)
  select '4. TOOL TAGS GIVEN', coalesce(u.username, '(no such staff account)'), t.tag_key || ' | given ' || to_char(t.created_at, 'YYYY-MM-DD HH24:MI')
  from public.staff_account_tags t left join public.users u on u.id = t.staff_id
  where t.created_at >= timestamptz '2026-08-19 00:00:00+08' order by t.created_at, 2;
exception when others then insert into _rv (part, thing, detail) values ('4. TOOL TAGS GIVEN', 'skipped', sqlerrm); end $$;

-- 5. SDP credits added since the start day: per day, and who added them (a staff user name, or "no account named" for the scan functions).
do $$ begin
  insert into _rv (part, thing, detail)
  select '5. SDP CREDITS ADDED', to_char(a.created_at, 'YYYY-MM-DD') || ' | by ' || coalesce(u.username, 'no account named (scan or function)'), count(*)::text || ' credit(s)'
  from public.sdp_attendance a left join public.users u on u.id = a.created_by
  where a.created_at >= timestamptz '2026-08-19 00:00:00+08' group by 2 order by 2;
exception when others then insert into _rv (part, thing, detail) values ('5. SDP CREDITS ADDED', 'skipped', sqlerrm); end $$;

-- 6. Credits added by someone who does NOT hold the SDP Monitoring or Scholar Management tool today (they should be rare: only people with those tools add credits).
do $$ begin
  insert into _rv (part, thing, detail)
  select '6. CREDITS BY SOMEONE WITHOUT THE TOOL', u.username, count(*)::text || ' credit(s), first ' || to_char(min(a.created_at), 'YYYY-MM-DD') || ', last ' || to_char(max(a.created_at), 'YYYY-MM-DD')
  from public.sdp_attendance a join public.users u on u.id = a.created_by
  where a.created_at >= timestamptz '2026-08-19 00:00:00+08'
    and not exists (select 1 from public.staff_account_tags t where t.staff_id = u.id and t.tag_key in ('sdp_monitoring', 'scholar_management'))
  group by u.username order by u.username;
exception when others then insert into _rv (part, thing, detail) values ('6. CREDITS BY SOMEONE WITHOUT THE TOOL', 'skipped', sqlerrm); end $$;

-- 7. The credit history (installed in Phase 1): what it recorded, by day, kind of change, source and the person named.
do $$ begin
  insert into _rv (part, thing, detail)
  select '7. CREDIT HISTORY', to_char(h.occurred_at, 'YYYY-MM-DD') || ' | ' || coalesce(h.event_type, '?') || ' | ' || coalesce(h.source, '?') || ' | by ' || coalesce(nullif(h.actor_name, ''), 'no account named'), count(*)::text
  from public.sdp_credit_history h where h.occurred_at >= timestamptz '2026-08-19 00:00:00+08' group by 2 order by 2;
exception when others then insert into _rv (part, thing, detail) values ('7. CREDIT HISTORY', 'skipped', sqlerrm); end $$;

-- 8. Attendance sessions made since the start day, who made them, and how many codes each holds and how many were used.
do $$ begin
  insert into _rv (part, thing, detail)
  select '8. ATTENDANCE SESSIONS', to_char(s.created_at, 'YYYY-MM-DD') || ' | ' || coalesce(s.type, '?') || ' | by ' || coalesce(u.username, 'no account named'),
         (select count(*) from public.attendance_codes c where c.session_id = s.id)::text || ' codes, ' || (select count(*) from public.attendance_codes c where c.session_id = s.id and c.redeemed_at is not null)::text || ' used'
  from public.attendance_sessions s left join public.users u on u.id = s.created_by
  where s.created_at >= timestamptz '2026-08-19 00:00:00+08' order by s.created_at;
exception when others then insert into _rv (part, thing, detail) values ('8. ATTENDANCE SESSIONS', 'skipped', sqlerrm); end $$;

-- 9. Attendance codes made since the start day for sessions that are OLDER than the start day (codes added later to an old session are unusual), by day.
do $$ begin
  insert into _rv (part, thing, detail)
  select '9. CODES ADDED TO OLD SESSIONS', to_char(c.created_at, 'YYYY-MM-DD'), count(*)::text || ' code(s)'
  from public.attendance_codes c join public.attendance_sessions s on s.id = c.session_id
  where c.created_at >= timestamptz '2026-08-19 00:00:00+08' and s.created_at < timestamptz '2026-08-19 00:00:00+08' group by 2 order by 2;
exception when others then insert into _rv (part, thing, detail) values ('9. CODES ADDED TO OLD SESSIONS', 'skipped', sqlerrm); end $$;

-- 10. Grade changes recorded in the grade audit since the start day: who (a school, staff or the system), what kind, how many, by day.
do $$ begin
  insert into _rv (part, thing, detail)
  select '10. GRADE CHANGES', to_char(a.changed_at, 'YYYY-MM-DD') || ' | ' || coalesce(a.actor_type, '?') || ' | ' || coalesce(a.action, '?') || ' | ' || coalesce(a.source, '?'), count(*)::text
  from public.scholar_grade_audit a where a.changed_at >= timestamptz '2026-08-19 00:00:00+08' group by 2 order by 2;
exception when others then insert into _rv (part, thing, detail) values ('10. GRADE CHANGES', 'skipped', sqlerrm); end $$;

-- 11. The scholar account history since the start day: what was done, by whom (a staff user name, or the server), by day.
do $$ begin
  insert into _rv (part, thing, detail)
  select '11. SCHOLAR ACCOUNT HISTORY', to_char(l.created_at, 'YYYY-MM-DD') || ' | ' || coalesce(l.action, '?') || ' | ' || coalesce(l.source, '?') || ' | by ' || coalesce(u.username, case when l.performed_by is null then 'the server or the scholar' else 'an account with no staff record' end), count(*)::text
  from public.sead_scholar_account_log l left join public.users u on u.id = l.performed_by
  where l.created_at >= timestamptz '2026-08-19 00:00:00+08' group by 2 order by 2;
exception when others then insert into _rv (part, thing, detail) values ('11. SCHOLAR ACCOUNT HISTORY', 'skipped', sqlerrm); end $$;

-- 12. Anonymous votes on live presentations: per day, the number of votes and of different devices (a flood from one device or a sudden jump is unusual).
do $$ begin
  insert into _rv (part, thing, detail)
  select '12. PRESENTATION VOTES', to_char(r.created_at, 'YYYY-MM-DD'), count(*)::text || ' vote(s) from ' || count(distinct r.device_id)::text || ' device(s)'
  from public.presentation_responses r where r.created_at >= timestamptz '2026-08-19 00:00:00+08' group by 2 order by 2;
exception when others then insert into _rv (part, thing, detail) values ('12. PRESENTATION VOTES', 'skipped', sqlerrm); end $$;

select part, thing, detail from _rv order by n;
