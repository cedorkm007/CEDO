-- ─────────────────────────────────────────────────────────────
-- supabase_migration_scholars_sdp_checklist_rpc.sql
--
-- Fixes SDP Monitoring → SDP Checklist, the slowest list on the admin
-- side found while investigating "lists load very slowly": its old
-- fetchAllScholarsSDPChecklist() pulled EVERY scholar row through a
-- client-side .range() loop in 1,000-row pages (7+ sequential round
-- trips at this project's ~7,000-scholar count, one full round trip
-- waiting on the last before the next starts), then separately pulled
-- every true row of scholar_sdp_category_status, and joined the two in
-- JavaScript.
--
-- scholars_sdp_checklist() does the same join + per-category boolean as
-- one query, entirely in Postgres, and returns only the already-shaped
-- rows the checklist table actually renders (one row per scholar, three
-- booleans) — a single round trip regardless of scholar count. Gated
-- the same way the tables it reads already are for this feature
-- (has_staff_tag('sdp_monitoring'), matching scholar_sdp_category_status's
-- own "sdp staff full access" RLS policy) rather than is_sead_staff(),
-- which checks a different tag (scholar_management) that this feature
-- was never scoped to.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────

create or replace function public.scholars_sdp_checklist()
returns table (
  scholar_id_number text,
  name text,
  community_service boolean,
  community_volunteerism boolean,
  formation_program boolean
)
language sql
security definer
stable
set search_path = public
as $$
  select
    s.scholar_id_number,
    s.first_name || ' ' || s.last_name as name,
    coalesce(bool_or(st.category = 'community_service' and st.completed), false) as community_service,
    coalesce(bool_or(st.category = 'community_volunteerism' and st.completed), false) as community_volunteerism,
    coalesce(bool_or(st.category = 'formation_program' and st.completed), false) as formation_program
  from public.scholars s
  left join public.scholar_sdp_category_status st on st.scholar_id_number = s.scholar_id_number
  where public.has_staff_tag('sdp_monitoring')
  group by s.scholar_id_number, s.first_name, s.last_name
  order by s.last_name, s.first_name;
$$;

revoke all on function public.scholars_sdp_checklist() from public;
grant execute on function public.scholars_sdp_checklist() to authenticated;
