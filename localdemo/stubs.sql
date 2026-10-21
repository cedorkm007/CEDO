-- localdemo/stubs.sql — the parts of a Supabase project that the real database relies on, rebuilt for the local demo:
-- the three API roles, the auth and storage schemas, and Supabase's default permissions on new tables and functions.
-- Local demo only. Not used by the website or by the real database.

do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  encrypted_password text,
  email_confirmed_at timestamptz default now(),
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  role text default 'authenticated',
  aud text default 'authenticated',
  banned_until timestamptz,
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))
$$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text unique, owner uuid, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[],
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text, owner uuid, owner_id text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now(), last_accessed_at timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select case when array_length(string_to_array(name, '/'), 1) > 1 then (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] else '{}'::text[] end
$$;
create or replace function storage.filename(name text) returns text language sql immutable as $$
  select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)]
$$;
create or replace function storage.extension(name text) returns text language sql immutable as $$
  select case when position('.' in storage.filename(name)) > 0 then regexp_replace(storage.filename(name), '^.*[.]', '') else '' end
$$;

create schema if not exists extensions;
create extension if not exists pg_trgm;
create extension if not exists pgcrypto with schema extensions;   -- password hashing (crypt, gen_salt) and digest, as on the real project

-- Functions the real database has but no migration file defines (they were created by hand there).
create or replace function public.has_staff_tag(p_tag_key text) returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  return exists (select 1 from public.staff_account_tags t where t.staff_id = auth.uid() and t.tag_key = p_tag_key);
end $$;
create or replace function public.resolve_staff_login_email(p_username text) returns text language plpgsql stable security definer set search_path = public as $$
begin
  return (select u.email from public.users u where lower(u.username) = lower(btrim(coalesce(p_username, ''))) limit 1);
end $$;
-- The real one checks a hashed answer; the demo has no security-question accounts.
create or replace function public.verify_scholar_security_answer(p_scholar_id uuid, p_answer text) returns boolean language sql stable as $$ select false $$;

grant usage on schema public, auth, storage to anon, authenticated, service_role;
grant select on all tables in schema auth to service_role;
grant all on all tables in schema storage to authenticated, service_role;
grant select on storage.buckets to anon;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant execute on all functions in schema storage to anon, authenticated, service_role;

-- What Supabase gives every new object in the public schema (migrations then narrow it with their own REVOKE / GRANT lines).
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
