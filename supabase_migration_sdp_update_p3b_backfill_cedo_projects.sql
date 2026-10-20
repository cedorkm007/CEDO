-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 3b: put the EXISTING categorized activities in the "CEDO Projects" sub-category.
-- Run AFTER supabase_migration_sdp_update_p3_subcategory.sql.   Safe to re-run.   Undo: undo_sdp_update_p3b.sql
--
-- You asked for every existing activity that has an SDP category to go to "CEDO Projects". This file does exactly that, and only that:
--   • It FIRST saves what each activity had before (a new small table, sdp_subcategory_backfill_backup), so the undo file can put it back.
--   • Activities with NO category are left alone (a sub-category cannot exist without a category).
--   • Activities that already have a sub-category are left alone.
--   • Credits, scholars, codes and everything else are not touched. The credit history gets one line per activity changed (by "the system").
-- ─────────────────────────────────────────────────────────────
create table if not exists public.sdp_subcategory_backfill_backup (
  activity_id uuid primary key,
  previous_sub_category text,
  backfilled_at timestamptz not null default now()
);
alter table public.sdp_subcategory_backfill_backup enable row level security;
revoke all on public.sdp_subcategory_backfill_backup from public, anon, authenticated;

insert into public.sdp_subcategory_backfill_backup (activity_id, previous_sub_category)
select a.id, a.sub_category from public.sdp_activities a
where a.category is not null and a.sub_category is null
on conflict (activity_id) do nothing;

update public.sdp_activities a set sub_category = 'cedo_projects'
where a.category is not null and a.sub_category is null;

-- A quick report: how many activities are in each sub-category now, and how many have no category.
select coalesce(sub_category, case when category is null then '(no category: left alone)' else '(no sub-category)' end) as sub_category, count(*) as activities
from public.sdp_activities group by 1 order by 1;
