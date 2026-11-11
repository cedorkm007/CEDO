-- undo_rls_speed_notifications_sdp.sql: puts back the notifications and SDP activities rules as they were (same meaning, the question asked for every row).

do $$ begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'notifications' and policyname = 'staff full access') then
    alter policy "staff full access" on public.notifications using (public.is_cedo_staff());
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'sdp_activities' and policyname = 'sdp staff full access') then
    alter policy "sdp staff full access" on public.sdp_activities using (public.has_staff_tag('sdp_monitoring'));
  end if;
end $$;

drop policy if exists "scholar reads open activities" on public.sdp_activities;
create policy "scholar reads open activities" on public.sdp_activities for select
  using (
    submitted_by_scholar_id is null
    and (
      all_year_levels or exists (
        select 1 from public.scholars
        where scholars.id = auth.uid() and scholars.year_level = any(sdp_activities.target_year_levels)
      )
    )
    and (
      (cardinality(target_barangays) = 0 and cardinality(target_clusters) = 0)
      or exists (
        select 1 from public.scholars s
        where s.id = auth.uid()
          and public.sdp_activity_visible_to_barangay(sdp_activities.target_barangays, sdp_activities.target_clusters, s.barangay)
      )
    )
  );

drop function if exists public.current_scholar_year_level();
drop function if exists public.current_scholar_barangay();
drop function if exists public.current_scholar_exists();

notify pgrst, 'reload schema';
