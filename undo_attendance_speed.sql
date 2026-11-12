-- undo_attendance_speed.sql: puts back the attendance rules as they were (same meaning, the question asked for every row) and drops the new indexes and helper.

do $$ begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'attendance_records' and policyname = 'scholar reads own attendance') then
    alter policy "scholar reads own attendance" on public.attendance_records using (scholar_id_number = public.current_scholar_id_number());
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'attendance_records' and policyname = 'cedo monitors read attendance records') then
    alter policy "cedo monitors read attendance records" on public.attendance_records
      using (public.is_sead_staff() or exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'sdp_monitoring'));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'attendance_sessions' and policyname = 'staff read attendance sessions') then
    alter policy "staff read attendance sessions" on public.attendance_sessions using (public.is_cedo_staff());
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'attendance_sessions' and policyname = 'cedo monitors manage attendance sessions') then
    alter policy "cedo monitors manage attendance sessions" on public.attendance_sessions
      using (public.is_sead_staff() or exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'sdp_monitoring'))
      with check (public.is_sead_staff() or exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'sdp_monitoring'));
  end if;
end $$;

drop policy if exists "scholar reads own attendance sessions" on public.attendance_sessions;
create policy "scholar reads own attendance sessions" on public.attendance_sessions for select using (
  exists (
    select 1 from public.attendance_records r
    where r.session_id = attendance_sessions.id
    and r.scholar_id_number = (select s.scholar_id_number from public.scholars s where s.id = auth.uid())
  )
);

drop function if exists public.my_attendance_session_ids();
drop index if exists public.idx_attendance_records_scholar;
drop index if exists public.idx_renewal_documents_status_kind;

notify pgrst, 'reload schema';
