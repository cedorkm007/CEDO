-- ─────────────────────────────────────────────────────────────
-- SDP Monitoring update, Phase 9 follow-up (C): staff with the FORMS MANAGEMENT tool can open the submission files they manage.
--
-- Problem reported: some staff could see the submissions in Forms Management but not open the files. Cause: the stored files (private bucket "submission-uploads") can be read
-- only by staff with the Scholar Management tag, while the list of submissions is allowed by the Forms Management tag. Staff with Forms Management but not Scholar Management
-- got an empty answer when opening a file.
-- After this file: staff with the Forms Management tag OR the Scholar Management tag can read the submission files. Nobody else can (scholars never read this bucket
-- directly; the upload function writes for them). Only READING is widened; nobody gains the right to upload, change or delete a file.
-- Changes ONE storage rule. Safe to run twice. Undo: undo_sdp_update_p9_c.sql.
-- ─────────────────────────────────────────────────────────────
set lock_timeout = '5s';

drop policy if exists "staff reads submission uploads" on storage.objects;
create policy "staff reads submission uploads" on storage.objects
  for select using (bucket_id = 'submission-uploads' and (public.is_sead_staff() or public.has_staff_tag('forms_management')));
