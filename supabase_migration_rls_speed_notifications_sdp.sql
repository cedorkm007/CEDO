-- ─────────────────────────────────────────────────────────────
-- supabase_migration_rls_speed_notifications_sdp.sql
-- FASTER NOTIFICATIONS AND SDP ACTIVITIES LISTS (the two slowest questions of the database).   Safe to run twice.   Undo: undo_rls_speed_notifications_sdp.sql
--
-- WHAT THE DATABASE REPORT SHOWED: reading the notifications table was 80% of all the time the database spent (30,049 reads, 1.5 seconds each, 12 hours in total), and the SDP activities list
-- took 5 to 6 seconds although there are only 36 activities.
-- WHY: the rule that lets the staff read notifications asks "is this person staff?" AGAIN FOR EVERY ONE OF THE 14,000 ROWS (a database function call per row). The rule that shows the open SDP
-- activities to a scholar looks the scholar up in the scholars table (which has rules of its own) separately for every activity.
-- WHAT CHANGES (who can see what stays exactly the same; only how often the question is asked):
--   * notifications: "is this person staff?" is asked ONCE per read.
--   * sdp_activities: the scholar's year level and barangay are read ONCE per read by two small helpers (the same idea as current_scholar_id_number()); the staff rules ask their question once.
-- No table is changed. Nothing is deleted. Two helper functions are added.
-- ─────────────────────────────────────────────────────────────

do $$ begin
  if to_regprocedure('public.is_cedo_staff()') is null or to_regprocedure('public.sdp_activity_visible_to_barangay(text[],text[],text)') is null then
    raise exception 'STOPPED, nothing changed: the scholar portal and SDP visibility files have not been run.';
  end if;
end $$;

-- 1. Notifications: the staff question once per read
do $$ begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'notifications' and policyname = 'staff full access') then
    alter policy "staff full access" on public.notifications using ((select public.is_cedo_staff()));
  end if;
end $$;

-- 2. Helpers: the signed-in scholar's own year level, barangay and whether they are a scholar (one primary key lookup each, outside the scholars table's rules)
create or replace function public.current_scholar_year_level()
returns text
language sql
stable
security definer
set search_path = public
as $$ select s.year_level from public.scholars s where s.id = auth.uid(); $$;
create or replace function public.current_scholar_barangay()
returns text
language sql
stable
security definer
set search_path = public
as $$ select s.barangay from public.scholars s where s.id = auth.uid(); $$;
create or replace function public.current_scholar_exists()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select exists (select 1 from public.scholars s where s.id = auth.uid()); $$;
revoke all on function public.current_scholar_year_level() from public, anon;
revoke all on function public.current_scholar_barangay() from public, anon;
revoke all on function public.current_scholar_exists() from public, anon;
grant execute on function public.current_scholar_year_level() to authenticated;
grant execute on function public.current_scholar_barangay() to authenticated;
grant execute on function public.current_scholar_exists() to authenticated;

-- 3. SDP activities: the scholar's open-activities rule (same meaning as before) and the staff rules, each question asked once
drop policy if exists "scholar reads open activities" on public.sdp_activities;
create policy "scholar reads open activities" on public.sdp_activities for select
  using (
    submitted_by_scholar_id is null
    and (all_year_levels or (select public.current_scholar_year_level()) = any (target_year_levels))
    and (
      (cardinality(target_barangays) = 0 and cardinality(target_clusters) = 0)
      or ((select public.current_scholar_exists()) and public.sdp_activity_visible_to_barangay(target_barangays, target_clusters, (select public.current_scholar_barangay())))
    )
  );
do $$ begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'sdp_activities' and policyname = 'sdp staff full access') then
    alter policy "sdp staff full access" on public.sdp_activities using ((select public.has_staff_tag('sdp_monitoring')));
  end if;
end $$;

notify pgrst, 'reload schema';

-- Result check (shown in the SQL editor)
select (select count(*) from pg_policies where tablename = 'notifications' and policyname = 'staff full access') as notifications_policy,
       (select count(*) from pg_policies where tablename = 'sdp_activities' and policyname = 'scholar reads open activities') as sdp_scholar_policy;
