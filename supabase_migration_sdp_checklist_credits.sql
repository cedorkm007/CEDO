-- ─────────────────────────────────────────────────────────────
-- supabase_migration_sdp_checklist_credits.sql
--
-- SDP Checklist (Scholar Management → SDP Monitoring → SDP Checklist)
-- used to show Complete/Incomplete per category, backed by
-- scholar_sdp_category_status.completed (a boolean with no credit count).
-- Staff want to see the actual number of credits earned per category
-- instead, so this recomputes the same total recompute_sdp_category_status()
-- already derives (sum of sdp_activities.credits via sdp_attendance,
-- 3 credits = complete) directly from source, returning integers instead
-- of booleans.
--
-- Return shape changed, so the old signature must be dropped first.
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

drop function if exists public.scholars_sdp_checklist();

create or replace function public.scholars_sdp_checklist()
 returns table(scholar_id_number text, name text, community_service integer, community_volunteerism integer, formation_program integer)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select
    s.scholar_id_number,
    s.first_name || ' ' || s.last_name as name,
    coalesce(sum(act.credits) filter (where act.category = 'community_service'), 0)::integer as community_service,
    coalesce(sum(act.credits) filter (where act.category = 'community_volunteerism'), 0)::integer as community_volunteerism,
    coalesce(sum(act.credits) filter (where act.category = 'formation_program'), 0)::integer as formation_program
  from public.scholars s
  left join public.sdp_attendance a on a.scholar_id_number = s.scholar_id_number
  left join public.sdp_activities act on act.id = a.activity_id
  where public.has_staff_tag('sdp_monitoring') and s.status <> 'Removed'
  group by s.scholar_id_number, s.first_name, s.last_name
  order by s.last_name, s.first_name;
$function$;
