-- UNDO for supabase_migration_sdp_update_p9_c_submission_files_forms_management.sql: puts back the earlier rule (only Scholar Management staff read the submission files).
set lock_timeout = '5s';
drop policy if exists "staff reads submission uploads" on storage.objects;
create policy "staff reads submission uploads" on storage.objects
  for select using (bucket_id = 'submission-uploads' and public.is_sead_staff());
