-- ─────────────────────────────────────────────────────────────
-- supabase_migration_storage_tool_p4.sql
--
-- Storage Tool, PHASE 4: activity screen, the IT admin's overview, handing a person's files over to somebody else, and a phone-friendly push text.
-- Run AFTER supabase_migration_storage_tool_p3.sql. Additive and safe to run twice.
--
--   1. storage_tool_activity_list     what happened in MY storage (everything every person did there, including visitors of my upload links),
--                                     for the whole storage or one folder, newest first, 50 at a time.
--   2. storage_tool_admin_overview    IT admin only: how much each person uses, who still has access, the three limits.
--   3. storage_tool_admin_transfer    IT admin only: hands ALL of one person's folders, files (also what is in their Trash), shares and upload links
--                                     over to another person, so the account can then be deleted (a person who still owns files cannot be deleted).
--   4. The push message for a "storage" notice: generic text (a lock screen never shows a visitor's name) that opens the Storage Tool.
-- ─────────────────────────────────────────────────────────────

-- ── 1. The activity screen ──────────────────────────────────
-- p_folder_id = null: everything in my storage. Otherwise: that folder (and everything inside it) and the things that happened to the folder itself.
-- p_before: continue after the oldest line already shown. Returns { items: [...], has_more }.
create or replace function public.storage_tool_activity_list(p_folder_id uuid default null, p_limit integer default 50, p_before timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_ids uuid[];
  v_rows jsonb;
  v_count integer;
begin
  perform public._storage_tool_require();
  if p_folder_id is not null then
    if not exists (select 1 from public.storage_tool_folders f where f.id = p_folder_id and f.owner_id = auth.uid()) then raise exception 'That folder was not found.'; end if;
    select coalesce(array_agg(d), '{}') into v_ids from public._storage_tool_descendants(p_folder_id) d;
  end if;
  with r as (
    select a.id, a.at, a.actor_label as actor, a.action, a.target_kind as kind, a.target_name as name, public._storage_tool_location(a.folder_id) as location, a.detail
    from public.storage_tool_activity a
    where a.owner_id = auth.uid() and (p_before is null or a.at < p_before)
      and (p_folder_id is null or a.folder_id = any (v_ids) or a.target_id = p_folder_id)
    order by a.at desc, a.id limit v_limit + 1
  ), n as (select r.*, row_number() over (order by r.at desc, r.id) as rn from r)
  select coalesce(jsonb_agg(to_jsonb(n) - 'rn' order by n.rn) filter (where n.rn <= v_limit), '[]'::jsonb), count(*) into v_rows, v_count from n;
  return jsonb_build_object('items', v_rows, 'has_more', v_count > v_limit);
end;
$$;
revoke all on function public.storage_tool_activity_list(uuid, integer, timestamptz) from public, anon;
grant execute on function public.storage_tool_activity_list(uuid, integer, timestamptz) to authenticated;

-- ── 2. The IT admin's overview ──────────────────────────────
create or replace function public.storage_tool_admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.storage_tool_settings%rowtype;
begin
  if not public.is_it_admin() then raise exception 'Only the IT admin can see this.'; end if;
  select * into s from public.storage_tool_settings where id;
  return jsonb_build_object(
    'settings', jsonb_build_object('max_file_mb', s.max_file_mb, 'trash_days', s.trash_days, 'total_quota_gb', s.total_quota_gb),
    'total_bytes', coalesce((select sum(f.size_bytes) from public.storage_tool_files f), 0),
    'quota_bytes', s.total_quota_gb::bigint * 1073741824,
    'people', coalesce((
      select jsonb_agg(p order by (p ->> 'bytes')::bigint desc, p ->> 'name') from (
        select jsonb_build_object(
          'id', u.id, 'name', btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), 'username', u.username,
          'has_access', (lower(u.username) = 'it.admin1' or exists (select 1 from public.staff_account_tags t where t.staff_id = u.id and t.tag_key = 'storage_tool')),
          'files', (select count(*) from public.storage_tool_files f where f.owner_id = u.id and f.deleted_at is null),
          'folders', (select count(*) from public.storage_tool_folders f where f.owner_id = u.id and f.deleted_at is null),
          'bytes', coalesce((select sum(f.size_bytes) from public.storage_tool_files f where f.owner_id = u.id), 0),
          'trash_bytes', coalesce((select sum(f.size_bytes) from public.storage_tool_files f where f.owner_id = u.id and f.deleted_at is not null), 0),
          'shares', (select count(*) from public.storage_tool_shares sh where sh.owner_id = u.id),
          'links', (select count(*) from public.storage_tool_links l where l.owner_id = u.id and l.status in ('active', 'paused')),
          'last_activity', (select max(a.at) from public.storage_tool_activity a where a.owner_id = u.id),
          'has_anything', (exists (select 1 from public.storage_tool_files f where f.owner_id = u.id) or exists (select 1 from public.storage_tool_folders f where f.owner_id = u.id)
                           or exists (select 1 from public.storage_tool_shares sh where sh.owner_id = u.id) or exists (select 1 from public.storage_tool_links l where l.owner_id = u.id))
        ) as p
        from public.users u
        where lower(u.username) = 'it.admin1'
           or exists (select 1 from public.staff_account_tags t where t.staff_id = u.id and t.tag_key = 'storage_tool')
           or exists (select 1 from public.storage_tool_files f where f.owner_id = u.id)
           or exists (select 1 from public.storage_tool_folders f where f.owner_id = u.id)
           or exists (select 1 from public.storage_tool_shares sh where sh.owner_id = u.id)
           or exists (select 1 from public.storage_tool_links l where l.owner_id = u.id)
      ) q), '[]'::jsonb));
end;
$$;
revoke all on function public.storage_tool_admin_overview() from public, anon;
grant execute on function public.storage_tool_admin_overview() to authenticated;

-- ── 3. Handing everything over ──────────────────────────────
-- Everything of p_from (folders, files, the Trash, shares they gave, upload links, the activity history) becomes p_to's. What was at the top of p_from's
-- storage is put inside one new folder at the top of p_to's storage ("From Maria Cruz (handed over 2026-10-16)"), so no name can clash. What was
-- shared WITH p_from is simply removed. The upload links keep working, and their notices now go to p_to.
create or replace function public.storage_tool_admin_transfer(p_from uuid, p_to uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from_name text;
  v_to_name text;
  v_holder uuid;
  v_folders integer;
  v_files integer;
  v_shares integer;
  v_links integer;
  v_name text;
begin
  if not public.is_it_admin() then raise exception 'Only the IT admin can hand files over.'; end if;
  if p_from is null or p_to is null or p_from = p_to then raise exception 'Choose two different people.'; end if;
  select nullif(btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), '') into v_from_name from public.users u where u.id = p_from;
  if not exists (select 1 from public.users u where u.id = p_from) then raise exception 'The person to take over from was not found.'; end if;
  if not exists (select 1 from public.users u where u.id = p_to and (lower(u.username) = 'it.admin1' or exists (select 1 from public.staff_account_tags t where t.staff_id = u.id and t.tag_key = 'storage_tool'))) then
    raise exception 'The person who receives the files must be able to use the Storage Tool.';
  end if;
  select nullif(btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), '') into v_to_name from public.users u where u.id = p_to;
  if not (exists (select 1 from public.storage_tool_files f where f.owner_id = p_from) or exists (select 1 from public.storage_tool_folders f where f.owner_id = p_from)
          or exists (select 1 from public.storage_tool_shares s where s.owner_id = p_from) or exists (select 1 from public.storage_tool_links l where l.owner_id = p_from)) then
    raise exception 'This person has nothing in the Storage Tool to hand over.';
  end if;

  v_name := public._storage_tool_free_name(p_to, null, left('From ' || coalesce(v_from_name, 'a former colleague') || ' (handed over ' || to_char(now(), 'YYYY-MM-DD') || ')', 255), 'folder');
  insert into public.storage_tool_folders (owner_id, parent_id, name) values (p_to, null, v_name) returning id into v_holder;

  -- the top of their storage goes inside the new folder (the Trash keeps its places: a deleted item has no name to clash with)
  update public.storage_tool_folders set parent_id = v_holder where owner_id = p_from and parent_id is null and deleted_at is null;
  update public.storage_tool_files set folder_id = v_holder where owner_id = p_from and folder_id is null and deleted_at is null;
  update public.storage_tool_folders set owner_id = p_to where owner_id = p_from;
  get diagnostics v_folders = row_count;
  update public.storage_tool_files set owner_id = p_to where owner_id = p_from;
  get diagnostics v_files = row_count;
  delete from public.storage_tool_shares where owner_id = p_from and shared_with = p_to;     -- nobody shares with themselves
  update public.storage_tool_shares set owner_id = p_to where owner_id = p_from;
  get diagnostics v_shares = row_count;
  delete from public.storage_tool_shares where shared_with = p_from;                          -- what was shared WITH them ends
  update public.storage_tool_links set owner_id = p_to where owner_id = p_from;
  get diagnostics v_links = row_count;
  update public.storage_tool_activity set owner_id = p_to where owner_id = p_from;

  perform public._storage_tool_log(p_to, 'handed_over', 'folder', v_holder, v_name, null,
    jsonb_build_object('from', coalesce(v_from_name, ''), 'folders', v_folders, 'files', v_files, 'shares', v_shares, 'links', v_links));
  insert into public.notifications (id, type, user_id, user_name, title, message, "timestamp", read, reference_id)
  values (gen_random_uuid(), 'storage', p_to, '', 'Storage Tool: files handed over to you',
    'The IT admin handed over the Storage Tool files of ' || coalesce(v_from_name, 'a former colleague') || ' to you. They are in the folder "' || v_name || '" at the top of your storage'
      || case when v_links > 0 then ', and their upload links are now yours' else '' end || '.', now(), false, v_holder::text);
  return jsonb_build_object('folder_id', v_holder, 'folder_name', v_name, 'folders', v_folders, 'files', v_files, 'shares', v_shares, 'links', v_links, 'from', coalesce(v_from_name, ''), 'to', coalesce(v_to_name, ''));
end;
$$;
revoke all on function public.storage_tool_admin_transfer(uuid, uuid) from public, anon;
grant execute on function public.storage_tool_admin_transfer(uuid, uuid) to authenticated;

-- ── 4. The push message ─────────────────────────────────────
-- Only when the push tables exist (supabase_migration_renewal_p6_notifications.sql). Same function as there, plus a text for the Storage Tool.
do $$
begin
  if to_regclass('public.push_outbox') is not null and to_regclass('public.push_subscriptions') is not null then
    execute $f$
      create or replace function public._push_enqueue_staff()
      returns trigger
      language plpgsql
      security definer
      set search_path = public
      as $body$
      begin
        if exists (select 1 from public.push_subscriptions s where s.staff_id = new.user_id) then
          -- Generic text on purpose: a lock screen never shows a scholar's name, a task title or a visitor's name. The full text is in the bell.
          insert into public.push_outbox (owner_kind, staff_id, title, body, url)
          values ('staff', new.user_id,
            case new.type when 'renewal' then 'Scholar Renewal' when 'storage' then 'Storage Tool' else 'CEDO' end,
            case new.type when 'renewal' then 'You have a new notification about a renewal case. Open the portal to read it.'
                          when 'storage' then 'You have a new notification about your files. Open the portal to read it.'
                          else 'You have a new notification. Open the portal to read it.' end,
            case new.type when 'renewal' then '/?page=scholarRenewal' when 'storage' then '/?page=storageTool' else '/?page=notifications' end);
        end if;
        return null;
      end;
      $body$;
    $f$;
  end if;
end $$;

notify pgrst, 'reload schema';

-- Result check (shown in the SQL editor)
select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('storage_tool_activity_list', 'storage_tool_admin_overview', 'storage_tool_admin_transfer')) as phase4_functions;
