# Submission Activities — Google Drive setup

This covers the configuration needed for Google Drive integration:
`submission-ensure-drive-folder` (Part 3), which finds/creates the
`Parent Folder / Activity Name / Scholar Year Level /` structure, and
`submission-upload-file` (Part 4), which actually uploads a scholar's file
into that structure. **Both functions share the same three secrets below
— nothing new to configure on the Google side for Part 4.**

Nothing here goes in the frontend or a `VITE_` env var. All three values
below are Edge Function secrets — server-side only, never sent to the
browser.

## What you need to provide

1. **A Google Cloud service account** with the Drive API enabled.
2. **A parent Google Drive folder**, shared with that service account's
   email as an **Editor**.

That's it on the Google side — the function does the rest (creating the
per-activity and per-year-level subfolders) on its own.

## Step 1 — Create the service account (Google Cloud Console)

1. Go to console.cloud.google.com → select or create a project.
2. **APIs & Services → Library** → search "Google Drive API" → **Enable**.
3. **APIs & Services → Credentials → Create Credentials → Service account**.
   Any name (e.g. `cedo-submission-drive`) — no special roles needed at the
   project/IAM level, only Drive-side folder sharing (Step 2) matters.
4. Open the new service account → **Keys → Add Key → Create new key → JSON**.
   This downloads a `.json` file — you'll pull two fields out of it in
   Step 3. Treat this file like a password; don't commit it anywhere.

## Step 2 — Share the parent Drive folder with it

1. In Google Drive, create (or pick) the folder everything will live
   under, e.g. `CEDO Submission Activities`.
2. Right-click it → **Share** → paste the service account's email (looks
   like `cedo-submission-drive@your-project.iam.gserviceaccount.com`,
   also visible in the downloaded JSON as `client_email`) → give it
   **Editor** access.
3. Open the folder in a browser and copy its id from the URL:
   `https://drive.google.com/drive/folders/`**`THIS_PART_IS_THE_ID`**

## Step 3 — Set the three Edge Function secrets

From the downloaded JSON:
- `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `private_key` → `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (this field in the
  JSON already contains literal `\n` sequences — paste it exactly as it
  appears in the JSON file, quotes included, don't try to reformat it into
  real newlines yourself)

```powershell
supabase secrets set GOOGLE_SERVICE_ACCOUNT_EMAIL="cedo-submission-drive@your-project.iam.gserviceaccount.com"
supabase secrets set GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ...\n-----END PRIVATE KEY-----\n"
supabase secrets set GOOGLE_DRIVE_PARENT_FOLDER_ID="1a2B3cD4EfGhIjKlMnOpQrStUvWxYz00"
```

(The values above are placeholders — replace all three with your real
service account email, private key, and folder id.)

## Step 4 — Deploy the Edge Functions

```powershell
npm install -g supabase
supabase login
supabase link --project-ref your-project-ref
supabase functions deploy submission-ensure-drive-folder
supabase functions deploy submission-upload-file
```

If you haven't already run the earlier Submission Activity migrations, run
them first (order matters — each references tables/columns the previous
one creates):

```sql
-- in Supabase → SQL Editor, in this order:
-- 1. supabase_migration_submission_activities.sql     (Part 1)
-- 2. supabase_migration_submission_uploads.sql         (Part 2)
-- 3. supabase_migration_submission_drive_folders.sql   (Part 3)
-- 4. supabase_migration_submission_upload_files.sql    (Part 4, this round)
```

## What these functions do

`submission-ensure-drive-folder`, given `{ activityId }` as an
authenticated scholar:
- Confirms the activity applies to that scholar's year level.
- Checks `submission_drive_folders` for an existing cached folder pair for
  that (activity, year level) — returns immediately if found, no Drive API
  calls at all.
- Otherwise authenticates to Drive as the service account, searches for
  (then creates if missing) the `Activity Name` folder under your parent
  folder, then the `Year Level` subfolder under that.
- Caches both folder ids in `submission_drive_folders` so no later call —
  from any scholar, in that activity/year level — creates a duplicate.
- Returns `{ activityFolderId, yearLevelFolderId }`.

`submission-upload-file` (Part 4, this round), given
multipart/form-data `{ activityId, fieldId, file }` as an authenticated
scholar:
- Re-checks file type and the field's max-files limit server-side (not
  just trusting the UI).
- Ensures the same folder structure above exists (reusing the identical
  logic `submission-ensure-drive-folder` uses, via
  `supabase/functions/_shared/ensureSubmissionDriveFolders.ts`).
- Renames the file to `ActivityName_ScholarLastName_ScholarFirstName`
  (original extension preserved), appending `_2`, `_3`, ... if that exact
  name already exists in the destination Drive folder.
- Uploads the file directly to Drive, server-side — the credentials above
  never reach the browser.
- Records the upload in `submission_uploads`: activity, scholar, field,
  original filename, renamed filename, MIME type, Drive file id, and
  status.
- A scholar can only ever create a row for themselves (their id comes from
  their verified session, never the request body), and there is no
  update/delete endpoint for this table at all, so no scholar can
  overwrite or delete another scholar's file — or their own past one.

Neither function is limited by Vite/browser env vars — both are pure
server-side Edge Functions, per the original spec's requirement that Drive
credentials never reach the frontend.

## Verifying it worked

Once deployed and configured, calling `submission-ensure-drive-folder` for
a real activity id should create, in Drive:
```
<your parent folder>/
  <Activity Name>/
    <Scholar's Year Level>/
```
and a matching row in `submission_drive_folders`. Calling it again for the
same activity/year level should return the same two ids with
`"cached": true` and create nothing new in Drive.

Then, from Scholar Portal → Calendar and Activities → Activities, picking
a file and pressing Submit on a real activity should:
- Show "Uploading…" while the request is in flight.
- On success, show the file with a checkmark and move it out of the picker
  into the "N/max files" uploaded list — refreshing the page should still
  show it (it's now a real row in `submission_uploads`, not just local
  state).
- Create the actual file in Drive, inside `.../<Activity Name>/<Year
  Level>/`, named `ActivityName_LastName_FirstName.<ext>`.
- On a deliberately-broken upload (e.g. temporarily unset a secret), show
  a "Retry" button next to that specific file rather than losing the
  selection or blocking other fields' uploads.
