-- ─────────────────────────────────────────────────────────────
-- supabase_migration_attendance_speed.sql
-- FASTER SCHOLAR ATTENDANCE READS ("Attended" marks in Calendar and Activities, the "resume your survey" banner, documents list).   Safe to run twice.   Undo: undo_attendance_speed.sql
--
-- WHAT THE DATABASE REPORT SHOWED: the scholar's attendance read took 626 ms on average (up to 5.8 seconds) and the "pending survey" read 110 ms, thousands of times.
-- WHY: (1) attendance_records has NO index on the scholar, so every read of "my attendance" looked through ALL attendance rows of ALL scholars; (2) the rules of attendance_records and
-- attendance_sessions ask "is this person staff?" again for every row, and a scholar's read of a session checked the scholar's attendance (with its own rules) again for every session.
-- WHAT CHANGES (who can see what stays exactly the same; only how often the question is asked):
--   * an index on attendance_records (scholar_id_number)
--   * the scholar's "my sessions" rule finds the scholar's session list ONCE (a helper function, like current_scholar_id_number())
--   * the staff questions are asked ONCE per read (the same (select ...) idea already used by the newer rules)
--   * an index on renewal_documents (status, kind) for the Scholar Renewal Documents list
-- No table is changed. Nothing is deleted. One helper function is added.
-- ─────────────────────────────────────────────────────────────

do $$ begin
  if to_regclass('public.attendance_records') is null or to_regclass('public.attendance_sessions') is null or to_regprocedure('public.current_scholar_id_number()') is null then
    raise exception 'STOPPED, nothing changed: the attendance and scholar portal files have not been run.';
  end if;
end $$;

-- 1. Indexes
create index if not exists idx_attendance_records_scholar on public.attendance_records (scholar_id_number);
do $$ begin
  if to_regclass('public.renewal_documents') is not null then
    create index if not exists idx_renewal_documents_status_kind on public.renewal_documents (status, kind);
  end if;
end $$;

-- 2. The sessions the signed-in scholar has attendance in (one lookup, outside the attendance rules)
create or replace function public.my_attendance_session_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$ select r.session_id from public.attendance_records r where r.scholar_id_number = public.current_scholar_id_number(); $$;
revoke all on function public.my_attendance_session_ids() from public, anon;
grant execute on function public.my_attendance_session_ids() to authenticated;

-- 3. The scholar's rules (same meaning as before)
drop policy if exists "scholar reads own attendance sessions" on public.attendance_sessions;
create policy "scholar reads own attendance sessions" on public.attendance_sessions for select
  using (id in (select public.my_attendance_session_ids()));

do $$ begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'attendance_records' and policyname = 'scholar reads own attendance') then
    alter policy "scholar reads own attendance" on public.attendance_records using (scholar_id_number = (select public.current_scholar_id_number()));
  end if;
  -- 4. The staff rules: each question asked once per read
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'attendance_records' and policyname = 'cedo monitors read attendance records') then
    alter policy "cedo monitors read attendance records" on public.attendance_records
      using ((select public.is_sead_staff() or exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'sdp_monitoring')));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'attendance_sessions' and policyname = 'staff read attendance sessions') then
    alter policy "staff read attendance sessions" on public.attendance_sessions using ((select public.is_cedo_staff()));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'attendance_sessions' and policyname = 'cedo monitors manage attendance sessions') then
    alter policy "cedo monitors manage attendance sessions" on public.attendance_sessions
      using ((select public.is_sead_staff() or exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'sdp_monitoring')))
      with check ((select public.is_sead_staff() or exists (select 1 from public.staff_account_tags where staff_id = auth.uid() and tag_key = 'sdp_monitoring')));
  end if;
end $$;

notify pgrst, 'reload schema';

-- Result check (shown in the SQL editor)
select (select count(*) from pg_indexes where indexname = 'idx_attendance_records_scholar') as attendance_index,
       (select count(*) from pg_policies where tablename = 'attendance_sessions' and policyname = 'scholar reads own attendance sessions') as sessions_policy;
