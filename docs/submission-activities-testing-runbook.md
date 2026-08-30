# Submission Activities — Testing Runbook

Manual, live-testing checklist for the Submission Activities feature
(Drive folder structure + upload flow + staff-side tools). This
document did not exist before Milestone 3 of the "Drive folder
reorganization + submission monitoring" task — it's referenced in that
task's own planning notes as something to update, but had never actually
been created. Created fresh here, seeded with the parts that task
needs; earlier feature work (activity creation, unlock conditions,
review panel) predates this runbook and doesn't have its own checklist
yet — add one when that's next revisited, rather than reconstructing it
retroactively now.

Run this after any deploy that touches Drive folder creation, the
upload path, or the staff-side Submission Activities tools.

## Part 1 — Environment / configuration sanity check

1. Confirm the Google Drive OAuth2 refresh token secret is set and not
   expired (see `docs/GOOGLE_DRIVE_SETUP.md`).
2. Confirm `GOOGLE_DRIVE_PARENT_FOLDER_ID` is set to the correct parent
   folder for the environment being tested (staging vs. production —
   don't run destructive steps below against production without
   confirming this first).
3. Confirm at least one staff account has the `forms_management` tag
   (required for Part 4 below) and at least one scholar account has a
   year level and school set.

## Part 2 — Scholar upload flow

1. Log in to the Scholar Portal as a test scholar with a known year
   level and school.
2. Submit an allowed test document to an unlocked Submission Activity.
3. Confirm the upload succeeds and a row appears in `submission_uploads`
   with a non-empty `drive_file_id`.
4. Repeat with a scholar whose `school` is blank — confirm it uploads
   without error (this exercises the "No School Set" fallback, not a
   failure path).

## Part 3 — Drive folder structure verification (3-level, School included)

Milestone 1 added a School level below Year Level. Verify the resulting
Drive structure directly, not just that the upload API call succeeded:

1. In Google Drive, navigate to
   `<parent folder> / <Activity Name> / <Scholar Year Level> / <Scholar School>`
   and confirm the uploaded file (from Part 2, step 2) is there.
2. Upload a second file for a different scholar in the SAME year level
   but a DIFFERENT school. Confirm:
   - a new School subfolder is created under the same Year Level folder
     (the Year Level folder itself is NOT duplicated), and
   - the first scholar's file did not move.
3. For the blank-school scholar from Part 2, step 4: confirm their file
   landed under a subfolder literally named `No School Set`, not an
   empty-named folder and not directly inside the Year Level folder.
4. Confirm a row for each new folder combination appears in
   `submission_drive_folders`, keyed by
   `(activity_id, year_level, school)`.

## Part 4 — Staff: retroactive Drive file reorganization (Milestone 2)

Covers the `FolderSync` action added to each activity in the Submission
Activities staff page, and its underlying
`submission-reorganize-activity-files` Edge Function.

1. Pick (or set up) an activity with files uploaded BEFORE Milestone 1
   shipped — i.e., files that currently sit directly in a Year Level
   folder with no School subfolder.
2. Log in to the staff dashboard as an account WITHOUT the
   `forms_management` tag. Confirm the `FolderSync` button either isn't
   shown or the action is rejected with a clear "not authorized" message
   — do not skip this negative check.
3. Log in as a staff account WITH the `forms_management` tag. Click
   `FolderSync` for the activity from step 1. Confirm the confirmation
   dialog appears before anything happens.
4. Confirm it, then verify in Drive that the pre-Milestone-1 files
   actually moved into the correct School subfolder (matching each
   uploading scholar's CURRENT school on record) — not copied, not left
   in place, and each file's Drive file id unchanged (check via the
   file's own "Details" panel, since a move preserves the id but a
   delete+re-upload would not).
5. Re-run the SAME action for the SAME activity a second time
   immediately after. Confirm it reports the files as already in place
   (0 newly moved, or equivalent) rather than erroring or duplicating
   folders — this is the safely-re-runnable guarantee the Edge Function
   is designed around.
6. If the activity has any scholar whose year level or school changed
   AFTER they originally uploaded: confirm the file moves according to
   their CURRENT year level/school, not whatever it was at upload time
   — this is documented, expected behavior, not a bug, but worth
   confirming it actually behaves that way live.
7. Spot-check the on-screen result summary matches what actually
   happened in Drive (correct counts, correct scholar names on any
   reported failures).
