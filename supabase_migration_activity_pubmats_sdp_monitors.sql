-- ─────────────────────────────────────────────────────────────
-- supabase_migration_activity_pubmats_sdp_monitors.sql
--
-- FIX: "SDP pubmat upload does not work".
--
-- The pubmat storage rule (supabase_migration_activity_pubmats.sql) lets ONLY SEAD staff (users.is_sead_staff) add or replace a picture. But the SDP
-- Monitoring page is opened by staff who have the "SDP Monitoring" tag, who are not always flagged as SEAD staff: for them the picture was refused
-- by the storage rule, and the activity row was never updated.
--
-- This file adds, WITHOUT removing anything:
--   1. A second storage rule: staff with the "sdp_monitoring" tag, and the monitors / creator of that one activity, may add or replace the pictures of
--      SDP activities (path "sdp/<activity id>/…"); monitors / the creator of a Formation activity the pictures of that Formation activity
--      (path "formation/<activity id>/…"). Submission activities and Quest subjects stay SEAD-staff only.
--   2. set_activity_pubmat(type, id, path): saves (or clears) the picture's path on the activity under the same rules. The website used to update the
--      table directly; when the table's update rule did not match the person, the update silently changed nothing. The function checks who is asking,
--      checks the path belongs to that activity, and says so when it cannot save.
--
-- Run AFTER supabase_migration_activity_pubmats.sql and supabase_migration_activity_monitor_helpers_and_policies.sql. Safe to run again.
-- ─────────────────────────────────────────────────────────────

create or replace function public._can_manage_activity_pubmat(p_type text, p_activity_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_sead_staff()
    or (p_type = 'sdp' and (public.has_staff_tag('sdp_monitoring') or public.is_activity_monitor('sdp', p_activity_id)))
    or (p_type = 'formation' and public.is_activity_monitor('formation', p_activity_id));
$$;
revoke all on function public._can_manage_activity_pubmat(text, uuid) from public, anon;
grant execute on function public._can_manage_activity_pubmat(text, uuid) to authenticated;

-- The same question asked about a stored file's name ("sdp/<uuid>/pubmat.jpg").
create or replace function public._can_manage_pubmat_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when split_part(p_name, '/', 1) in ('sdp', 'formation') and split_part(p_name, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public._can_manage_activity_pubmat(split_part(p_name, '/', 1), split_part(p_name, '/', 2)::uuid)
    else false
  end;
$$;
revoke all on function public._can_manage_pubmat_object(text) from public, anon;
grant execute on function public._can_manage_pubmat_object(text) to authenticated;

drop policy if exists "activity monitors manage their pubmats" on storage.objects;
create policy "activity monitors manage their pubmats" on storage.objects
  for all using (bucket_id = 'activity-pubmats' and public._can_manage_pubmat_object(name))
  with check (bucket_id = 'activity-pubmats' and public._can_manage_pubmat_object(name));

create or replace function public.set_activity_pubmat(p_type text, p_id uuid, p_path text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  if p_type not in ('formation', 'submission', 'sdp', 'quest') then raise exception 'Unknown kind of activity.'; end if;
  if p_id is null then raise exception 'Choose an activity.'; end if;
  if not public._can_manage_activity_pubmat(p_type, p_id) then
    raise exception 'You are not allowed to change this activity''s picture.';
  end if;
  if p_path is not null and p_path !~ ('^' || p_type || '/' || p_id::text || '/pubmat(-[0-9]{1,16})?\.[a-z0-9]{1,8}$') then
    raise exception 'That picture does not belong to this activity.';
  end if;
  if p_type = 'sdp' then update public.sdp_activities set pubmat_path = p_path where id = p_id;
  elsif p_type = 'formation' then update public.formation_activities set pubmat_path = p_path where id = p_id;
  elsif p_type = 'submission' then update public.submission_activities set pubmat_path = p_path where id = p_id;
  else update public.quest_subjects set pubmat_path = p_path where id = p_id;
  end if;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise exception 'The activity was not found.'; end if;
end;
$$;
revoke all on function public.set_activity_pubmat(text, uuid, text) from public, anon;
grant execute on function public.set_activity_pubmat(text, uuid, text) to authenticated;

notify pgrst, 'reload schema';
