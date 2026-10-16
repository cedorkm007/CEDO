-- ─────────────────────────────────────────────────────────────
-- supabase_migration_storage_tool_p3.sql
--
-- Storage Tool, PHASE 3: sharing. Run AFTER supabase_migration_storage_tool_p2.sql. Additive and safe to run twice. (It re-defines the Phase 1 and 2
-- functions listed in section 3 so that they also work inside a folder somebody shared; nothing changes for a person using their own storage.)
--
--   1. SHARING WITH OTHER STAFF (people who can use the Storage Tool). A file or a folder is shared with one person at a time, with a permission
--      chosen per share:  view (see, preview, download, copy into their own storage)  <  upload (also add files and folders)  <  edit (also rename,
--      move and delete inside it). A share on a folder covers everything inside it, now and later. The owner keeps ownership: shared items stay in
--      the owner's storage, count against the owner and go to the OWNER's Trash when somebody with edit deletes them. Only the owner can share.
--   2. UPLOAD-ONLY LINKS FOR THE PUBLIC (no account). The owner makes a link for one folder with an optional lock key (password), an optional expiry,
--      limits (files per person, biggest file, allowed types), instructions, and the details the uploader must give. The public page and the whole
--      upload run through the server function "storage-tool-public" (service role); a visitor has no direct access to any table or file. Uploaded
--      files are saved in the folder with the uploader's name and are never overwritten. The visitor sees only their own uploads of that visit.
--   3. Re-defined functions (same names): create_folder, register_file, rename, move, trash, subtree, details, usage. New: browse, shared_with_me.
--   4. Storage rules by FILE ROW instead of by folder prefix, because a file uploaded into a shared or public folder is stored under the uploader's
--      (or the link's) prefix but belongs to the folder's owner: read = owner or anybody the folder is shared with; remove = only the owner, and
--      only a file that is in the owner's Trash (or a failed upload of the person's own).
--   5. Notices: one notification per visit to the person who made the link ("Maria Cruz uploaded 20 files to Signed MOAs"), about a minute after the
--      last file. Staff also get a notice when something is shared with them. A timer job (pg_cron) sends them.
-- ─────────────────────────────────────────────────────────────

-- ── 1. Tables ───────────────────────────────────────────────
create table if not exists public.storage_tool_shares (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references public.users(id) on delete restrict,
  kind         text not null check (kind in ('folder', 'file')),
  item_id      uuid not null,
  shared_with  uuid not null references public.users(id) on delete cascade,
  permission   text not null check (permission in ('view', 'upload', 'edit')),
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (kind, item_id, shared_with),
  check (shared_with <> owner_id)
);
create index if not exists storage_tool_shares_with_idx on public.storage_tool_shares (shared_with);
alter table public.storage_tool_shares enable row level security;
drop policy if exists "owner or recipient reads shares" on public.storage_tool_shares;
create policy "owner or recipient reads shares" on public.storage_tool_shares for select using (public.can_use_storage_tool() and (owner_id = auth.uid() or shared_with = auth.uid()));
-- No write policy: shares are made through the functions below.

create table if not exists public.storage_tool_links (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references public.users(id) on delete restrict,
  folder_id          uuid not null references public.storage_tool_folders(id) on delete cascade,
  token              text not null unique,
  title              text not null default '',
  instructions       text not null default '',
  status             text not null default 'active' check (status in ('active', 'paused', 'revoked')),
  lock_hash          text,
  expires_at         timestamptz,
  max_files_per_person integer check (max_files_per_person is null or max_files_per_person between 1 and 1000),
  max_file_mb        integer not null default 50 check (max_file_mb between 1 and 500),
  allowed_types      text[] not null default array['pdf', 'jpg', 'png', 'docx', 'xlsx'],
  require_email      boolean not null default false,
  require_phone      boolean not null default false,
  allow_subfolders   boolean not null default false,
  created_by         uuid references public.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists storage_tool_links_owner_idx on public.storage_tool_links (owner_id);
create index if not exists storage_tool_links_folder_idx on public.storage_tool_links (folder_id);
alter table public.storage_tool_links enable row level security;
drop policy if exists "owner reads own links" on public.storage_tool_links;
create policy "owner reads own links" on public.storage_tool_links for select using (owner_id = auth.uid() and public.can_use_storage_tool());
-- The lock key's hash and the token are in this table, so no column is ever sent to a visitor except through the server function.

create table if not exists public.storage_tool_upload_sessions (
  id              uuid primary key default gen_random_uuid(),
  link_id         uuid not null references public.storage_tool_links(id) on delete cascade,
  uploader_name   text not null,
  uploader_email  text not null default '',
  uploader_phone  text not null default '',
  session_hash    text not null unique,
  ip_hash         text not null default '',
  created_at      timestamptz not null default now(),
  last_upload_at  timestamptz,
  file_count      integer not null default 0,
  notified_count  integer not null default 0
);
create index if not exists storage_tool_upload_sessions_link_idx on public.storage_tool_upload_sessions (link_id, created_at desc);
alter table public.storage_tool_upload_sessions enable row level security;
drop policy if exists "owner reads sessions of own links" on public.storage_tool_upload_sessions;
create policy "owner reads sessions of own links" on public.storage_tool_upload_sessions for select
  using (public.can_use_storage_tool() and exists (select 1 from public.storage_tool_links l where l.id = link_id and l.owner_id = auth.uid()));

create table if not exists public.storage_tool_public_events (
  id        bigint generated always as identity primary key,
  link_id   uuid not null references public.storage_tool_links(id) on delete cascade,
  ip_hash   text not null,
  kind      text not null,
  at        timestamptz not null default now()
);
create index if not exists storage_tool_public_events_idx on public.storage_tool_public_events (link_id, ip_hash, kind, at desc);
alter table public.storage_tool_public_events enable row level security;      -- no policy: only the server function reads it

-- Who uploaded a file: the file rows get the session it came from (public uploads), so the owner can see "uploaded by Maria Cruz via link".
alter table public.storage_tool_files add column if not exists link_id uuid references public.storage_tool_links(id) on delete set null;
alter table public.storage_tool_files add column if not exists session_id uuid references public.storage_tool_upload_sessions(id) on delete set null;

-- ── 2. Who may do what ──────────────────────────────────────
-- 4 = owner, 3 = edit, 2 = upload, 1 = view, 0 = nothing. Looks at the folder and every folder above it.
create or replace function public._storage_tool_level(p_user uuid, p_folder uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with recursive up as (
    select f.id, f.parent_id, f.owner_id, 1 as depth from public.storage_tool_folders f where f.id = p_folder and f.deleted_at is null
    union all
    select p.id, p.parent_id, p.owner_id, up.depth + 1 from public.storage_tool_folders p join up on p.id = up.parent_id where up.depth < 100 and p.deleted_at is null
  )
  select coalesce(
    (select case when exists (select 1 from up where up.owner_id = p_user) then 4 end),
    (select max(case s.permission when 'edit' then 3 when 'upload' then 2 else 1 end) from public.storage_tool_shares s where s.kind = 'folder' and s.shared_with = p_user and s.item_id in (select id from up)),
    0);
$$;
revoke all on function public._storage_tool_level(uuid, uuid) from public, anon, authenticated;

-- The level of a person on a file: the owner, a share on the file itself, or a share on a folder above it.
create or replace function public._storage_tool_file_level(p_user uuid, p_file uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
    when f.id is null or f.deleted_at is not null then 0
    when f.owner_id = p_user then 4
    else greatest(
      coalesce((select max(case s.permission when 'edit' then 3 when 'upload' then 2 else 1 end) from public.storage_tool_shares s where s.kind = 'file' and s.item_id = f.id and s.shared_with = p_user), 0),
      case when f.folder_id is null then 0 else public._storage_tool_level(p_user, f.folder_id) end)
  end
  from (select 1) x left join public.storage_tool_files f on f.id = p_file;
$$;
revoke all on function public._storage_tool_file_level(uuid, uuid) from public, anon, authenticated;

-- May the person rename / move / delete this item? The owner always; somebody with edit only for items INSIDE what was shared (not the shared folder
-- or file itself, which stays the owner's to rename, move or delete).
create or replace function public._storage_tool_can_edit(p_user uuid, p_kind text, p_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_parent uuid;
  v_owner uuid;
begin
  if p_kind = 'folder' then
    select f.parent_id, f.owner_id into v_parent, v_owner from public.storage_tool_folders f where f.id = p_id and f.deleted_at is null;
  else
    select f.folder_id, f.owner_id into v_parent, v_owner from public.storage_tool_files f where f.id = p_id and f.deleted_at is null;
  end if;
  if not found then return false; end if;
  if v_owner = p_user then return true; end if;
  if v_parent is null then return false; end if;
  return public._storage_tool_level(p_user, v_parent) >= 3;
end;
$$;
revoke all on function public._storage_tool_can_edit(uuid, text, uuid) from public, anon, authenticated;

-- ── 3. The Phase 1 and 2 functions, now aware of shared folders ──
-- A folder target of null always means "the top of MY storage".
create or replace function public.storage_tool_create_folder(p_parent_id uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_owner uuid := auth.uid();
  v_name text;
  v_id uuid;
  v_try integer := 0;
begin
  perform public._storage_tool_require();
  if p_parent_id is not null then
    select f.owner_id into v_owner from public.storage_tool_folders f where f.id = p_parent_id and f.deleted_at is null;
    if not found or public._storage_tool_level(v_me, p_parent_id) < 2 then raise exception 'That folder was not found.'; end if;
  end if;
  v_name := public._storage_tool_clean_name(p_name);
  loop
    v_try := v_try + 1;
    begin
      insert into public.storage_tool_folders (owner_id, parent_id, name)
      values (v_owner, p_parent_id, public._storage_tool_free_name(v_owner, p_parent_id, v_name, 'folder'))
      returning id, name into v_id, v_name;
      exit;
    exception when unique_violation then
      if v_try >= 5 then raise; end if;
    end;
  end loop;
  perform public._storage_tool_log(v_owner, 'folder_created', 'folder', v_id, v_name, p_parent_id);
  return jsonb_build_object('id', v_id, 'name', v_name);
end;
$$;

create or replace function public.storage_tool_register_file(p_file_id uuid, p_folder_id uuid, p_name text, p_mime text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_owner uuid := auth.uid();
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
    if v_row.uploaded_by is distinct from v_me and v_row.owner_id <> v_me then raise exception 'That file was not found.'; end if;
    return jsonb_build_object('id', v_row.id, 'name', v_row.name, 'size', v_row.size_bytes);      -- registering twice is harmless
  end if;
  if p_folder_id is not null then
    select f.owner_id into v_owner from public.storage_tool_folders f where f.id = p_folder_id and f.deleted_at is null;
    if not found or public._storage_tool_level(v_me, p_folder_id) < 2 then raise exception 'That folder was not found.'; end if;
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
      values (p_file_id, v_owner, p_folder_id, public._storage_tool_free_name(v_owner, p_folder_id, v_name, 'file'), v_size, v_mime, v_path, v_me)
      returning * into v_row;
      exit;
    exception when unique_violation then
      if v_try >= 5 or exists (select 1 from public.storage_tool_files f where f.id = p_file_id) then raise; end if;
    end;
  end loop;
  perform public._storage_tool_log(v_owner, 'file_uploaded', 'file', v_row.id, v_row.name, p_folder_id, jsonb_build_object('size', v_size));
  return jsonb_build_object('id', v_row.id, 'name', v_row.name, 'size', v_row.size_bytes);
end;
$$;

create or replace function public.storage_tool_rename(p_kind text, p_id uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_owner uuid;
  v_name text;
  v_old text;
  v_parent uuid;
  v_final text;
  v_try integer := 0;
begin
  perform public._storage_tool_require();
  v_name := public._storage_tool_clean_name(p_name);
  if p_kind not in ('file', 'folder') then raise exception 'Choose a file or a folder.'; end if;
  if not public._storage_tool_can_edit(v_me, p_kind, p_id) then raise exception 'That % was not found.', p_kind; end if;
  if p_kind = 'folder' then
    select f.name, f.parent_id, f.owner_id into v_old, v_parent, v_owner from public.storage_tool_folders f where f.id = p_id;
    loop
      v_try := v_try + 1;
      begin
        v_final := public._storage_tool_free_name_except(v_owner, v_parent, v_name, 'folder', p_id);
        update public.storage_tool_folders set name = v_final, updated_at = now() where id = p_id;
        exit;
      exception when unique_violation then
        if v_try >= 5 then raise; end if;
      end;
    end loop;
  else
    select f.name, f.folder_id, f.owner_id into v_old, v_parent, v_owner from public.storage_tool_files f where f.id = p_id;
    loop
      v_try := v_try + 1;
      begin
        v_final := public._storage_tool_free_name_except(v_owner, v_parent, v_name, 'file', p_id);
        update public.storage_tool_files set name = v_final, modified_at = now() where id = p_id;
        exit;
      exception when unique_violation then
        if v_try >= 5 then raise; end if;
      end;
    end loop;
  end if;
  perform public._storage_tool_log(v_owner, 'renamed', p_kind, p_id, v_final, v_parent, jsonb_build_object('from', v_old, 'to', v_final));
  return jsonb_build_object('name', v_final);
end;
$$;

create or replace function public.storage_tool_move(p_items jsonb, p_target uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_target_owner uuid := auth.uid();
  it record;
  f public.storage_tool_folders%rowtype;
  x public.storage_tool_files%rowtype;
  v_name text;
  v_moved integer := 0;
  v_try integer;
begin
  perform public._storage_tool_require();
  if p_target is not null then
    select t.owner_id into v_target_owner from public.storage_tool_folders t where t.id = p_target and t.deleted_at is null;
    if not found or public._storage_tool_level(v_me, p_target) < 3 then raise exception 'The folder you chose was not found.'; end if;
  end if;
  for it in select * from public._storage_tool_items(p_items) loop
    if it.kind = 'folder' then
      select * into f from public.storage_tool_folders t where t.id = it.id and t.deleted_at is null;
      if not found or not public._storage_tool_can_edit(v_me, 'folder', it.id) then raise exception 'A folder you chose was not found.'; end if;
      if f.owner_id <> v_target_owner then raise exception 'Items can only be moved inside the same storage.'; end if;
      if f.parent_id is not distinct from p_target then continue; end if;
      if p_target is not null and exists (select 1 from public._storage_tool_descendants(f.id) d where d = p_target) then
        raise exception 'A folder cannot be moved into itself or into one of its own folders.';
      end if;
      v_try := 0;
      loop
        v_try := v_try + 1;
        begin
          v_name := public._storage_tool_free_name_except(v_target_owner, p_target, f.name, 'folder', f.id);
          update public.storage_tool_folders set parent_id = p_target, name = v_name, updated_at = now() where id = f.id;
          exit;
        exception when unique_violation then
          if v_try >= 5 then raise; end if;
        end;
      end loop;
      perform public._storage_tool_log(v_target_owner, 'moved', 'folder', f.id, v_name, p_target, jsonb_build_object('from', f.parent_id));
    else
      select * into x from public.storage_tool_files t where t.id = it.id and t.deleted_at is null;
      if not found or not public._storage_tool_can_edit(v_me, 'file', it.id) then raise exception 'A file you chose was not found.'; end if;
      if x.owner_id <> v_target_owner then raise exception 'Items can only be moved inside the same storage.'; end if;
      if x.folder_id is not distinct from p_target then continue; end if;
      v_try := 0;
      loop
        v_try := v_try + 1;
        begin
          v_name := public._storage_tool_free_name_except(v_target_owner, p_target, x.name, 'file', x.id);
          update public.storage_tool_files set folder_id = p_target, name = v_name, modified_at = now() where id = x.id;
          exit;
        exception when unique_violation then
          if v_try >= 5 then raise; end if;
        end;
      end loop;
      perform public._storage_tool_log(v_target_owner, 'moved', 'file', x.id, v_name, p_target, jsonb_build_object('from', x.folder_id));
    end if;
    v_moved := v_moved + 1;
  end loop;
  return jsonb_build_object('moved', v_moved);
end;
$$;

create or replace function public.storage_tool_trash(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_now timestamptz := now();
  it record;
  f public.storage_tool_folders%rowtype;
  x public.storage_tool_files%rowtype;
  v_ids uuid[];
  v_files integer;
  v_folders integer;
  v_roots integer := 0;
  v_total_files integer := 0;
begin
  perform public._storage_tool_require();
  for it in select * from public._storage_tool_items(p_items) loop
    if not public._storage_tool_can_edit(v_me, it.kind, it.id) then raise exception 'An item you chose was not found.'; end if;
    if it.kind = 'folder' then
      select * into f from public.storage_tool_folders t where t.id = it.id and t.deleted_at is null;
      select coalesce(array_agg(d), '{}') into v_ids from public._storage_tool_descendants(f.id) d;
      update public.storage_tool_folders set deleted_at = v_now, trashed_root_id = f.id where id = any (v_ids) and deleted_at is null;
      get diagnostics v_folders = row_count;
      update public.storage_tool_files set deleted_at = v_now, trashed_root_id = f.id where folder_id = any (v_ids) and deleted_at is null;
      get diagnostics v_files = row_count;
      v_total_files := v_total_files + v_files;
      perform public._storage_tool_log(f.owner_id, 'trashed', 'folder', f.id, f.name, f.parent_id, jsonb_build_object('files', v_files, 'folders', v_folders - 1));
    else
      select * into x from public.storage_tool_files t where t.id = it.id and t.deleted_at is null;
      update public.storage_tool_files set deleted_at = v_now, trashed_root_id = x.id where id = x.id;
      v_total_files := v_total_files + 1;
      perform public._storage_tool_log(x.owner_id, 'trashed', 'file', x.id, x.name, x.folder_id, '{}'::jsonb);
    end if;
    v_roots := v_roots + 1;
  end loop;
  return jsonb_build_object('trashed', v_roots, 'files', v_total_files);
end;
$$;

-- A folder and everything inside it, for anybody who may see it (copying out of a shared folder, ZIP downloads, the "Move to" picker inside a share).
create or replace function public.storage_tool_subtree(p_folder_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._storage_tool_require();
  if public._storage_tool_level(auth.uid(), p_folder_id) < 1 then raise exception 'That folder was not found.'; end if;
  return jsonb_build_object(
    'folders', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'parent_id', f.parent_id, 'name', f.name)) from public.storage_tool_folders f
        where f.deleted_at is null and f.id in (select d from public._storage_tool_descendants(p_folder_id) d)), '[]'::jsonb),
    'files', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'folder_id', x.folder_id, 'name', x.name, 'size_bytes', x.size_bytes, 'mime_type', x.mime_type, 'storage_path', x.storage_path)) from public.storage_tool_files x
        where x.deleted_at is null and x.folder_id in (select d from public._storage_tool_descendants(p_folder_id) d)), '[]'::jsonb));
end;
$$;

create or replace function public.storage_tool_details(p_kind text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  f public.storage_tool_folders%rowtype;
  x public.storage_tool_files%rowtype;
  v_ids uuid[];
begin
  perform public._storage_tool_require();
  if p_kind = 'file' then
    select * into x from public.storage_tool_files t where t.id = p_id and t.deleted_at is null;
    if not found or public._storage_tool_file_level(v_me, p_id) < 1 then raise exception 'That file was not found.'; end if;
    return jsonb_build_object('kind', 'file', 'name', x.name, 'size_bytes', x.size_bytes, 'mime_type', x.mime_type, 'location', public._storage_tool_location(x.folder_id),
      'uploaded_by', coalesce(nullif(x.uploader_label, ''), (select nullif(btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), '') from public.users u where u.id = x.uploaded_by), 'Staff'),
      'via_link', x.link_id is not null, 'created_at', x.created_at, 'modified_at', x.modified_at,
      'shared_with', case when x.owner_id = v_me then (select count(*) from public.storage_tool_shares s where s.kind = 'file' and s.item_id = x.id) else 0 end);
  elsif p_kind = 'folder' then
    select * into f from public.storage_tool_folders t where t.id = p_id and t.deleted_at is null;
    if not found or public._storage_tool_level(v_me, p_id) < 1 then raise exception 'That folder was not found.'; end if;
    select coalesce(array_agg(d), '{}') into v_ids from public._storage_tool_descendants(p_id) d;
    return jsonb_build_object('kind', 'folder', 'name', f.name, 'location', public._storage_tool_location(f.parent_id), 'created_at', f.created_at, 'modified_at', f.updated_at,
      'folders', (select count(*) from public.storage_tool_folders c where c.id = any (v_ids) and c.id <> p_id and c.deleted_at is null),
      'files', (select count(*) from public.storage_tool_files y where y.folder_id = any (v_ids) and y.deleted_at is null),
      'size_bytes', coalesce((select sum(y.size_bytes) from public.storage_tool_files y where y.folder_id = any (v_ids) and y.deleted_at is null), 0),
      'shared_with', case when f.owner_id = v_me then (select count(*) from public.storage_tool_shares s where s.kind = 'folder' and s.item_id = f.id) else 0 end,
      'links', case when f.owner_id = v_me then (select count(*) from public.storage_tool_links l where l.folder_id = f.id and l.status <> 'revoked') else 0 end);
  elsif p_kind = 'root' then
    return jsonb_build_object('kind', 'root', 'name', 'My storage', 'location', '',
      'folders', (select count(*) from public.storage_tool_folders c where c.owner_id = v_me and c.deleted_at is null),
      'files', (select count(*) from public.storage_tool_files y where y.owner_id = v_me and y.deleted_at is null),
      'size_bytes', coalesce((select sum(y.size_bytes) from public.storage_tool_files y where y.owner_id = v_me and y.deleted_at is null), 0));
  end if;
  raise exception 'Choose a file or a folder.';
end;
$$;

-- ── 4. Browsing: my own storage or a shared folder ──────────
-- p_folder_id null = the top of my storage. Returns the contents, what I may do (level 1-4), the owner's name and the path of the folders I may see.
create or replace function public.storage_tool_browse(p_folder_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_owner uuid := auth.uid();
  v_level integer := 4;
  v_path jsonb := '[]'::jsonb;
begin
  perform public._storage_tool_require();
  if p_folder_id is not null then
    v_level := public._storage_tool_level(v_me, p_folder_id);
    if v_level < 1 then raise exception 'That folder was not found.'; end if;
    select f.owner_id into v_owner from public.storage_tool_folders f where f.id = p_folder_id;
    with recursive up as (
      select f.id, f.name, f.parent_id, 1 as depth from public.storage_tool_folders f where f.id = p_folder_id
      union all
      select p.id, p.name, p.parent_id, up.depth + 1 from public.storage_tool_folders p join up on p.id = up.parent_id where up.depth < 100
    )
    select coalesce(jsonb_agg(jsonb_build_object('id', up.id, 'name', up.name) order by up.depth desc), '[]'::jsonb) into v_path from up where public._storage_tool_level(v_me, up.id) >= 1;
  end if;
  return jsonb_build_object(
    'level', v_level, 'owner_id', v_owner,
    'owner_name', coalesce((select nullif(btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), '') from public.users u where u.id = v_owner), 'Staff'),
    'path', v_path,
    'folders', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'created_at', f.created_at, 'updated_at', f.updated_at)) from public.storage_tool_folders f
        where f.owner_id = v_owner and f.parent_id is not distinct from p_folder_id and f.deleted_at is null), '[]'::jsonb),
    'files', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'size_bytes', x.size_bytes, 'mime_type', x.mime_type, 'storage_path', x.storage_path,
          'uploader_label', coalesce(nullif(x.uploader_label, ''), ''), 'created_at', x.created_at, 'modified_at', x.modified_at))
        from public.storage_tool_files x where x.owner_id = v_owner and x.folder_id is not distinct from p_folder_id and x.deleted_at is null), '[]'::jsonb));
end;
$$;
revoke all on function public.storage_tool_browse(uuid) from public, anon;
grant execute on function public.storage_tool_browse(uuid) to authenticated;

-- What was shared WITH me: the shared folders and files (not what is inside them), newest first.
create or replace function public.storage_tool_shared_with_me()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._storage_tool_require();
  return coalesce((
    select jsonb_agg(r order by (r ->> 'shared_at') desc) from (
      select jsonb_build_object('kind', 'folder', 'id', f.id, 'name', f.name, 'permission', s.permission, 'owner_name', coalesce(nullif(btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), ''), 'Staff'),
        'size_bytes', 0, 'mime_type', '', 'storage_path', '', 'shared_at', s.created_at) as r
      from public.storage_tool_shares s join public.storage_tool_folders f on f.id = s.item_id and s.kind = 'folder' and f.deleted_at is null join public.users u on u.id = s.owner_id
      where s.shared_with = auth.uid()
      union all
      select jsonb_build_object('kind', 'file', 'id', x.id, 'name', x.name, 'permission', s.permission, 'owner_name', coalesce(nullif(btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), ''), 'Staff'),
        'size_bytes', x.size_bytes, 'mime_type', x.mime_type, 'storage_path', x.storage_path, 'shared_at', s.created_at)
      from public.storage_tool_shares s join public.storage_tool_files x on x.id = s.item_id and s.kind = 'file' and x.deleted_at is null join public.users u on u.id = s.owner_id
      where s.shared_with = auth.uid()) q), '[]'::jsonb);
end;
$$;
revoke all on function public.storage_tool_shared_with_me() from public, anon;
grant execute on function public.storage_tool_shared_with_me() to authenticated;

-- ── 5. Storage rules by file row ────────────────────────────
create or replace function public._storage_tool_can_read_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (storage.foldername(p_name))[1] = auth.uid()::text
      or exists (select 1 from public.storage_tool_files f where f.storage_path = p_name and (f.owner_id = auth.uid() or public._storage_tool_file_level(auth.uid(), f.id) >= 1));   -- the owner also reads what is in their Trash (needed to delete it forever)
$$;
revoke all on function public._storage_tool_can_read_object(text) from public, anon;
grant execute on function public._storage_tool_can_read_object(text) to authenticated;

-- Only the owner of a file that is IN THE OWNER'S TRASH may remove its stored file (it may sit under somebody else's or a link's prefix).
create or replace function public._storage_tool_object_trashed(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.storage_tool_files f where f.storage_path = p_name and f.deleted_at is not null and f.owner_id = auth.uid());
$$;

drop policy if exists "storage tool reads own part" on storage.objects;
drop policy if exists "storage tool reads own or shared" on storage.objects;
create policy "storage tool reads own or shared" on storage.objects for select
  using (bucket_id = 'storage-tool' and public.can_use_storage_tool() and public._storage_tool_can_read_object(name));
drop policy if exists "storage tool removes trashed own part" on storage.objects;
drop policy if exists "storage tool removes own trashed files" on storage.objects;
create policy "storage tool removes own trashed files" on storage.objects for delete
  using (bucket_id = 'storage-tool' and public.can_use_storage_tool() and public._storage_tool_object_trashed(name));

-- ── 6. Sharing with staff ───────────────────────────────────
-- Staff who can use the tool (for the "share with ..." search), never me.
create or replace function public.storage_tool_staff_search(p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := lower(btrim(coalesce(p_query, '')));
begin
  perform public._storage_tool_require();
  if char_length(v_q) < 2 then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), 'username', u.username) order by lower(u.last_name), lower(u.first_name))
    from (select * from public.users x where x.id <> auth.uid()
          and (lower(x.username) = 'it.admin1' or exists (select 1 from public.staff_account_tags t where t.staff_id = x.id and t.tag_key = 'storage_tool'))
          and (strpos(lower(coalesce(x.first_name, '') || ' ' || coalesce(x.last_name, '')), v_q) > 0 or strpos(lower(coalesce(x.last_name, '') || ' ' || coalesce(x.first_name, '')), v_q) > 0 or strpos(lower(x.username), v_q) > 0)
          order by x.last_name limit 20) u), '[]'::jsonb);
end;
$$;
revoke all on function public.storage_tool_staff_search(text) from public, anon;
grant execute on function public.storage_tool_staff_search(text) to authenticated;

-- Share (or change the permission of) one item with one person. Only the owner can share; the person must be able to use the tool.
create or replace function public.storage_tool_share_set(p_kind text, p_id uuid, p_user uuid, p_permission text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_name text;
  v_existing text;
begin
  perform public._storage_tool_require();
  if p_kind not in ('file', 'folder') then raise exception 'Choose a file or a folder.'; end if;
  if p_permission not in ('view', 'upload', 'edit') then raise exception 'Choose view, upload or edit.'; end if;
  if p_kind = 'file' and p_permission = 'upload' then raise exception 'A file can be shared for viewing or editing.'; end if;
  if p_kind = 'folder' then
    select f.name into v_name from public.storage_tool_folders f where f.id = p_id and f.owner_id = v_me and f.deleted_at is null;
  else
    select f.name into v_name from public.storage_tool_files f where f.id = p_id and f.owner_id = v_me and f.deleted_at is null;
  end if;
  if not found then raise exception 'Only the owner can share this, and it was not found.'; end if;
  if p_user = v_me then raise exception 'You cannot share with yourself.'; end if;
  if not exists (select 1 from public.users u where u.id = p_user and (lower(u.username) = 'it.admin1' or exists (select 1 from public.staff_account_tags t where t.staff_id = u.id and t.tag_key = 'storage_tool'))) then
    raise exception 'That person cannot use the Storage Tool, so nothing can be shared with them.';
  end if;
  select s.permission into v_existing from public.storage_tool_shares s where s.kind = p_kind and s.item_id = p_id and s.shared_with = p_user;
  insert into public.storage_tool_shares (owner_id, kind, item_id, shared_with, permission, created_by) values (v_me, p_kind, p_id, p_user, p_permission, v_me)
  on conflict (kind, item_id, shared_with) do update set permission = excluded.permission;
  perform public._storage_tool_log(v_me, case when v_existing is null then 'shared' else 'share_changed' end, p_kind, p_id, v_name, null,
    jsonb_build_object('with', (select btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) from public.users u where u.id = p_user), 'permission', p_permission));
  if v_existing is null then
    insert into public.notifications (id, type, user_id, user_name, title, message, "timestamp", read, reference_id)
    values (gen_random_uuid(), 'storage', p_user, '', 'Storage Tool: something was shared with you',
      coalesce((select nullif(btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), '') from public.users u where u.id = v_me), 'A colleague') || ' shared the ' || p_kind || ' "' || v_name || '" with you (' || p_permission || '). Open Storage Tool, Shared with me.',
      now(), false, p_id::text);
  end if;
end;
$$;
revoke all on function public.storage_tool_share_set(text, uuid, uuid, text) from public, anon;
grant execute on function public.storage_tool_share_set(text, uuid, uuid, text) to authenticated;

create or replace function public.storage_tool_share_remove(p_kind text, p_id uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_name text;
begin
  perform public._storage_tool_require();
  delete from public.storage_tool_shares s where s.kind = p_kind and s.item_id = p_id and s.shared_with = p_user and (s.owner_id = v_me or s.shared_with = v_me);
  if found then
    select coalesce((select f.name from public.storage_tool_folders f where f.id = p_id), (select x.name from public.storage_tool_files x where x.id = p_id), '') into v_name;
    perform public._storage_tool_log((select coalesce((select f.owner_id from public.storage_tool_folders f where f.id = p_id), (select x.owner_id from public.storage_tool_files x where x.id = p_id), v_me)), 'share_removed', p_kind, p_id, v_name, null, '{}'::jsonb);
  end if;
end;
$$;
revoke all on function public.storage_tool_share_remove(text, uuid, uuid) from public, anon;
grant execute on function public.storage_tool_share_remove(text, uuid, uuid) to authenticated;

-- Who an item is shared with (owner only).
create or replace function public.storage_tool_shares_of(p_kind text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._storage_tool_require();
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', s.shared_with, 'name', btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), 'username', u.username, 'permission', s.permission, 'since', s.created_at) order by s.created_at)
    from public.storage_tool_shares s join public.users u on u.id = s.shared_with where s.kind = p_kind and s.item_id = p_id and s.owner_id = auth.uid()), '[]'::jsonb);
end;
$$;
revoke all on function public.storage_tool_shares_of(text, uuid) from public, anon;
grant execute on function public.storage_tool_shares_of(text, uuid) to authenticated;

-- ── 7. Upload links (made and managed by the owner) ─────────
create or replace function public._storage_tool_link_json(l public.storage_tool_links)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('id', l.id, 'folder_id', l.folder_id, 'folder_name', (select f.name from public.storage_tool_folders f where f.id = l.folder_id),
    'location', public._storage_tool_location(l.folder_id), 'token', l.token, 'title', l.title, 'instructions', l.instructions,
    'status', case when l.status = 'active' and l.expires_at is not null and l.expires_at <= now() then 'expired' else l.status end,
    'has_lock', l.lock_hash is not null, 'expires_at', l.expires_at, 'max_files_per_person', l.max_files_per_person, 'max_file_mb', l.max_file_mb,
    'allowed_types', to_jsonb(l.allowed_types), 'require_email', l.require_email, 'require_phone', l.require_phone, 'allow_subfolders', l.allow_subfolders,
    'created_at', l.created_at, 'updated_at', l.updated_at,
    'uploads', (select count(*) from public.storage_tool_files f where f.link_id = l.id and f.deleted_at is null),
    'visitors', (select count(*) from public.storage_tool_upload_sessions s where s.link_id = l.id and s.file_count > 0));
$$;
revoke all on function public._storage_tool_link_json(public.storage_tool_links) from public, anon, authenticated;

-- Settings (a jsonb so the website can send what it has): title, instructions, expires_at, max_files_per_person, max_file_mb, allowed_types[],
-- require_email, require_phone, allow_subfolders, and the lock key as lock_hash ("pbkdf2$..." made in the browser; '' removes the lock key, absent keeps it).
create or replace function public._storage_tool_link_apply(l public.storage_tool_links, p jsonb)
returns public.storage_tool_links
language plpgsql
stable
as $$
declare
  v_types text[];
begin
  if p ? 'title' then l.title := left(btrim(coalesce(p ->> 'title', '')), 120); end if;
  if p ? 'instructions' then l.instructions := left(btrim(coalesce(p ->> 'instructions', '')), 1000); end if;
  if p ? 'expires_at' then l.expires_at := nullif(p ->> 'expires_at', '')::timestamptz; end if;
  if p ? 'max_files_per_person' then
    l.max_files_per_person := nullif(p ->> 'max_files_per_person', '')::integer;
    if l.max_files_per_person is not null and (l.max_files_per_person < 1 or l.max_files_per_person > 1000) then raise exception 'Files per person must be between 1 and 1000.'; end if;
  end if;
  if p ? 'max_file_mb' then
    l.max_file_mb := (p ->> 'max_file_mb')::integer;
    if l.max_file_mb < 1 or l.max_file_mb > 500 then raise exception 'The biggest file must be between 1 and 500 MB.'; end if;
  end if;
  if p ? 'allowed_types' then
    select coalesce(array_agg(distinct lower(btrim(t))), '{}') into v_types from jsonb_array_elements_text(p -> 'allowed_types') t where btrim(t) ~ '^[A-Za-z0-9]{1,6}$';
    if cardinality(v_types) = 0 then raise exception 'Choose at least one file type.'; end if;
    l.allowed_types := v_types;
  end if;
  if p ? 'require_email' then l.require_email := coalesce((p ->> 'require_email')::boolean, false); end if;
  if p ? 'require_phone' then l.require_phone := coalesce((p ->> 'require_phone')::boolean, false); end if;
  if p ? 'allow_subfolders' then l.allow_subfolders := coalesce((p ->> 'allow_subfolders')::boolean, false); end if;
  if p ? 'lock_hash' then
    if coalesce(p ->> 'lock_hash', '') = '' then l.lock_hash := null;
    elsif (p ->> 'lock_hash') !~ '^pbkdf2\$[0-9]+\$[A-Za-z0-9+/=_-]+\$[A-Za-z0-9+/=_-]+$' then raise exception 'The lock key is not in the right form.';
    else l.lock_hash := p ->> 'lock_hash'; end if;
  end if;
  return l;
end;
$$;
revoke all on function public._storage_tool_link_apply(public.storage_tool_links, jsonb) from public, anon, authenticated;

create or replace function public.storage_tool_link_create(p_folder_id uuid, p_settings jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  l public.storage_tool_links%rowtype;
begin
  perform public._storage_tool_require();
  if not exists (select 1 from public.storage_tool_folders f where f.id = p_folder_id and f.owner_id = v_me and f.deleted_at is null) then raise exception 'Only the owner of a folder can make an upload link for it.'; end if;
  l.id := gen_random_uuid(); l.owner_id := v_me; l.folder_id := p_folder_id; l.created_by := v_me; l.status := 'active';
  l.token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  l.title := ''; l.instructions := ''; l.max_file_mb := 50; l.allowed_types := array['pdf', 'jpg', 'png', 'docx', 'xlsx'];
  l.require_email := false; l.require_phone := false; l.allow_subfolders := false; l.created_at := now(); l.updated_at := now();
  l := public._storage_tool_link_apply(l, coalesce(p_settings, '{}'::jsonb));
  insert into public.storage_tool_links values (l.*);
  perform public._storage_tool_log(v_me, 'link_created', 'folder', p_folder_id, (select f.name from public.storage_tool_folders f where f.id = p_folder_id), null, jsonb_build_object('title', l.title));
  return public._storage_tool_link_json(l);
end;
$$;
revoke all on function public.storage_tool_link_create(uuid, jsonb) from public, anon;
grant execute on function public.storage_tool_link_create(uuid, jsonb) to authenticated;

create or replace function public.storage_tool_link_update(p_id uuid, p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.storage_tool_links%rowtype;
begin
  perform public._storage_tool_require();
  select * into l from public.storage_tool_links x where x.id = p_id and x.owner_id = auth.uid();
  if not found then raise exception 'That link was not found.'; end if;
  if l.status = 'revoked' then raise exception 'A revoked link cannot be changed. Make a new link instead.'; end if;
  l := public._storage_tool_link_apply(l, coalesce(p_settings, '{}'::jsonb));
  l.updated_at := now();
  update public.storage_tool_links set title = l.title, instructions = l.instructions, expires_at = l.expires_at, max_files_per_person = l.max_files_per_person, max_file_mb = l.max_file_mb,
    allowed_types = l.allowed_types, require_email = l.require_email, require_phone = l.require_phone, allow_subfolders = l.allow_subfolders, lock_hash = l.lock_hash, updated_at = l.updated_at where id = p_id;
  perform public._storage_tool_log(l.owner_id, 'link_changed', 'folder', l.folder_id, (select f.name from public.storage_tool_folders f where f.id = l.folder_id), null, '{}'::jsonb);
  return public._storage_tool_link_json(l);
end;
$$;
revoke all on function public.storage_tool_link_update(uuid, jsonb) from public, anon;
grant execute on function public.storage_tool_link_update(uuid, jsonb) to authenticated;

-- 'active' <-> 'paused', or 'revoked' (final).
create or replace function public.storage_tool_link_set_status(p_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.storage_tool_links%rowtype;
begin
  perform public._storage_tool_require();
  if p_status not in ('active', 'paused', 'revoked') then raise exception 'Choose active, paused or revoked.'; end if;
  select * into l from public.storage_tool_links x where x.id = p_id and x.owner_id = auth.uid();
  if not found then raise exception 'That link was not found.'; end if;
  if l.status = 'revoked' then raise exception 'A revoked link stays revoked. Make a new link instead.'; end if;
  update public.storage_tool_links set status = p_status, updated_at = now() where id = p_id returning * into l;
  perform public._storage_tool_log(l.owner_id, case p_status when 'revoked' then 'link_revoked' when 'paused' then 'link_paused' else 'link_resumed' end, 'folder', l.folder_id,
    (select f.name from public.storage_tool_folders f where f.id = l.folder_id), null, '{}'::jsonb);
  return public._storage_tool_link_json(l);
end;
$$;
revoke all on function public.storage_tool_link_set_status(uuid, text) from public, anon;
grant execute on function public.storage_tool_link_set_status(uuid, text) to authenticated;

create or replace function public.storage_tool_links_list(p_folder_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._storage_tool_require();
  return coalesce((select jsonb_agg(public._storage_tool_link_json(l) order by l.created_at desc) from public.storage_tool_links l
    where l.owner_id = auth.uid() and (p_folder_id is null or l.folder_id = p_folder_id)), '[]'::jsonb);
end;
$$;
revoke all on function public.storage_tool_links_list(uuid) from public, anon;
grant execute on function public.storage_tool_links_list(uuid) to authenticated;

-- Who uploaded what through one link: one line per visitor.
create or replace function public.storage_tool_link_visitors(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._storage_tool_require();
  if not exists (select 1 from public.storage_tool_links l where l.id = p_id and l.owner_id = auth.uid()) then raise exception 'That link was not found.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('name', s.uploader_name, 'email', s.uploader_email, 'phone', s.uploader_phone, 'first_at', s.created_at, 'last_at', s.last_upload_at, 'files', s.file_count) order by s.last_upload_at desc nulls last)
    from public.storage_tool_upload_sessions s where s.link_id = p_id and s.file_count > 0), '[]'::jsonb);
end;
$$;
revoke all on function public.storage_tool_link_visitors(uuid) from public, anon;
grant execute on function public.storage_tool_link_visitors(uuid) to authenticated;

-- ── 8. For the server function (service role only) ──────────
create or replace function public.storage_tool_public_link_get(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  l public.storage_tool_links%rowtype;
begin
  select * into l from public.storage_tool_links x where x.token = p_token;
  if not found then return jsonb_build_object('found', false); end if;
  return jsonb_build_object('found', true, 'id', l.id, 'owner_id', l.owner_id, 'folder_id', l.folder_id, 'folder_name', (select f.name from public.storage_tool_folders f where f.id = l.folder_id and f.deleted_at is null),
    'folder_ok', exists (select 1 from public.storage_tool_folders f where f.id = l.folder_id and f.deleted_at is null),
    'title', l.title, 'instructions', l.instructions, 'lock_hash', l.lock_hash,
    'status', case when l.status = 'active' and l.expires_at is not null and l.expires_at <= now() then 'expired' else l.status end,
    'max_files_per_person', l.max_files_per_person, 'max_file_mb', l.max_file_mb, 'allowed_types', to_jsonb(l.allowed_types), 'require_email', l.require_email, 'require_phone', l.require_phone, 'allow_subfolders', l.allow_subfolders,
    'subfolders', case when l.allow_subfolders then coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'location', replace(public._storage_tool_location(f.id), 'My storage / ' || (select f2.name from public.storage_tool_folders f2 where f2.id = l.folder_id) || ' / ', '')) order by lower(f.name))
        from public.storage_tool_folders f where f.deleted_at is null and f.id <> l.folder_id and f.id in (select d from public._storage_tool_descendants(l.folder_id) d)), '[]'::jsonb) else '[]'::jsonb end);
end;
$$;
revoke all on function public.storage_tool_public_link_get(text) from public, anon, authenticated;
grant execute on function public.storage_tool_public_link_get(text) to service_role;

-- Rate limit: true (and recorded) when the visitor's address is within the limits for that kind of call, false when they are over.
create or replace function public.storage_tool_public_rate(p_link_id uuid, p_ip_hash text, p_kind text, p_per_hour integer, p_per_day integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hour integer;
  v_day integer;
begin
  select count(*) filter (where e.at > now() - interval '1 hour'), count(*) into v_hour, v_day from public.storage_tool_public_events e
    where e.link_id = p_link_id and e.ip_hash = p_ip_hash and e.kind = p_kind and e.at > now() - interval '1 day';
  if v_hour >= p_per_hour or v_day >= p_per_day then return false; end if;
  insert into public.storage_tool_public_events (link_id, ip_hash, kind) values (p_link_id, p_ip_hash, p_kind);
  delete from public.storage_tool_public_events where at < now() - interval '2 days';
  return true;
end;
$$;
revoke all on function public.storage_tool_public_rate(uuid, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.storage_tool_public_rate(uuid, text, text, integer, integer) to service_role;

create or replace function public.storage_tool_public_session_create(p_link_id uuid, p_name text, p_email text, p_phone text, p_session_hash text, p_ip_hash text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.storage_tool_links%rowtype;
  v_id uuid;
begin
  select * into l from public.storage_tool_links x where x.id = p_link_id;
  if not found or l.status <> 'active' or (l.expires_at is not null and l.expires_at <= now()) then raise exception 'This upload link is no longer active.'; end if;
  if char_length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'Please type your name.'; end if;
  if l.require_email and position('@' in coalesce(p_email, '')) < 2 then raise exception 'Please type your email address.'; end if;
  if l.require_phone and char_length(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')) < 7 then raise exception 'Please type your phone number.'; end if;
  insert into public.storage_tool_upload_sessions (link_id, uploader_name, uploader_email, uploader_phone, session_hash, ip_hash)
  values (p_link_id, left(btrim(p_name), 120), left(btrim(coalesce(p_email, '')), 200), left(btrim(coalesce(p_phone, '')), 40), p_session_hash, coalesce(p_ip_hash, '')) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.storage_tool_public_session_create(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.storage_tool_public_session_create(uuid, text, text, text, text, text) to service_role;

create or replace function public.storage_tool_public_session_get(p_session_hash text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select jsonb_build_object('id', s.id, 'link_id', s.link_id, 'name', s.uploader_name, 'file_count', s.file_count, 'created_at', s.created_at) from public.storage_tool_upload_sessions s
    where s.session_hash = p_session_hash and s.created_at > now() - interval '12 hours'), jsonb_build_object());
$$;
revoke all on function public.storage_tool_public_session_get(text) from public, anon, authenticated;
grant execute on function public.storage_tool_public_session_get(text) to service_role;

-- The server function has checked the stored file's size and type; this makes it part of the folder (owner = the folder's owner).
create or replace function public.storage_tool_public_register(p_session_id uuid, p_file_id uuid, p_folder_id uuid, p_name text, p_mime text, p_size bigint, p_storage_path text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.storage_tool_upload_sessions%rowtype;
  l public.storage_tool_links%rowtype;
  v_folder uuid;
  v_name text;
  v_row public.storage_tool_files%rowtype;
  v_quota bigint;
  v_used bigint;
  v_try integer := 0;
begin
  select * into s from public.storage_tool_upload_sessions x where x.id = p_session_id for update;
  if not found then raise exception 'Your visit has expired. Please open the link again.'; end if;
  select * into l from public.storage_tool_links x where x.id = s.link_id;
  if l.status <> 'active' or (l.expires_at is not null and l.expires_at <= now()) then raise exception 'This upload link is no longer active.'; end if;
  if l.max_files_per_person is not null and s.file_count >= l.max_files_per_person then raise exception 'You have reached the limit of % files for this link.', l.max_files_per_person; end if;
  if p_size > l.max_file_mb::bigint * 1048576 then raise exception 'This file is larger than the allowed % MB.', l.max_file_mb; end if;
  v_folder := coalesce(p_folder_id, l.folder_id);
  if v_folder <> l.folder_id and not (l.allow_subfolders and exists (select 1 from public._storage_tool_descendants(l.folder_id) d where d = v_folder)) then raise exception 'That folder is not part of this link.'; end if;
  if not exists (select 1 from public.storage_tool_folders f where f.id = v_folder and f.deleted_at is null) then raise exception 'This upload link is no longer active.'; end if;
  select st.total_quota_gb::bigint * 1073741824 into v_quota from public.storage_tool_settings st where st.id;
  select coalesce(sum(f.size_bytes), 0) into v_used from public.storage_tool_files f;
  if v_used + p_size > v_quota then raise exception 'The storage is full. Please tell the person who sent you this link.'; end if;
  v_name := public._storage_tool_clean_name(p_name);
  loop
    v_try := v_try + 1;
    begin
      insert into public.storage_tool_files (id, owner_id, folder_id, name, size_bytes, mime_type, storage_path, uploaded_by, uploader_label, link_id, session_id)
      values (p_file_id, l.owner_id, v_folder, public._storage_tool_free_name(l.owner_id, v_folder, v_name, 'file'), p_size, left(coalesce(nullif(btrim(p_mime), ''), 'application/octet-stream'), 200), p_storage_path, null, s.uploader_name, l.id, s.id)
      returning * into v_row;
      exit;
    exception when unique_violation then
      if v_try >= 5 or exists (select 1 from public.storage_tool_files f where f.id = p_file_id) then raise; end if;
    end;
  end loop;
  update public.storage_tool_upload_sessions set file_count = file_count + 1, last_upload_at = now() where id = s.id;
  insert into public.storage_tool_activity (owner_id, actor_label, action, target_kind, target_id, target_name, folder_id, detail)
    values (l.owner_id, s.uploader_name || ' (via link)', 'file_uploaded', 'file', v_row.id, v_row.name, v_folder, jsonb_build_object('size', p_size, 'link', l.id));
  return jsonb_build_object('id', v_row.id, 'name', v_row.name, 'size', v_row.size_bytes);
end;
$$;
revoke all on function public.storage_tool_public_register(uuid, uuid, uuid, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.storage_tool_public_register(uuid, uuid, uuid, text, text, bigint, text) to service_role;

create or replace function public.storage_tool_public_mine(p_session_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', f.name, 'size_bytes', f.size_bytes, 'at', f.created_at) order by f.created_at desc), '[]'::jsonb)
  from public.storage_tool_files f where f.session_id = p_session_id and f.deleted_at is null;
$$;
revoke all on function public.storage_tool_public_mine(uuid) from public, anon, authenticated;
grant execute on function public.storage_tool_public_mine(uuid) to service_role;

-- ── 9. Notices: one per visit, about a minute after the last file ──
create or replace function public.storage_tool_notify_uploads()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_sent integer := 0;
  v_new integer;
begin
  for r in
    select s.id, s.uploader_name, s.file_count, s.notified_count, l.owner_id, l.title, (select f.name from public.storage_tool_folders f where f.id = l.folder_id) as folder_name, l.id as link_id
    from public.storage_tool_upload_sessions s join public.storage_tool_links l on l.id = s.link_id
    where s.file_count > s.notified_count and s.last_upload_at < now() - interval '1 minute'
    for update of s skip locked
  loop
    v_new := r.file_count - r.notified_count;
    insert into public.notifications (id, type, user_id, user_name, title, message, "timestamp", read, reference_id)
    values (gen_random_uuid(), 'storage', r.owner_id, '', 'Storage Tool: new uploads',
      r.uploader_name || ' uploaded ' || v_new || case when v_new = 1 then ' file' else ' files' end || ' to "' || coalesce(r.folder_name, 'a folder') || '"' || case when r.title <> '' then ' (' || r.title || ')' else '' end || ' through your upload link.',
      now(), false, r.link_id::text);
    update public.storage_tool_upload_sessions set notified_count = r.file_count where id = r.id;
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end;
$$;
revoke all on function public.storage_tool_notify_uploads() from public, anon, authenticated;
grant execute on function public.storage_tool_notify_uploads() to service_role;

-- The timer for those notices (every minute, inside the database: no function or secret needed). Needs pg_cron; safe to run again.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'storage-tool-notices';
    perform cron.schedule('storage-tool-notices', '* * * * *', 'select public.storage_tool_notify_uploads()');
  end if;
end $$;

notify pgrst, 'reload schema';

-- Result check (shown in the SQL editor)
select (select count(*) from public.storage_tool_links) as upload_links, (select count(*) from public.storage_tool_shares) as shares,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'storage_tool_%') as storage_tool_functions;
