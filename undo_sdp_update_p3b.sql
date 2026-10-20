-- UNDO for supabase_migration_sdp_update_p3b_backfill_cedo_projects.sql
-- Puts every backfilled activity back to what it had before (no sub-category), but only where it is still "CEDO Projects" (an activity that staff changed
-- since is left as staff set it). Then removes the backup table. Credits are not touched.
update public.sdp_activities a set sub_category = b.previous_sub_category
from public.sdp_subcategory_backfill_backup b
where a.id = b.activity_id and a.sub_category = 'cedo_projects';
drop table if exists public.sdp_subcategory_backfill_backup;
