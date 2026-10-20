-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 3: SUB-CATEGORIES.   Safe to re-run.   Undo: undo_sdp_update_p3.sql
--
-- Every SDP activity can have a sub-category under its category: School-based, Community-based or CEDO Projects.
--   • One new optional column on sdp_activities. Nothing existing is changed; old activities simply have no sub-category until
--     supabase_migration_sdp_update_p3b_backfill_cedo_projects.sql puts the categorized ones in "CEDO Projects" (a separate step you run on purpose).
--   • A sub-category cannot exist without a category (the database refuses it).
--   • Sub-categories have NO effect on credits or on Complied / Not complied: credits belong to the activity, and the rule (3 credits in each of the
--     3 categories) is unchanged. Changing an activity's category or sub-category never adds, removes or moves a credit.
--   • Every change of an activity's sub-category (like a category change) is written to the credit history of Phase 1.
-- ─────────────────────────────────────────────────────────────
alter table public.sdp_activities add column if not exists sub_category text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sdp_activities_sub_category_values') then
    alter table public.sdp_activities add constraint sdp_activities_sub_category_values
      check (sub_category is null or sub_category in ('school_based', 'community_based', 'cedo_projects'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sdp_activities_sub_category_needs_category') then
    alter table public.sdp_activities add constraint sdp_activities_sub_category_needs_category
      check (sub_category is null or category is not null);
  end if;
end $$;

-- The history function of Phase 1, now also writing a line when the sub-category changes.
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
  if old.sub_category is distinct from new.sub_category then
    insert into public.sdp_credit_history (event_type, source, activity_id, activity_name, activity_credits, category, actor_id, actor_name, details)
    values ('category_changed', 'category_edit', new.id, new.name, new.credits, new.category, v_actor.actor_id, v_actor.actor_name,
            jsonb_build_object('field', 'sub_category', 'from', old.sub_category, 'to', new.sub_category));
  end if;
  return null;
end;
$$;
revoke all on function public._sdp_log_activity_change() from public, anon, authenticated;

notify pgrst, 'reload schema';
