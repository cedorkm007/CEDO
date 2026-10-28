-- ─────────────────────────────────────────────────────────────
-- RENAME ONE STAFF USERNAME:  sead.sma15  ->  cedo.sac4.   Run once.
--
-- What changes: the username on the staff record (this is what it.admin1 sees, as "@cedo.sac4", and what she types to sign in) and the copy of the username kept in the
-- sign-in account's details. What does NOT change: her password, her email (the address the sign-in uses), her tools / tags, tasks, records, anything she made. The old
-- username stops working at once; she signs in with the new one and the same password.
-- SAFETY: it changes nothing (and says why in the result) unless exactly ONE staff record has the old username and nobody at all has the new one.
-- To undo: swap the two names on the lines below and run it again.
-- Choose "Run without RLS" if asked.
-- ─────────────────────────────────────────────────────────────
do $$
declare
  v_old text := 'sead.sma15';     -- <<<<< the current username
  v_new text := 'cedo.sac4';      -- <<<<< the new username
  v_n integer;
  v_id uuid;
begin
  drop table if exists pg_temp._res;
  create temp table _res (n serial, what text, value text);
  select count(*) into v_n from public.users where lower(btrim(username)) = lower(btrim(v_old));
  if v_n <> 1 then insert into _res (what, value) values ('NOTHING CHANGED', v_n || ' staff record(s) have the username ' || v_old || ' (exactly 1 is needed)'); return; end if;
  select count(*) into v_n from public.users where lower(btrim(username)) = lower(btrim(v_new));
  if v_n > 0 then insert into _res (what, value) values ('NOTHING CHANGED', 'the username ' || v_new || ' is already used by another staff record'); return; end if;
  if lower(btrim(v_new)) in ('it.admin1') or btrim(v_new) = '' or btrim(v_new) ~ '\s' then insert into _res (what, value) values ('NOTHING CHANGED', 'the new username is not allowed (empty, has a space, or reserved)'); return; end if;
  select id into v_id from public.users where lower(btrim(username)) = lower(btrim(v_old));
  update public.users set username = btrim(v_new), updated_at = now() where id = v_id;
  update auth.users set raw_user_meta_data = jsonb_set(coalesce(raw_user_meta_data, '{}'::jsonb), '{username}', to_jsonb(btrim(v_new))) where id = v_id and raw_user_meta_data ? 'username';
  insert into _res (what, value) values ('CHANGED', v_old || ' -> ' || v_new);
end $$;

select what, value from _res
union all
select 'NOW', 'username ' || u.username || ' | role ' || u.role || ' | sign-in email (unchanged) ' || left(u.email, 2) || '***@' || split_part(u.email, '@', 2)
  from public.users u where lower(btrim(u.username)) in ('cedo.sac4', 'sead.sma15')
union all
select 'OLD USERNAME STILL IN USE?', case when exists (select 1 from public.users where lower(btrim(username)) = 'sead.sma15') then 'YES (the change did not happen)' else 'no' end
order by 1;
