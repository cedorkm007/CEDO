-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 9, FILE B: make everyone who is STILL on the old default password (123456) choose a new one at their next visit.
--
-- The check you ran found that about 78% of the scholars who have signed in, 17 of 23 staff and the school account still use 123456, because Phase 6 only
-- forced accounts that had never signed in. The website already has the "choose your own password" screen on all three sites; it appears when the database
-- says "this person must choose a new password". This file teaches the database to say that for anyone whose password is still 123456:
--   • it compares the account's stored (scrambled) password with the scrambled form of 123456 when the person opens the website; nobody's password is shown or kept;
--   • the person is made to choose a new one (10 characters or more, not a common one); the website refuses 123456 as the new password;
--   • it costs a fraction of a second per visit.
-- A small locked switch table decides WHO this applies to: it starts with STAFF AND SCHOOLS ON and SCHOLARS OFF, so you can announce it to the scholars first
-- and then turn it on for them with p9_b2_turn_on_for_scholars.sql (and off again with p9_b3_turn_off_for_scholars.sql).
-- It changes no password, no account and no data other than the "must choose a new password" marker. Safe to run twice. Undo: undo_sdp_update_p9_b.sql.
-- ─────────────────────────────────────────────────────────────
set lock_timeout = '5s';

create table if not exists public.p9_default_password_settings (
  id boolean primary key default true check (id),
  staff_and_schools boolean not null default true,
  scholars boolean not null default false
);
alter table public.p9_default_password_settings enable row level security;
revoke all on public.p9_default_password_settings from public, anon, authenticated;
insert into public.p9_default_password_settings (id) values (true) on conflict (id) do nothing;

create or replace function public.my_password_change_required()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_flag text; v_now text;
  v_on_staff boolean := false; v_on_scholars boolean := false;
  v_is_staff boolean; v_is_school boolean; v_is_scholar boolean;
begin
  if auth.uid() is null then return false; end if;
  select u.encrypted_password into v_now from auth.users u where u.id = auth.uid();

  -- 1. A temporary password was given (new account, reset, or an earlier detection): still required until the stored password really changed.
  select f.temp_hash into v_flag from public.account_password_flags f where f.user_id = auth.uid();
  if found then
    if coalesce(v_now, '') is not distinct from v_flag then return true; end if;
    delete from public.account_password_flags where user_id = auth.uid();
  end if;

  -- 2. Still on the old default password (123456)? Only for the groups the switch is on for.
  select s.staff_and_schools, s.scholars into v_on_staff, v_on_scholars from public.p9_default_password_settings s limit 1;
  v_is_staff := exists (select 1 from public.users u where u.id = auth.uid());
  v_is_school := exists (select 1 from public.school_accounts a where a.id = auth.uid());
  v_is_scholar := exists (select 1 from public.scholars s where s.id = auth.uid());
  if ((v_is_staff or v_is_school) and coalesce(v_on_staff, false)) or (v_is_scholar and coalesce(v_on_scholars, false)) then
    if v_now like '$2%' and v_now = extensions.crypt('123456', v_now) then
      insert into public.account_password_flags (user_id, temp_hash, reason) values (auth.uid(), v_now, 'default_password')
      on conflict (user_id) do update set temp_hash = excluded.temp_hash, reason = excluded.reason, created_at = now();
      return true;
    end if;
  end if;
  return false;
end;
$$;
revoke all on function public.my_password_change_required() from public, anon;
grant execute on function public.my_password_change_required() to authenticated;
