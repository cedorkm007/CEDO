-- ─────────────────────────────────────────────────────────────
-- supabase_migration_storage_tool_p1.sql
--
-- Storage Tool, PHASE 1: access rules, personal storage, folders, upload (checked by size), list, preview and download.
-- Additive and safe to run twice: new tables, new functions and ONE new private storage folder ("storage-tool"). Nothing that exists is changed.
--
--   1. can_use_storage_tool(): the ONE rule for who may use the tool = the IT admin (it.admin1) or a staff account that has the tag "storage_tool"
--      (given in Staff Accounts). Every table, function and storage rule below asks it, so a staff member without the tag is blocked by the
--      database, not just by a hidden menu item.
--   2. storage_tool_settings: one row: the biggest file (500 MB), the days in Trash (30; used from Phase 2), the whole storage (200 GB).
--   3. storage_tool_folders / storage_tool_files: PERSONAL storage. Each person sees only their own rows (sharing with other staff and with the
--      public comes in Phase 3). A file is stored under its own random id, never under its name, so a file can never overwrite another one.
--      Two active items with the same name in one folder are impossible (the database refuses); the functions add " (1)", " (2)" ... instead.
--   4. Functions: create a folder, register an uploaded file (the website sends the file straight to storage, then registers it here; the
--      database checks the real size and the free space), the path of a folder, usage numbers, and the IT admin's settings.
--   5. storage_tool_activity: every action is written here from the start (the screen for it comes in Phase 4).
--   6. The private storage folder "storage-tool" and its rules: a person can send files only into their own part, read only their own part,
--      and remove only a file that was never registered (a failed upload). Registered files can only leave through Trash (Phase 2).
-- Run AFTER the earlier files (it needs is_it_admin() from supabase_migration_standing_cleanup_logins.sql and the staff tags table).
-- ─────────────────────────────────────────────────────────────

-- ── 1. Who may use it ───────────────────────────────────────
create or replace function public.can_use_storage_tool()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (public.is_it_admin() or exists (select 1 from public.staff_account_tags t where t.staff_id = auth.uid() and t.tag_key = 'storage_tool'));
$$;
revoke all on function public.can_use_storage_tool() from public, anon;
grant execute on function public.can_use_storage_tool() to authenticated;

-- ── 2. Settings (one row) ───────────────────────────────────
create table if not exists public.storage_tool_settings (
  id              boolean primary key default true check (id),
  max_file_mb     integer not null default 500 check (max_file_mb between 1 and 5000),
  trash_days      integer not null default 30 check (trash_days between 1 and 365),
  total_quota_gb  integer not null default 200 check (total_quota_gb between 1 and 100000),
  updated_by      uuid references public.users(id) on delete set null,
  updated_at      timestamptz not null default now()
);
insert into public.storage_tool_settings (id) values (true) on conflict (id) do nothing;
alter table public.storage_tool_settings enable row level security;
drop policy if exists "tool users read storage settings" on public.storage_tool_settings;
create policy "tool users read storage settings" on public.storage_tool_settings for select using (public.can_use_storage_tool());
-- No write policy: the IT admin saves through storage_tool_settings_save().

-- ── 3. Folders and files ────────────────────────────────────
create table if not exists public.storage_tool_folders (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references public.users(id) on delete restrict,
  parent_id        uuid references public.storage_tool_folders(id) on delete restrict,   -- null = the top of the person's storage
  name             text not null check (char_length(name) between 1 and 255),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,                                                         -- Trash (Phase 2)
  trashed_root_id  uuid                                                                 -- the deleted folder that took this one to Trash (Phase 2)
);
create unique index if not exists storage_tool_folders_name_uq on public.storage_tool_folders (owner_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name)) where deleted_at is null;
create index if not exists storage_tool_folders_parent_idx on public.storage_tool_folders (owner_id, parent_id);

create table if not exists public.storage_tool_files (
  id               uuid primary key,                                                    -- also the name of the stored file: "<owner id>/<this id>"
  owner_id         uuid not null references public.users(id) on delete restrict,
  folder_id        uuid references public.storage_tool_folders(id) on delete restrict,  -- null = the top of the person's storage
  name             text not null check (char_length(name) between 1 and 255),
  size_bytes       bigint not null check (size_bytes >= 0),
  mime_type        text not null default 'application/octet-stream',
  storage_path     text not null unique,
  uploaded_by      uuid references public.users(id) on delete set null,
  uploader_label   text not null default '',                                            -- the visitor's name for public uploads (Phase 3)
  created_at       timestamptz not null default now(),
  modified_at      timestamptz not null default now(),
  deleted_at       timestamptz,
  trashed_root_id  uuid
);
create unique index if not exists storage_tool_files_name_uq on public.storage_tool_files (owner_id, coalesce(folder_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name)) where deleted_at is null;
create index if not exists storage_tool_files_folder_idx on public.storage_tool_files (owner_id, folder_id);

alter table public.storage_tool_folders enable row level security;
alter table public.storage_tool_files enable row level security;
drop policy if exists "owner reads own folders" on public.storage_tool_folders;
create policy "owner reads own folders" on public.storage_tool_folders for select using (owner_id = auth.uid() and public.can_use_storage_tool());
drop policy if exists "owner reads own files" on public.storage_tool_files;
create policy "owner reads own files" on public.storage_tool_files for select using (owner_id = auth.uid() and public.can_use_storage_tool());
-- No insert / update / delete policy: everything goes through the functions below.

create table if not exists public.storage_tool_activity (
  id           uuid primary key default gen_random_uuid(),
  at           timestamptz not null default now(),
  owner_id     uuid not null references public.users(id) on delete cascade,             -- whose storage it happened in
  actor_id     uuid references public.users(id) on delete set null,
  actor_label  text not null default '',
  action       text not null,
  target_kind  text not null check (target_kind in ('folder', 'file')),
  target_id    uuid,
  target_name  text not null default '',
  folder_id    uuid,
  detail       jsonb not null default '{}'::jsonb
);
create index if not exists storage_tool_activity_owner_idx on public.storage_tool_activity (owner_id, at desc);
alter table public.storage_tool_activity enable row level security;
drop policy if exists "owner reads own activity" on public.storage_tool_activity;
create policy "owner reads own activity" on public.storage_tool_activity for select using (owner_id = auth.uid() and public.can_use_storage_tool());

-- ── 4. Private storage folder and its rules ─────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('storage-tool', 'storage-tool', false, 524288000)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

create or replace function public._storage_tool_object_registered(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.storage_tool_files f where f.storage_path = p_name);
$$;
-- The storage rule below calls it as the signed-in person, so they need to be allowed to ask (it only answers yes or no).
revoke all on function public._storage_tool_object_registered(text) from public, anon;
grant execute on function public._storage_tool_object_registered(text) to authenticated;

drop policy if exists "storage tool sends to own part" on storage.objects;
create policy "storage tool sends to own part" on storage.objects for insert
  with check (bucket_id = 'storage-tool' and public.can_use_storage_tool() and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "storage tool reads own part" on storage.objects;
create policy "storage tool reads own part" on storage.objects for select
  using (bucket_id = 'storage-tool' and public.can_use_storage_tool() and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "storage tool removes unregistered own part" on storage.objects;
create policy "storage tool removes unregistered own part" on storage.objects for delete
  using (bucket_id = 'storage-tool' and public.can_use_storage_tool() and (storage.foldername(name))[1] = auth.uid()::text and not public._storage_tool_object_registered(name));

-- ── 5. Helpers ──────────────────────────────────────────────
-- A name made safe: no slashes, no control characters, no surrounding spaces or trailing dots, at most 255 letters. Raises when nothing is left.
create or replace function public._storage_tool_clean_name(p_name text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v text := coalesce(p_name, '');
begin
  v := regexp_replace(v, '[\\/]+', '_', 'g');
  v := regexp_replace(v, '[\x01-\x1f\x7f]+', '', 'g');
  v := regexp_replace(v, '\s+', ' ', 'g');
  v := btrim(v);
  v := regexp_replace(v, '[. ]+$', '');
  v := left(v, 255);
  if v = '' or v in ('.', '..') then raise exception 'Please type a name.'; end if;
  return v;
end;
$$;
revoke all on function public._storage_tool_clean_name(text) from public, anon, authenticated;

-- The first name that is free in a folder: "report.pdf", "report (1).pdf", "report (2).pdf" ...  p_kind is 'file' or 'folder'.
create or replace function public._storage_tool_free_name(p_owner uuid, p_parent uuid, p_name text, p_kind text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_stem text := p_name;
  v_ext text := '';
  v_candidate text := p_name;
  v_n integer := 0;
  v_taken boolean;
  v_dot integer;
begin
  if p_kind = 'file' then
    v_dot := length(p_name) - position('.' in reverse(p_name)) + 1;
    if position('.' in p_name) > 1 and v_dot > 1 and v_dot < length(p_name) then v_stem := left(p_name, v_dot - 1); v_ext := substr(p_name, v_dot); end if;
  end if;
  loop
    if p_kind = 'file' then
      select exists (select 1 from public.storage_tool_files f where f.owner_id = p_owner and f.folder_id is not distinct from p_parent and lower(f.name) = lower(v_candidate) and f.deleted_at is null) into v_taken;
    else
      select exists (select 1 from public.storage_tool_folders f where f.owner_id = p_owner and f.parent_id is not distinct from p_parent and lower(f.name) = lower(v_candidate) and f.deleted_at is null) into v_taken;
    end if;
    exit when not v_taken;
    v_n := v_n + 1;
    if v_n > 5000 then raise exception 'Too many items with this name.'; end if;
    v_candidate := left(v_stem, 255 - length(v_ext) - length(' (' || v_n || ')')) || ' (' || v_n || ')' || v_ext;
  end loop;
  return v_candidate;
end;
$$;
revoke all on function public._storage_tool_free_name(uuid, uuid, text, text) from public, anon, authenticated;

create or replace function public._storage_tool_log(p_owner uuid, p_action text, p_kind text, p_id uuid, p_name text, p_folder uuid, p_detail jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.storage_tool_activity (owner_id, actor_id, actor_label, action, target_kind, target_id, target_name, folder_id, detail)
  values (p_owner, auth.uid(), coalesce((select nullif(btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), '') from public.users u where u.id = auth.uid()), 'Staff'), p_action, p_kind, p_id, p_name, p_folder, p_detail);
$$;
revoke all on function public._storage_tool_log(uuid, text, text, uuid, text, uuid, jsonb) from public, anon, authenticated;

create or replace function public._storage_tool_require()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_use_storage_tool() then raise exception 'You do not have access to the Storage Tool.'; end if;
end;
$$;
revoke all on function public._storage_tool_require() from public, anon, authenticated;

-- ── 6. What the website calls ───────────────────────────────
create or replace function public.storage_tool_create_folder(p_parent_id uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_name text;
  v_id uuid;
  v_try integer := 0;
begin
  perform public._storage_tool_require();
  if p_parent_id is not null and not exists (select 1 from public.storage_tool_folders f where f.id = p_parent_id and f.owner_id = v_me and f.deleted_at is null) then
    raise exception 'That folder was not found.';
  end if;
  v_name := public._storage_tool_clean_name(p_name);
  loop
    v_try := v_try + 1;
    begin
      insert into public.storage_tool_folders (owner_id, parent_id, name)
      values (v_me, p_parent_id, public._storage_tool_free_name(v_me, p_parent_id, v_name, 'folder'))
      returning id, name into v_id, v_name;
      exit;
    exception when unique_violation then
      if v_try >= 5 then raise; end if;      -- two quick clicks at the same moment: try the next free name
    end;
  end loop;
  perform public._storage_tool_log(v_me, 'folder_created', 'folder', v_id, v_name, p_parent_id);
  return jsonb_build_object('id', v_id, 'name', v_name);
end;
$$;
revoke all on function public.storage_tool_create_folder(uuid, text) from public, anon;
grant execute on function public.storage_tool_create_folder(uuid, text) to authenticated;

-- The website has sent the file to "<my id>/<p_file_id>" in the storage folder; now it becomes part of the person's storage.
create or replace function public.storage_tool_register_file(p_file_id uuid, p_folder_id uuid, p_name text, p_mime text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_path text := auth.uid()::text || '/' || p_file_id::text;
  v_obj record;
  v_size bigint;
  v_limit bigint;
  v_quota bigint;
  v_used bigint;
  v_name text;
  v_row public.storage_tool_files%rowtype;
  v_try integer := 0;
  v_mime text;
begin
  perform public._storage_tool_require();
  select * into v_row from public.storage_tool_files f where f.id = p_file_id;
  if found then
    if v_row.owner_id <> v_me then raise exception 'That file was not found.'; end if;
    return jsonb_build_object('id', v_row.id, 'name', v_row.name, 'size', v_row.size_bytes);      -- registering twice is harmless
  end if;
  if p_folder_id is not null and not exists (select 1 from public.storage_tool_folders f where f.id = p_folder_id and f.owner_id = v_me and f.deleted_at is null) then
    raise exception 'That folder was not found.';
  end if;
  select o.name, o.metadata into v_obj from storage.objects o where o.bucket_id = 'storage-tool' and o.name = v_path;
  if not found then raise exception 'The file did not arrive in storage. Please upload it again.'; end if;
  v_size := coalesce((v_obj.metadata ->> 'size')::bigint, 0);
  select s.max_file_mb::bigint * 1048576, s.total_quota_gb::bigint * 1073741824 into v_limit, v_quota from public.storage_tool_settings s where s.id;
  if v_size > v_limit then raise exception 'This file is larger than the allowed % MB.', v_limit / 1048576; end if;
  select coalesce(sum(f.size_bytes), 0) into v_used from public.storage_tool_files f;
  if v_used + v_size > v_quota then raise exception 'The storage is full. Please ask the IT admin.'; end if;
  v_name := public._storage_tool_clean_name(p_name);
  v_mime := left(coalesce(nullif(btrim(p_mime), ''), nullif(v_obj.metadata ->> 'mimetype', ''), 'application/octet-stream'), 200);
  loop
    v_try := v_try + 1;
    begin
      insert into public.storage_tool_files (id, owner_id, folder_id, name, size_bytes, mime_type, storage_path, uploaded_by)
      values (p_file_id, v_me, p_folder_id, public._storage_tool_free_name(v_me, p_folder_id, v_name, 'file'), v_size, v_mime, v_path, v_me)
      returning * into v_row;
      exit;
    exception when unique_violation then
      if v_try >= 5 or exists (select 1 from public.storage_tool_files f where f.id = p_file_id) then raise; end if;
    end;
  end loop;
  perform public._storage_tool_log(v_me, 'file_uploaded', 'file', v_row.id, v_row.name, p_folder_id, jsonb_build_object('size', v_size));
  return jsonb_build_object('id', v_row.id, 'name', v_row.name, 'size', v_row.size_bytes);
end;
$$;
revoke all on function public.storage_tool_register_file(uuid, uuid, text, text) from public, anon;
grant execute on function public.storage_tool_register_file(uuid, uuid, text, text) to authenticated;

-- The path from the top of the person's storage to a folder: [{id, name}, ...] (outermost first).
create or replace function public.storage_tool_path(p_folder_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_out jsonb;
begin
  perform public._storage_tool_require();
  if p_folder_id is null then return '[]'::jsonb; end if;
  with recursive up as (
    select f.id, f.name, f.parent_id, 1 as depth from public.storage_tool_folders f where f.id = p_folder_id and f.owner_id = auth.uid() and f.deleted_at is null
    union all
    select f.id, f.name, f.parent_id, up.depth + 1 from public.storage_tool_folders f join up on f.id = up.parent_id where f.owner_id = auth.uid() and up.depth < 100
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by depth desc), '[]'::jsonb) into v_out from up;
  if jsonb_array_length(v_out) = 0 then raise exception 'That folder was not found.'; end if;
  return v_out;
end;
$$;
revoke all on function public.storage_tool_path(uuid) from public, anon;
grant execute on function public.storage_tool_path(uuid) to authenticated;

-- Numbers for the screen: what this person uses, what everybody uses, the whole storage, the biggest file.
create or replace function public.storage_tool_usage()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.storage_tool_settings%rowtype;
begin
  perform public._storage_tool_require();
  select * into s from public.storage_tool_settings where id;
  return jsonb_build_object(
    'mine_bytes', coalesce((select sum(f.size_bytes) from public.storage_tool_files f where f.owner_id = auth.uid()), 0),
    'mine_files', (select count(*) from public.storage_tool_files f where f.owner_id = auth.uid() and f.deleted_at is null),
    'total_bytes', coalesce((select sum(f.size_bytes) from public.storage_tool_files f), 0),
    'quota_bytes', s.total_quota_gb::bigint * 1073741824,
    'max_file_bytes', s.max_file_mb::bigint * 1048576,
    'trash_days', s.trash_days);
end;
$$;
revoke all on function public.storage_tool_usage() from public, anon;
grant execute on function public.storage_tool_usage() to authenticated;

-- The IT admin changes the limits. (The biggest file can never exceed what the storage bucket itself allows: 500 MB; raise the bucket's
-- limit in the Supabase dashboard and in this file's bucket line first if you ever want more.)
create or replace function public.storage_tool_settings_save(p_max_file_mb integer, p_trash_days integer, p_total_quota_gb integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_it_admin() then raise exception 'Only the IT admin can change the Storage Tool settings.'; end if;
  if p_max_file_mb is null or p_max_file_mb < 1 or p_max_file_mb > 500 then raise exception 'The biggest file must be between 1 and 500 MB.'; end if;
  if p_trash_days is null or p_trash_days < 1 or p_trash_days > 365 then raise exception 'Days in Trash must be between 1 and 365.'; end if;
  if p_total_quota_gb is null or p_total_quota_gb < 1 then raise exception 'The whole storage must be at least 1 GB.'; end if;
  update public.storage_tool_settings set max_file_mb = p_max_file_mb, trash_days = p_trash_days, total_quota_gb = p_total_quota_gb, updated_by = auth.uid(), updated_at = now() where id;
end;
$$;
revoke all on function public.storage_tool_settings_save(integer, integer, integer) from public, anon;
grant execute on function public.storage_tool_settings_save(integer, integer, integer) to authenticated;

notify pgrst, 'reload schema';

-- Result check (shown in the SQL editor)
select (select count(*) from public.storage_tool_settings) as settings_rows, (select count(*) from storage.buckets where id = 'storage-tool' and not public) as private_bucket;
