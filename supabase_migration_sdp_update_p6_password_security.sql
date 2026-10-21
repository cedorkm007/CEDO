-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 6: PASSWORD AND SIGN-IN SECURITY (database part).   Safe to re-run.   Undo: undo_sdp_update_p6.sql
--
--   1. "Must choose a new password" marker: every account given a temporary password is marked, and the website makes that person choose their own
--      password before anything else. The marker clears only after the password really changed (the stored hash is compared).
--   2. A small log of sign-in look-ups and reset attempts, used to LIMIT attempts (per person and per internet address).
--   3. The three sign-in look-ups (staff, school, scholar) answer the SAME way whether or not the account exists (an unknown name gets a made-up
--      address that simply fails to sign in), and are limited to 10 tries per 15 minutes per name and address (60 per address).
--   4. Helpers for the scholar "I forgot my password" flow: at most 5 wrong security answers per hour per scholar ID.
-- Creates NEW tables and functions only: no existing table is changed or locked, so it can be run at any time. Changes no existing data.
-- ─────────────────────────────────────────────────────────────
set lock_timeout = '5s';

-- ═══ 1. The "must choose a new password" marker ═══════════════
create table if not exists public.account_password_flags (
  user_id uuid primary key,                 -- the sign-in account (no link on purpose: this table must never block changes to accounts)
  temp_hash text not null,                  -- what the stored password hash was when the temporary password was given
  reason text not null default 'temporary_password',
  created_at timestamptz not null default now()
);
alter table public.account_password_flags enable row level security;
revoke all on public.account_password_flags from public, anon, authenticated;

-- Called by the account functions (service role only) right after they set a temporary password.
create or replace function public.flag_password_change(p_user_id uuid, p_reason text default 'temporary_password')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_hash text;
begin
  select u.encrypted_password into v_hash from auth.users u where u.id = p_user_id;
  if not found then raise exception 'That account does not exist.'; end if;
  insert into public.account_password_flags (user_id, temp_hash, reason) values (p_user_id, coalesce(v_hash, ''), coalesce(p_reason, 'temporary_password'))
  on conflict (user_id) do update set temp_hash = excluded.temp_hash, reason = excluded.reason, created_at = now();
end;
$$;
revoke all on function public.flag_password_change(uuid, text) from public, anon, authenticated;
grant execute on function public.flag_password_change(uuid, text) to service_role;

-- Does the signed-in person still have to choose a new password? (If the password was already changed, the marker is cleared here.)
create or replace function public.my_password_change_required()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_flag text; v_now text;
begin
  if auth.uid() is null then return false; end if;
  select f.temp_hash into v_flag from public.account_password_flags f where f.user_id = auth.uid();
  if not found then return false; end if;
  select u.encrypted_password into v_now from auth.users u where u.id = auth.uid();
  if coalesce(v_now, '') is distinct from v_flag then
    delete from public.account_password_flags where user_id = auth.uid();
    return false;
  end if;
  return true;
end;
$$;
revoke all on function public.my_password_change_required() from public, anon;
grant execute on function public.my_password_change_required() to authenticated;

-- Called after the person chose a new password: clears the marker, but ONLY if the password really changed.
create or replace function public.complete_password_change()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.my_password_change_required() then raise exception 'Choose a new password first.'; end if;
  return true;
end;
$$;
revoke all on function public.complete_password_change() from public, anon;
grant execute on function public.complete_password_change() to authenticated;

-- ═══ 2. Limiting attempts ═════════════════════════════════════
create table if not exists public.auth_attempts (
  id bigint generated always as identity primary key,
  kind text not null,
  key_hash text not null,
  ip_hash text not null,
  at timestamptz not null default now()
);
create index if not exists auth_attempts_lookup_idx on public.auth_attempts (kind, key_hash, ip_hash, at);
create index if not exists auth_attempts_kind_ip_idx on public.auth_attempts (kind, ip_hash, at);
alter table public.auth_attempts enable row level security;
revoke all on public.auth_attempts from public, anon, authenticated;

-- A one-way fingerprint of a name / address, so the log never holds what people typed.
create or replace function public._auth_hash(p_text text)
returns text
language sql
immutable
set search_path = public, extensions
as $$ select encode(extensions.digest(lower(btrim(coalesce(p_text, ''))) || ':cedo-auth', 'sha256'), 'hex'); $$;
revoke all on function public._auth_hash(text) from public, anon, authenticated;

-- The internet address the request came from (as the Supabase API passes it on), or 'unknown'.
create or replace function public._auth_client_ip()
returns text
language plpgsql
stable
set search_path = public
as $$
declare v text;
begin
  begin
    v := split_part(coalesce((nullif(current_setting('request.headers', true), '')::jsonb) ->> 'x-forwarded-for', ''), ',', 1);
  exception when others then v := '';
  end;
  return coalesce(nullif(btrim(v), ''), 'unknown');
end;
$$;
revoke all on function public._auth_client_ip() from public, anon, authenticated;

-- Counts this try and refuses it when the person (name + address) or the whole address has tried too often in the window.
create or replace function public._auth_rate_limit(p_kind text, p_key text, p_ip text, p_per_key integer, p_per_ip integer, p_window interval)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_key text := public._auth_hash(p_key); v_ip text := public._auth_hash(coalesce(p_ip, 'unknown'));
begin
  if random() < 0.02 then delete from public.auth_attempts where at < now() - interval '2 days'; end if;
  if (select count(*) from public.auth_attempts a where a.kind = p_kind and a.key_hash = v_key and a.ip_hash = v_ip and a.at > now() - p_window) >= p_per_key
     or (select count(*) from public.auth_attempts a where a.kind = p_kind and a.ip_hash = v_ip and a.at > now() - p_window) >= p_per_ip then
    raise exception 'Too many attempts. Please wait a few minutes and try again.';
  end if;
  insert into public.auth_attempts (kind, key_hash, ip_hash) values (p_kind, v_key, v_ip);
end;
$$;
revoke all on function public._auth_rate_limit(text, text, text, integer, integer, interval) from public, anon, authenticated;

-- ═══ 3. Sign-in look-ups that answer the same way for every name ═══
-- Same names, same inputs and same grants as before (the website needs no change to call them). An unknown name gets a made-up address on a domain that
-- does not exist, so the next step (signing in) simply fails with the usual "incorrect details" message, exactly like a wrong password.
create or replace function public.resolve_staff_login_email(p_username text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v text;
begin
  perform public._auth_rate_limit('staff_lookup', p_username, public._auth_client_ip(), 10, 60, interval '15 minutes');
  select u.email into v from public.users u where lower(u.username) = lower(btrim(coalesce(p_username, ''))) limit 1;
  return coalesce(v, 'no-account-' || substr(public._auth_hash(p_username), 1, 20) || '@invalid.cedo.local');
end;
$$;
grant execute on function public.resolve_staff_login_email(text) to anon, authenticated;

create or replace function public.resolve_school_login_email(p_school_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v text;
begin
  perform public._auth_rate_limit('school_lookup', p_school_name, public._auth_client_ip(), 10, 60, interval '15 minutes');
  select a.email into v from public.school_accounts a
  where btrim(coalesce(p_school_name, '')) <> '' and (lower(a.username) = lower(btrim(p_school_name)) or lower(a.email) = lower(btrim(p_school_name)))
  limit 1;
  return coalesce(v, 'no-account-' || substr(public._auth_hash(p_school_name), 1, 20) || '@invalid.cedo.local');
end;
$$;
grant execute on function public.resolve_school_login_email(text) to anon, authenticated;

create or replace function public.resolve_scholar_login_email(
  p_first_name text default null, p_last_name text default null, p_middle_initial text default null, p_birthday date default null, p_scholar_id_number text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v text; v_key text := coalesce(nullif(btrim(p_scholar_id_number), ''), coalesce(p_first_name, '') || '|' || coalesce(p_last_name, '') || '|' || coalesce(p_birthday::text, ''));
begin
  perform public._auth_rate_limit('scholar_lookup', v_key, public._auth_client_ip(), 10, 60, interval '15 minutes');
  select s.email into v from public.scholars s
  where (p_scholar_id_number is not null and s.scholar_id_number = p_scholar_id_number)
     or (p_first_name is not null and p_last_name is not null and p_birthday is not null
         and lower(trim(s.first_name)) = lower(trim(p_first_name)) and lower(trim(s.last_name)) = lower(trim(p_last_name)) and s.birthday = p_birthday
         and (p_middle_initial is null or p_middle_initial = '' or lower(left(trim(s.middle_name), 1)) = lower(left(trim(p_middle_initial), 1))))
  limit 1;
  return coalesce(v, 'no-account-' || substr(public._auth_hash(v_key), 1, 20) || '@invalid.cedo.local');
end;
$$;
grant execute on function public.resolve_scholar_login_email(text, text, text, date, text) to anon, authenticated;

-- ═══ 4. The scholar "forgot my password" flow (used by the scholar-self-reset-password function, service role only) ═══
-- Any try (right or wrong identity): 8 per hour per name and address, 40 per hour per address.
create or replace function public.scholar_reset_gate(p_identity text, p_ip text)
returns void
language sql
security definer
set search_path = public
as $$ select public._auth_rate_limit('scholar_reset_try', p_identity, p_ip, 8, 40, interval '1 hour'); $$;
revoke all on function public.scholar_reset_gate(text, text) from public, anon, authenticated;
grant execute on function public.scholar_reset_gate(text, text) to service_role;

-- Wrong answers: at most 5 per hour for one Scholar ID (whoever is typing), so a guesser cannot work through answers.
create or replace function public.scholar_reset_is_locked(p_identity text)
returns boolean
language sql
security definer
set search_path = public
as $$ select (select count(*) from public.auth_attempts a where a.kind = 'scholar_reset_wrong' and a.key_hash = public._auth_hash(p_identity) and a.at > now() - interval '1 hour') >= 5; $$;
revoke all on function public.scholar_reset_is_locked(text) from public, anon, authenticated;
grant execute on function public.scholar_reset_is_locked(text) to service_role;

create or replace function public.scholar_reset_register_failure(p_identity text, p_ip text)
returns void
language sql
security definer
set search_path = public
as $$ insert into public.auth_attempts (kind, key_hash, ip_hash) values ('scholar_reset_wrong', public._auth_hash(p_identity), public._auth_hash(coalesce(p_ip, 'unknown'))); $$;
revoke all on function public.scholar_reset_register_failure(text, text) from public, anon, authenticated;
grant execute on function public.scholar_reset_register_failure(text, text) to service_role;

create or replace function public.scholar_reset_clear(p_identity text)
returns void
language sql
security definer
set search_path = public
as $$ delete from public.auth_attempts where kind = 'scholar_reset_wrong' and key_hash = public._auth_hash(p_identity); $$;
revoke all on function public.scholar_reset_clear(text) from public, anon, authenticated;
grant execute on function public.scholar_reset_clear(text) to service_role;

notify pgrst, 'reload schema';
