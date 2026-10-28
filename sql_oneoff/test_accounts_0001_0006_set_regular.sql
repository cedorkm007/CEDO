-- ─────────────────────────────────────────────────────────────
-- PUT TEST ACCOUNTS 0001 AND 0006 BACK TO REGULAR.   Run once.   It touches ONLY these two Scholar ID numbers.
--
--   • 0001 (was changed to Probationary by the renewal test): status set to Regular.
--   • 0006 (was marked Removed by the renewal test): login switched on again (a removed scholar's login is deactivated), status set to Regular,
--     the "status before removal" note cleared. This is exactly what the Scholars tool's "Restore" does, with Regular as the status.
--   Each change is written to the status history (source "manual", note "Test cleanup: back to Regular") and to the Account History log.
--   SAFETY: an account is changed only if it is still in the state the test left it (0001 Probationary, 0006 Removed). Anything else is left alone and the
--   result says so. Nothing is deleted.
--   NOT touched: the earlier lines of the status history (the test's "Probationary" / "Removed" entries stay as history). Tell me if you want those test lines removed too.
-- Choose "Run without RLS" if asked. The result table at the end shows what happened.
-- ─────────────────────────────────────────────────────────────
do $$
declare
  v_pairs text[][] := array[['0001', 'Probationary'], ['0006', 'Removed']];
  i integer;
  v_id text;
  v_expect text;
  s public.scholars%rowtype;
begin
  drop table if exists pg_temp._res;
  create temp table _res (n serial, scholar text, outcome text);
  for i in 1 .. array_length(v_pairs, 1) loop
    v_id := v_pairs[i][1]; v_expect := v_pairs[i][2];
    select * into s from public.scholars where scholar_id_number = v_id for update;
    if not found then insert into _res (scholar, outcome) values (v_id, 'NOT FOUND: nothing changed'); continue; end if;
    if s.status <> v_expect then insert into _res (scholar, outcome) values (v_id, 'LEFT ALONE: the status is ' || s.status || ', not ' || v_expect || ' as the test left it'); continue; end if;
    if s.status = 'Removed' then
      update auth.users set banned_until = null where id = s.id;
    end if;
    perform set_config('app.status_source', 'manual', true);
    perform set_config('app.status_temporary', 'false', true);
    perform set_config('app.status_note', 'Test cleanup: back to Regular', true);
    update public.scholars set status = 'Regular', status_before_removal = null, updated_at = now() where scholar_id_number = v_id;
    perform set_config('app.status_source', '', true);
    perform set_config('app.status_temporary', '', true);
    perform set_config('app.status_note', '', true);
    insert into public.sead_scholar_account_log (action, scholar_id, scholar_id_number, scholar_name, performed_by, performed_by_name, source, description)
    values ('updated', s.id, s.scholar_id_number, btrim(s.first_name || ' ' || s.last_name), null, 'SQL test cleanup', 'single',
            case when v_expect = 'Removed' then 'Restored from Removed to Regular (test cleanup) — login reactivated.' else 'Status changed from ' || v_expect || ' to Regular (test cleanup).' end);
    insert into _res (scholar, outcome) values (v_id, 'CHANGED: ' || v_expect || ' -> Regular' || case when v_expect = 'Removed' then ' (login switched on again)' else '' end);
  end loop;
end $$;

select r.scholar, r.outcome, s.status as status_now,
       case when s.id is null then null else (select (u.banned_until is null or u.banned_until < now()) from auth.users u where u.id = s.id) end as login_active
from _res r left join public.scholars s on s.scholar_id_number = r.scholar order by r.n;
