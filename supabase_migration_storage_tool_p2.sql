-- ─────────────────────────────────────────────────────────────
-- supabase_migration_storage_tool_p2.sql
--
-- Storage Tool, PHASE 2: organizing. Rename, move, search, details, Trash (restore, delete forever, the automatic 30-day clean-up), and what the
-- website needs for copying and for ZIP downloads. Run AFTER supabase_migration_storage_tool_p1.sql. Additive and safe to run twice.
--
--   1. Rename and move (files and folders, one or many at once). A folder cannot be moved into itself or into one of its own folders. A name that is
--      already taken in the new place gets " (1)", " (2)" ... (nothing is overwritten).
--   2. Trash: "Delete" only marks items as deleted (a folder takes everything inside it along, as ONE item in Trash). Restore puts them back where they
--      were (at the top of the storage if their folder is gone or is itself in Trash; a number is added if the name is taken). "Delete forever" and
--      the automatic clean-up after the days in Trash (settings, 30) remove the stored files for real.
--   3. Search by name, details of a file or folder, the folder tree (for "Move to ..."), the contents of a folder (for copying and ZIP downloads).
--   4. The automatic clean-up: storage_tool_purge_claim / _finish (only the server function "storage-tool-purge" may call them, using the service
--      role) and storage_tool_purge_schedule(url, secret) which starts the hourly timer (pg_cron + pg_net), like the push timer of Renewal.
--   5. One more storage rule: a person may remove the stored file of an item that is IN THEIR TRASH (this is how "Delete forever" works). A file that
--      is not in Trash still cannot be removed from storage by anybody.
-- Copying is done by the website with the storage service's own copy (the file never leaves storage) and then registered like an upload.
-- ─────────────────────────────────────────────────────────────

-- ── 1. Helpers ──────────────────────────────────────────────
-- The folder and every folder inside it (callers check ownership of the root first).
create or replace function public._storage_tool_descendants(p_root uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  with recursive d as (
    select f.id from public.storage_tool_folders f where f.id = p_root
    union all
    select c.id from public.storage_tool_folders c join d on c.parent_id = d.id
  )
  select id from d;
$$;
revoke all on function public._storage_tool_descendants(uuid) from public, anon, authenticated;

-- "My storage / Reports / 2026" for a folder (whatever its state), "My storage" for the top.
create or replace function public._storage_tool_location(p_folder uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  with recursive up as (
    select f.id, f.name, f.parent_id, 1 as depth from public.storage_tool_folders f where f.id = p_folder
    union all
    select p.id, p.name, p.parent_id, up.depth + 1 from public.storage_tool_folders p join up on p.id = up.parent_id where up.depth < 100
  )
  select coalesce('My storage / ' || string_agg(name, ' / ' order by depth desc), 'My storage') from up;
$$;
revoke all on function public._storage_tool_location(uuid) from public, anon, authenticated;

-- Like _storage_tool_free_name, but an item does not count against its own name (renaming "a.pdf" to "A.pdf", moving inside a folder).
create or replace function public._storage_tool_free_name_except(p_owner uuid, p_parent uuid, p_name text, p_kind text, p_except uuid)
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
  v_none uuid := '00000000-0000-0000-0000-000000000000';
begin
  if p_kind = 'file' then
    v_dot := length(p_name) - position('.' in reverse(p_name)) + 1;
    if position('.' in p_name) > 1 and v_dot > 1 and v_dot < length(p_name) then v_stem := left(p_name, v_dot - 1); v_ext := substr(p_name, v_dot); end if;
  end if;
  loop
    if p_kind = 'file' then
      select exists (select 1 from public.storage_tool_files f where f.owner_id = p_owner and f.folder_id is not distinct from p_parent and lower(f.name) = lower(v_candidate) and f.deleted_at is null and f.id <> coalesce(p_except, v_none)) into v_taken;
    else
      select exists (select 1 from public.storage_tool_folders f where f.owner_id = p_owner and f.parent_id is not distinct from p_parent and lower(f.name) = lower(v_candidate) and f.deleted_at is null and f.id <> coalesce(p_except, v_none)) into v_taken;
    end if;
    exit when not v_taken;
    v_n := v_n + 1;
    if v_n > 5000 then raise exception 'Too many items with this name.'; end if;
    v_candidate := left(v_stem, 255 - length(v_ext) - length(' (' || v_n || ')')) || ' (' || v_n || ')' || v_ext;
  end loop;
  return v_candidate;
end;
$$;
revoke all on function public._storage_tool_free_name_except(uuid, uuid, text, text, uuid) from public, anon, authenticated;

-- The items the website sends: [{"kind": "file" | "folder", "id": "<uuid>"}, ...]  (at most 1000)
create or replace function public._storage_tool_items(p_items jsonb)
returns table(kind text, id uuid)
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'Nothing was chosen.'; end if;
  if jsonb_array_length(p_items) = 0 then raise exception 'Nothing was chosen.'; end if;
  if jsonb_array_length(p_items) > 1000 then raise exception 'Please choose at most 1000 items at a time.'; end if;
  return query
  select (x ->> 'kind'), (x ->> 'id')::uuid from jsonb_array_elements(p_items) x
  where (x ->> 'kind') in ('file', 'folder');
end;
$$;
revoke all on function public._storage_tool_items(jsonb) from public, anon, authenticated;

-- ── 2. Rename and move ──────────────────────────────────────
create or replace function public.storage_tool_rename(p_kind text, p_id uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_name text;
  v_old text;
  v_parent uuid;
  v_final text;
  v_try integer := 0;
begin
  perform public._storage_tool_require();
  v_name := public._storage_tool_clean_name(p_name);
  if p_kind = 'folder' then
    select f.name, f.parent_id into v_old, v_parent from public.storage_tool_folders f where f.id = p_id and f.owner_id = v_me and f.deleted_at is null;
    if not found then raise exception 'That folder was not found.'; end if;
    loop
      v_try := v_try + 1;
      begin
        v_final := public._storage_tool_free_name_except(v_me, v_parent, v_name, 'folder', p_id);
        update public.storage_tool_folders set name = v_final, updated_at = now() where id = p_id;
        exit;
      exception when unique_violation then
        if v_try >= 5 then raise; end if;
      end;
    end loop;
  elsif p_kind = 'file' then
    select f.name, f.folder_id into v_old, v_parent from public.storage_tool_files f where f.id = p_id and f.owner_id = v_me and f.deleted_at is null;
    if not found then raise exception 'That file was not found.'; end if;
    loop
      v_try := v_try + 1;
      begin
        v_final := public._storage_tool_free_name_except(v_me, v_parent, v_name, 'file', p_id);
        update public.storage_tool_files set name = v_final, modified_at = now() where id = p_id;
        exit;
      exception when unique_violation then
        if v_try >= 5 then raise; end if;
      end;
    end loop;
  else
    raise exception 'Choose a file or a folder.';
  end if;
  perform public._storage_tool_log(v_me, 'renamed', p_kind, p_id, v_final, v_parent, jsonb_build_object('from', v_old, 'to', v_final));
  return jsonb_build_object('name', v_final);
end;
$$;
revoke all on function public.storage_tool_rename(text, uuid, text) from public, anon;
grant execute on function public.storage_tool_rename(text, uuid, text) to authenticated;

create or replace function public.storage_tool_move(p_items jsonb, p_target uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  it record;
  f public.storage_tool_folders%rowtype;
  x public.storage_tool_files%rowtype;
  v_name text;
  v_moved integer := 0;
  v_try integer;
begin
  perform public._storage_tool_require();
  if p_target is not null and not exists (select 1 from public.storage_tool_folders t where t.id = p_target and t.owner_id = v_me and t.deleted_at is null) then
    raise exception 'The folder you chose was not found.';
  end if;
  for it in select * from public._storage_tool_items(p_items) loop
    if it.kind = 'folder' then
      select * into f from public.storage_tool_folders t where t.id = it.id and t.owner_id = v_me and t.deleted_at is null;
      if not found then raise exception 'A folder you chose was not found.'; end if;
      if f.parent_id is not distinct from p_target then continue; end if;
      if p_target is not null and exists (select 1 from public._storage_tool_descendants(f.id) d where d = p_target) then
        raise exception 'A folder cannot be moved into itself or into one of its own folders.';
      end if;
      v_try := 0;
      loop
        v_try := v_try + 1;
        begin
          v_name := public._storage_tool_free_name_except(v_me, p_target, f.name, 'folder', f.id);
          update public.storage_tool_folders set parent_id = p_target, name = v_name, updated_at = now() where id = f.id;
          exit;
        exception when unique_violation then
          if v_try >= 5 then raise; end if;
        end;
      end loop;
      perform public._storage_tool_log(v_me, 'moved', 'folder', f.id, v_name, p_target, jsonb_build_object('from', f.parent_id));
    else
      select * into x from public.storage_tool_files t where t.id = it.id and t.owner_id = v_me and t.deleted_at is null;
      if not found then raise exception 'A file you chose was not found.'; end if;
      if x.folder_id is not distinct from p_target then continue; end if;
      v_try := 0;
      loop
        v_try := v_try + 1;
        begin
          v_name := public._storage_tool_free_name_except(v_me, p_target, x.name, 'file', x.id);
          update public.storage_tool_files set folder_id = p_target, name = v_name, modified_at = now() where id = x.id;
          exit;
        exception when unique_violation then
          if v_try >= 5 then raise; end if;
        end;
      end loop;
      perform public._storage_tool_log(v_me, 'moved', 'file', x.id, v_name, p_target, jsonb_build_object('from', x.folder_id));
    end if;
    v_moved := v_moved + 1;
  end loop;
  return jsonb_build_object('moved', v_moved);
end;
$$;
revoke all on function public.storage_tool_move(jsonb, uuid) from public, anon;
grant execute on function public.storage_tool_move(jsonb, uuid) to authenticated;

-- ── 3. Looking at things: tree, contents, search, details ───
create or replace function public.storage_tool_folder_tree()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._storage_tool_require();
  return coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'parent_id', f.parent_id, 'name', f.name) order by lower(f.name)) from public.storage_tool_folders f where f.owner_id = auth.uid() and f.deleted_at is null), '[]'::jsonb);
end;
$$;
revoke all on function public.storage_tool_folder_tree() from public, anon;
grant execute on function public.storage_tool_folder_tree() to authenticated;

-- A folder and everything inside it (for copying a folder and for a ZIP download).
create or replace function public.storage_tool_subtree(p_folder_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  perform public._storage_tool_require();
  if not exists (select 1 from public.storage_tool_folders f where f.id = p_folder_id and f.owner_id = v_me and f.deleted_at is null) then raise exception 'That folder was not found.'; end if;
  return jsonb_build_object(
    'folders', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'parent_id', f.parent_id, 'name', f.name)) from public.storage_tool_folders f
        where f.owner_id = v_me and f.deleted_at is null and f.id in (select d from public._storage_tool_descendants(p_folder_id) d)), '[]'::jsonb),
    'files', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'folder_id', x.folder_id, 'name', x.name, 'size_bytes', x.size_bytes, 'mime_type', x.mime_type, 'storage_path', x.storage_path)) from public.storage_tool_files x
        where x.owner_id = v_me and x.deleted_at is null and x.folder_id in (select d from public._storage_tool_descendants(p_folder_id) d)), '[]'::jsonb));
end;
$$;
revoke all on function public.storage_tool_subtree(uuid) from public, anon;
grant execute on function public.storage_tool_subtree(uuid) to authenticated;

create or replace function public.storage_tool_search(p_query text)
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
  return coalesce((
    select jsonb_agg(r order by r ->> 'kind' desc, lower(r ->> 'name')) from (
      select jsonb_build_object('kind', 'folder', 'id', f.id, 'name', f.name, 'folder_id', f.parent_id, 'location', public._storage_tool_location(f.parent_id), 'size_bytes', 0, 'mime_type', '', 'storage_path', '', 'modified_at', f.updated_at) as r
      from public.storage_tool_folders f where f.owner_id = auth.uid() and f.deleted_at is null and strpos(lower(f.name), v_q) > 0
      union all
      select jsonb_build_object('kind', 'file', 'id', x.id, 'name', x.name, 'folder_id', x.folder_id, 'location', public._storage_tool_location(x.folder_id), 'size_bytes', x.size_bytes, 'mime_type', x.mime_type, 'storage_path', x.storage_path, 'modified_at', x.modified_at)
      from public.storage_tool_files x where x.owner_id = auth.uid() and x.deleted_at is null and strpos(lower(x.name), v_q) > 0
      limit 100) s), '[]'::jsonb);
end;
$$;
revoke all on function public.storage_tool_search(text) from public, anon;
grant execute on function public.storage_tool_search(text) to authenticated;

-- Details of a file or folder; kind 'root' = the whole of my storage.
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
    select * into x from public.storage_tool_files t where t.id = p_id and t.owner_id = v_me and t.deleted_at is null;
    if not found then raise exception 'That file was not found.'; end if;
    return jsonb_build_object('kind', 'file', 'name', x.name, 'size_bytes', x.size_bytes, 'mime_type', x.mime_type, 'location', public._storage_tool_location(x.folder_id),
      'uploaded_by', coalesce(nullif(x.uploader_label, ''), (select nullif(btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), '') from public.users u where u.id = x.uploaded_by), 'Staff'),
      'created_at', x.created_at, 'modified_at', x.modified_at);
  elsif p_kind = 'folder' then
    select * into f from public.storage_tool_folders t where t.id = p_id and t.owner_id = v_me and t.deleted_at is null;
    if not found then raise exception 'That folder was not found.'; end if;
    select coalesce(array_agg(d), '{}') into v_ids from public._storage_tool_descendants(p_id) d;
    return jsonb_build_object('kind', 'folder', 'name', f.name, 'location', public._storage_tool_location(f.parent_id), 'created_at', f.created_at, 'modified_at', f.updated_at,
      'folders', (select count(*) from public.storage_tool_folders c where c.id = any (v_ids) and c.id <> p_id and c.deleted_at is null),
      'files', (select count(*) from public.storage_tool_files y where y.folder_id = any (v_ids) and y.deleted_at is null),
      'size_bytes', coalesce((select sum(y.size_bytes) from public.storage_tool_files y where y.folder_id = any (v_ids) and y.deleted_at is null), 0));
  elsif p_kind = 'root' then
    return jsonb_build_object('kind', 'root', 'name', 'My storage', 'location', '',
      'folders', (select count(*) from public.storage_tool_folders c where c.owner_id = v_me and c.deleted_at is null),
      'files', (select count(*) from public.storage_tool_files y where y.owner_id = v_me and y.deleted_at is null),
      'size_bytes', coalesce((select sum(y.size_bytes) from public.storage_tool_files y where y.owner_id = v_me and y.deleted_at is null), 0));
  end if;
  raise exception 'Choose a file or a folder.';
end;
$$;
revoke all on function public.storage_tool_details(text, uuid) from public, anon;
grant execute on function public.storage_tool_details(text, uuid) to authenticated;

-- ── 4. Trash ────────────────────────────────────────────────
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
    if it.kind = 'folder' then
      select * into f from public.storage_tool_folders t where t.id = it.id and t.owner_id = v_me and t.deleted_at is null;
      if not found then raise exception 'A folder you chose was not found.'; end if;
      select coalesce(array_agg(d), '{}') into v_ids from public._storage_tool_descendants(f.id) d;
      update public.storage_tool_folders set deleted_at = v_now, trashed_root_id = f.id where id = any (v_ids) and deleted_at is null;
      get diagnostics v_folders = row_count;
      update public.storage_tool_files set deleted_at = v_now, trashed_root_id = f.id where folder_id = any (v_ids) and deleted_at is null;
      get diagnostics v_files = row_count;
      v_total_files := v_total_files + v_files;
      perform public._storage_tool_log(v_me, 'trashed', 'folder', f.id, f.name, f.parent_id, jsonb_build_object('files', v_files, 'folders', v_folders - 1));
    else
      select * into x from public.storage_tool_files t where t.id = it.id and t.owner_id = v_me and t.deleted_at is null;
      if not found then raise exception 'A file you chose was not found.'; end if;
      update public.storage_tool_files set deleted_at = v_now, trashed_root_id = x.id where id = x.id;
      v_total_files := v_total_files + 1;
      perform public._storage_tool_log(v_me, 'trashed', 'file', x.id, x.name, x.folder_id, '{}'::jsonb);
    end if;
    v_roots := v_roots + 1;
  end loop;
  return jsonb_build_object('trashed', v_roots, 'files', v_total_files);
end;
$$;
revoke all on function public.storage_tool_trash(jsonb) from public, anon;
grant execute on function public.storage_tool_trash(jsonb) to authenticated;

-- What is in my Trash: one line per deleted item (a deleted folder is ONE line with its size and number of items).
create or replace function public.storage_tool_trash_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days integer;
begin
  perform public._storage_tool_require();
  select s.trash_days into v_days from public.storage_tool_settings s where s.id;
  return jsonb_build_object('trash_days', v_days, 'items', coalesce((
    select jsonb_agg(r order by (r ->> 'deleted_at') desc) from (
      select jsonb_build_object('kind', 'folder', 'id', f.id, 'name', f.name, 'deleted_at', f.deleted_at, 'location', public._storage_tool_location(f.parent_id),
        'size_bytes', coalesce((select sum(y.size_bytes) from public.storage_tool_files y where y.trashed_root_id = f.id), 0),
        'item_count', (select count(*) from public.storage_tool_files y where y.trashed_root_id = f.id) + (select count(*) from public.storage_tool_folders c where c.trashed_root_id = f.id and c.id <> f.id),
        'mime_type', '', 'days_left', greatest(0, ceil(extract(epoch from (f.deleted_at + make_interval(days => v_days) - now())) / 86400))::int) as r
      from public.storage_tool_folders f where f.owner_id = auth.uid() and f.deleted_at is not null and f.trashed_root_id = f.id
      union all
      select jsonb_build_object('kind', 'file', 'id', x.id, 'name', x.name, 'deleted_at', x.deleted_at, 'location', public._storage_tool_location(x.folder_id),
        'size_bytes', x.size_bytes, 'item_count', 1, 'mime_type', x.mime_type, 'days_left', greatest(0, ceil(extract(epoch from (x.deleted_at + make_interval(days => v_days) - now())) / 86400))::int)
      from public.storage_tool_files x where x.owner_id = auth.uid() and x.deleted_at is not null and x.trashed_root_id = x.id) s), '[]'::jsonb));
end;
$$;
revoke all on function public.storage_tool_trash_list() from public, anon;
grant execute on function public.storage_tool_trash_list() to authenticated;

create or replace function public.storage_tool_restore(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  it record;
  f public.storage_tool_folders%rowtype;
  x public.storage_tool_files%rowtype;
  v_target uuid;
  v_name text;
  v_count integer := 0;
  v_top integer := 0;
  v_try integer;
begin
  perform public._storage_tool_require();
  for it in select * from public._storage_tool_items(p_items) loop
    if it.kind = 'folder' then
      select * into f from public.storage_tool_folders t where t.id = it.id and t.owner_id = v_me and t.deleted_at is not null and t.trashed_root_id = t.id;
      if not found then raise exception 'A folder you chose is not in the Trash.'; end if;
      v_target := f.parent_id;
      if v_target is not null and not exists (select 1 from public.storage_tool_folders p where p.id = v_target and p.deleted_at is null) then v_target := null; v_top := v_top + 1; end if;
      v_try := 0;
      loop
        v_try := v_try + 1;
        begin
          v_name := public._storage_tool_free_name(v_me, v_target, f.name, 'folder');
          update public.storage_tool_folders set parent_id = v_target, name = v_name, deleted_at = null, trashed_root_id = null, updated_at = now() where id = f.id;
          exit;
        exception when unique_violation then
          if v_try >= 5 then raise; end if;
        end;
      end loop;
      update public.storage_tool_folders set deleted_at = null, trashed_root_id = null where trashed_root_id = f.id;
      update public.storage_tool_files set deleted_at = null, trashed_root_id = null where trashed_root_id = f.id;
      perform public._storage_tool_log(v_me, 'restored', 'folder', f.id, v_name, v_target, '{}'::jsonb);
    else
      select * into x from public.storage_tool_files t where t.id = it.id and t.owner_id = v_me and t.deleted_at is not null and t.trashed_root_id = t.id;
      if not found then raise exception 'A file you chose is not in the Trash.'; end if;
      v_target := x.folder_id;
      if v_target is not null and not exists (select 1 from public.storage_tool_folders p where p.id = v_target and p.deleted_at is null) then v_target := null; v_top := v_top + 1; end if;
      v_try := 0;
      loop
        v_try := v_try + 1;
        begin
          v_name := public._storage_tool_free_name(v_me, v_target, x.name, 'file');
          update public.storage_tool_files set folder_id = v_target, name = v_name, deleted_at = null, trashed_root_id = null where id = x.id;
          exit;
        exception when unique_violation then
          if v_try >= 5 then raise; end if;
        end;
      end loop;
      perform public._storage_tool_log(v_me, 'restored', 'file', x.id, v_name, v_target, '{}'::jsonb);
    end if;
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('restored', v_count, 'to_top', v_top);
end;
$$;
revoke all on function public.storage_tool_restore(jsonb) from public, anon;
grant execute on function public.storage_tool_restore(jsonb) to authenticated;

-- A person may remove from storage the file of an item that is in THEIR Trash (that is "Delete forever"). Nothing else.
create or replace function public._storage_tool_object_trashed(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.storage_tool_files f where f.storage_path = p_name and f.deleted_at is not null and f.owner_id = auth.uid());
$$;
revoke all on function public._storage_tool_object_trashed(text) from public, anon;
grant execute on function public._storage_tool_object_trashed(text) to authenticated;
drop policy if exists "storage tool removes trashed own part" on storage.objects;
create policy "storage tool removes trashed own part" on storage.objects for delete
  using (bucket_id = 'storage-tool' and public.can_use_storage_tool() and (storage.foldername(name))[1] = auth.uid()::text and public._storage_tool_object_trashed(name));

-- Step 1 of "Delete forever": the stored files behind the chosen Trash items (the website removes them from storage).
create or replace function public.storage_tool_forever_prepare(p_items jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_roots uuid[];
begin
  perform public._storage_tool_require();
  select coalesce(array_agg(r.id), '{}') into v_roots from (
    select f.id from public.storage_tool_folders f join public._storage_tool_items(p_items) i on i.kind = 'folder' and i.id = f.id where f.owner_id = auth.uid() and f.trashed_root_id = f.id
    union all
    select x.id from public.storage_tool_files x join public._storage_tool_items(p_items) i on i.kind = 'file' and i.id = x.id where x.owner_id = auth.uid() and x.trashed_root_id = x.id) r;
  if cardinality(v_roots) = 0 then raise exception 'Those items are not in the Trash.'; end if;
  return coalesce((select jsonb_agg(x.storage_path) from public.storage_tool_files x where x.owner_id = auth.uid() and x.deleted_at is not null and x.trashed_root_id = any (v_roots)), '[]'::jsonb);
end;
$$;
revoke all on function public.storage_tool_forever_prepare(jsonb) from public, anon;
grant execute on function public.storage_tool_forever_prepare(jsonb) to authenticated;

-- Step 2: the rows of every file whose stored file is gone are removed, then the emptied folders. Anything still in storage stays in the Trash.
create or replace function public.storage_tool_forever_finish(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_roots uuid[];
  v_files integer := 0;
  v_n integer;
  v_left integer;
  r record;
begin
  perform public._storage_tool_require();
  select coalesce(array_agg(q.id), '{}') into v_roots from (
    select f.id from public.storage_tool_folders f join public._storage_tool_items(p_items) i on i.kind = 'folder' and i.id = f.id where f.owner_id = v_me and f.trashed_root_id = f.id
    union all
    select x.id from public.storage_tool_files x join public._storage_tool_items(p_items) i on i.kind = 'file' and i.id = x.id where x.owner_id = v_me and x.trashed_root_id = x.id) q;
  if cardinality(v_roots) = 0 then raise exception 'Those items are not in the Trash.'; end if;
  for r in select 'folder' as kind, f.id, f.name, f.parent_id as place from public.storage_tool_folders f where f.id = any (v_roots) and f.owner_id = v_me
           union all select 'file', x.id, x.name, x.folder_id from public.storage_tool_files x where x.id = any (v_roots) and x.owner_id = v_me loop
    perform public._storage_tool_log(v_me, 'deleted_forever', r.kind, r.id, r.name, r.place, '{}'::jsonb);
  end loop;
  delete from public.storage_tool_files f where f.owner_id = v_me and f.deleted_at is not null and f.trashed_root_id = any (v_roots)
    and not exists (select 1 from storage.objects o where o.bucket_id = 'storage-tool' and o.name = f.storage_path);
  get diagnostics v_files = row_count;
  loop
    delete from public.storage_tool_folders d where d.owner_id = v_me and d.deleted_at is not null and d.trashed_root_id = any (v_roots)
      and not exists (select 1 from public.storage_tool_folders c where c.parent_id = d.id) and not exists (select 1 from public.storage_tool_files y where y.folder_id = d.id);
    get diagnostics v_n = row_count;
    exit when v_n = 0;
  end loop;
  select count(*) into v_left from public.storage_tool_files y where y.owner_id = v_me and y.trashed_root_id = any (v_roots);
  return jsonb_build_object('deleted_files', v_files, 'left_in_trash', v_left);
end;
$$;
revoke all on function public.storage_tool_forever_finish(jsonb) from public, anon;
grant execute on function public.storage_tool_forever_finish(jsonb) to authenticated;

-- ── 5. The automatic clean-up (called only by the storage-tool-purge function, with the service role) ──
create or replace function public.storage_tool_purge_claim(p_limit integer default 200)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'path', q.storage_path)), '[]'::jsonb) from (
    select f.id, f.storage_path from public.storage_tool_files f
    where f.deleted_at is not null and f.deleted_at < now() - make_interval(days => (select s.trash_days from public.storage_tool_settings s where s.id))
    order by f.deleted_at limit greatest(1, least(coalesce(p_limit, 200), 1000))) q;
$$;
revoke all on function public.storage_tool_purge_claim(integer) from public, anon, authenticated;
grant execute on function public.storage_tool_purge_claim(integer) to service_role;

create or replace function public.storage_tool_purge_finish(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_files integer := 0;
  v_folders integer := 0;
  v_n integer;
  v_cutoff timestamptz := now() - make_interval(days => (select s.trash_days from public.storage_tool_settings s where s.id));
begin
  insert into public.storage_tool_activity (owner_id, actor_label, action, target_kind, target_id, target_name, folder_id)
    select f.owner_id, 'Automatic clean-up', 'purged', 'file', f.id, f.name, f.folder_id from public.storage_tool_files f
    where f.id = any (p_ids) and f.deleted_at is not null and f.deleted_at < v_cutoff and not exists (select 1 from storage.objects o where o.bucket_id = 'storage-tool' and o.name = f.storage_path);
  delete from public.storage_tool_files f where f.id = any (p_ids) and f.deleted_at is not null and f.deleted_at < v_cutoff
    and not exists (select 1 from storage.objects o where o.bucket_id = 'storage-tool' and o.name = f.storage_path);
  get diagnostics v_files = row_count;
  loop
    delete from public.storage_tool_folders d where d.deleted_at is not null and d.deleted_at < v_cutoff
      and not exists (select 1 from public.storage_tool_folders c where c.parent_id = d.id) and not exists (select 1 from public.storage_tool_files y where y.folder_id = d.id);
    get diagnostics v_n = row_count;
    v_folders := v_folders + v_n;
    exit when v_n = 0;
  end loop;
  return jsonb_build_object('deleted_files', v_files, 'deleted_folders', v_folders);
end;
$$;
revoke all on function public.storage_tool_purge_finish(uuid[]) from public, anon, authenticated;
grant execute on function public.storage_tool_purge_finish(uuid[]) to service_role;

-- One-time setup (SQL editor, after deploying the storage-tool-purge function and switching on pg_cron and pg_net):
--   select public.storage_tool_purge_schedule('https://<project>.supabase.co/functions/v1/storage-tool-purge', '<the STORAGE_TOOL_PURGE_SECRET you set>');
-- Calls the function once an hour. Run it again to change the address or secret; storage_tool_purge_unschedule() stops it.
create or replace function public.storage_tool_purge_schedule(p_url text, p_secret text)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') or not exists (select 1 from pg_extension where extname = 'pg_net') then
    return 'Switch on the pg_cron and pg_net extensions first (Database > Extensions), then run this again.';
  end if;
  perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'storage-tool-purge';
  perform cron.schedule('storage-tool-purge', '17 * * * *',
    format('select net.http_post(url := %L, headers := jsonb_build_object(''x-purge-secret'', %L, ''content-type'', ''application/json''), body := ''{}''::jsonb)', p_url, p_secret));
  return 'Scheduled: the storage-tool-purge function is called every hour.';
end;
$$;
revoke all on function public.storage_tool_purge_schedule(text, text) from public, anon, authenticated;

create or replace function public.storage_tool_purge_unschedule()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'storage-tool-purge';
  end if;
end;
$$;
revoke all on function public.storage_tool_purge_unschedule() from public, anon, authenticated;

notify pgrst, 'reload schema';

-- Result check (shown in the SQL editor)
select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'storage_tool_%') as storage_tool_functions;
