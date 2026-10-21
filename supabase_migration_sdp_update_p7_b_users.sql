-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 7, FILE B of 4: staff accounts (table users): nobody can make themselves an administrator.
--
-- Today (checked on the live project): any staff account can change ANY row of "users": its own role (staff to super_admin), anybody's user name,
-- division or admin flag, and can add or delete staff rows. After this file:
--   • every staff member can still READ the list of staff (the website loads it) and edit their OWN profile details (names, phone, picture, …);
--   • "role" and "is admin" can be changed only by a Super Admin (the Admin Management page) or it.admin1;
--   • user name, division and the SEAD flag can be changed only by it.admin1 (Staff Accounts page);
--   • adding or deleting staff rows is only for it.admin1 (the server functions that create and delete accounts use the service key and are not affected);
--   • if someone else's save carries a changed protected value (for example a profile save that still holds an old role), that value is simply kept as it
--     was: the save still works and nothing is changed behind anyone's back.
-- Safe to run twice. Undo: undo_sdp_update_p7_b.sql.  Changes ONE table's rules and adds one trigger; run it on its own.
-- ─────────────────────────────────────────────────────────────
set lock_timeout = '5s';

-- Is the signed-in person a Super Admin? (A small helper, readable only by signed-in people.)
create or replace function public._p7_is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'super_admin'); $$;
revoke all on function public._p7_is_super_admin() from public, anon;
grant execute on function public._p7_is_super_admin() to authenticated;

-- Keeps the protected columns as they were unless the person is allowed to change them. Server functions and the database owner (no signed-in person) pass.
create or replace function public._p7_users_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null then return new; end if;
  if not public.is_it_admin() then
    new.id := old.id;
    new.username := old.username;
    new.division := old.division;
    new.is_sead_staff := old.is_sead_staff;
    if not public._p7_is_super_admin() then
      new.role := old.role;
      new.is_admin := old.is_admin;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists p7_users_guard on public.users;
create trigger p7_users_guard before update on public.users for each row execute function public._p7_users_guard();

alter table public.users enable row level security;

drop policy if exists "staff full access" on public.users;
drop policy if exists "p7 staff read users" on public.users;
drop policy if exists "p7 staff update users" on public.users;
drop policy if exists "p7 it admin adds users" on public.users;
drop policy if exists "p7 it admin deletes users" on public.users;

create policy "p7 staff read users" on public.users
  for select to authenticated using (public.is_cedo_staff());

create policy "p7 staff update users" on public.users
  for update to authenticated
  using (id = auth.uid() or public.is_it_admin() or public._p7_is_super_admin())
  with check (id = auth.uid() or public.is_it_admin() or public._p7_is_super_admin());

create policy "p7 it admin adds users" on public.users
  for insert to authenticated with check (public.is_it_admin());

create policy "p7 it admin deletes users" on public.users
  for delete to authenticated using (public.is_it_admin());
