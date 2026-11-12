-- undo_realtime_trim.sql: puts the three tables back into the live push list.
do $$
declare t text;
begin
  foreach t in array array['attendance_codes', 'sdp_activities', 'sdp_attendance'] loop
    if to_regclass('public.' || t) is not null and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
