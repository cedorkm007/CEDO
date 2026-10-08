-- ─────────────────────────────────────────────────────────────
-- supabase_migration_my_surveys_sharing.sql
--
-- Phase 5 of "My Surveys": sharing with other staff and managing their roles.
-- Requires the Phase 1 (core) migration. Adds functions only; safe to re-run.
--
-- The permission model itself already lives in Phase 1 and is enforced by the
-- database on every request (RLS + my_survey_role()):
--   owner  -- everything, incl. delete and managing sharing
--   editor -- edit questions/settings, publish/close, view responses
--   viewer -- view the survey and its responses only
-- This migration adds the functions the Share dialog needs. Each one checks the
-- caller's role itself (they are security definer), so hiding a button in the UI
-- is never what protects anything:
--
--   search_staff_for_survey_share  owner only. Finds staff by name or email,
--                                  never returns the owner, says who already has access.
--   list_my_survey_access          any member. Who can open this survey, and as what.
--   set_my_survey_share            owner only. Adds a person, or changes their role.
--   remove_my_survey_share         owner removes anyone; anyone else may remove only
--                                  themself ("leave survey").
--
-- Sharing only controls which STAFF can open the survey in My Surveys. The public
-- respondent link (Phase 3) is separate and works for anyone who has it.
-- ─────────────────────────────────────────────────────────────

-- ── Search staff ────────────────────────────────────────────

create or replace function public.search_staff_for_survey_share(p_survey_id uuid, p_query text)
returns table (
  id uuid,
  first_name text,
  last_name text,
  email text,
  username text,
  access_role text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text;
  v_pattern text;
begin
  if public.my_survey_role(p_survey_id) is distinct from 'owner' then
    raise exception 'Only the owner can share this survey.';
  end if;

  v_q := btrim(coalesce(p_query, ''));
  if char_length(v_q) < 2 then
    return; -- too short to search: avoids listing the whole directory
  end if;
  -- Treat what was typed literally: escape LIKE wildcards.
  v_pattern := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  select u.id, u.first_name::text, u.last_name::text, u.email::text, u.username::text, sh.role::text
  from public.users u
  left join public.my_survey_shares sh on sh.survey_id = p_survey_id and sh.user_id = u.id
  where u.id <> auth.uid()
    and (
      u.first_name ilike v_pattern
      or u.last_name ilike v_pattern
      or (coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) ilike v_pattern
      or u.email ilike v_pattern
      or u.username ilike v_pattern
    )
  order by u.last_name, u.first_name
  limit 15;
end;
$$;
revoke execute on function public.search_staff_for_survey_share(uuid, text) from public, anon;
grant execute on function public.search_staff_for_survey_share(uuid, text) to authenticated;

-- ── Who has access ──────────────────────────────────────────

create or replace function public.list_my_survey_access(p_survey_id uuid)
returns table (
  user_id uuid,
  first_name text,
  last_name text,
  email text,
  access_role text,
  is_owner boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.my_survey_role(p_survey_id) is null then
    raise exception 'You do not have access to this survey.';
  end if;

  return query
  select s.owner_id, o.first_name::text, o.last_name::text, o.email::text, 'owner'::text, true
  from public.my_surveys s
  join public.users o on o.id = s.owner_id
  where s.id = p_survey_id
  union all
  select * from (
    select sh.user_id, u.first_name::text, u.last_name::text, u.email::text, sh.role::text, false
    from public.my_survey_shares sh
    join public.users u on u.id = sh.user_id
    where sh.survey_id = p_survey_id
    order by u.last_name, u.first_name
  ) shared;
end;
$$;
revoke execute on function public.list_my_survey_access(uuid) from public, anon;
grant execute on function public.list_my_survey_access(uuid) to authenticated;

-- ── Add / change ────────────────────────────────────────────

create or replace function public.set_my_survey_share(p_survey_id uuid, p_user_id uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.my_survey_role(p_survey_id) is distinct from 'owner' then
    raise exception 'Only the owner can change who has access to this survey.';
  end if;
  if p_role is null or p_role not in ('editor', 'viewer') then
    raise exception 'Choose Editor or Viewer.';
  end if;
  if p_user_id is null or p_user_id = auth.uid() then
    raise exception 'You already own this survey.';
  end if;
  if not exists (select 1 from public.users where id = p_user_id) then
    raise exception 'That person was not found.';
  end if;

  insert into public.my_survey_shares (survey_id, user_id, role, granted_by)
  values (p_survey_id, p_user_id, p_role, auth.uid())
  on conflict (survey_id, user_id) do update
    set role = excluded.role, granted_by = excluded.granted_by;

  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.set_my_survey_share(uuid, uuid, text) from public, anon;
grant execute on function public.set_my_survey_share(uuid, uuid, text) to authenticated;

-- ── Remove / leave ──────────────────────────────────────────

create or replace function public.remove_my_survey_share(p_survey_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.my_survey_role(p_survey_id);
begin
  if v_role is null then
    raise exception 'You do not have access to this survey.';
  end if;
  if v_role <> 'owner' and p_user_id is distinct from auth.uid() then
    raise exception 'Only the owner can remove other people.';
  end if;

  delete from public.my_survey_shares where survey_id = p_survey_id and user_id = p_user_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.remove_my_survey_share(uuid, uuid) from public, anon;
grant execute on function public.remove_my_survey_share(uuid, uuid) to authenticated;
