-- UNDO for supabase_migration_sdp_update_p3_subcategory.sql
-- Run undo_sdp_update_p3b.sql FIRST if you ran the backfill. This removes the sub_category column (and with it every sub-category that was set), the two
-- rules on it, and puts the Phase 1 history function back. Credits are not touched.
alter table public.sdp_activities drop constraint if exists sdp_activities_sub_category_needs_category;
alter table public.sdp_activities drop constraint if exists sdp_activities_sub_category_values;
alter table public.sdp_activities drop column if exists sub_category;

create or replace function public._sdp_log_activity_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_actor record;
begin
  select * into v_actor from public._sdp_history_actor();
  if old.category is distinct from new.category then
    insert into public.sdp_credit_history (event_type, source, activity_id, activity_name, activity_credits, category, actor_id, actor_name, details)
    values ('category_changed', 'category_edit', new.id, new.name, new.credits, new.category, v_actor.actor_id, v_actor.actor_name,
            jsonb_build_object('field', 'category', 'from', old.category, 'to', new.category));
  end if;
  return null;
end;
$$;
revoke all on function public._sdp_log_activity_change() from public, anon, authenticated;
notify pgrst, 'reload schema';
