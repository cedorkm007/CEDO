# Submission Activities — Google Drive setup (Part 3: foundation only)

This covers the configuration needed for `submission-ensure-drive-folder`,
the new Edge Function that finds/creates the
`Parent Folder / Activity Name / Scholar Year Level /` structure in Google
Drive. **No scholar file actually uploads yet** — that's Part 4, and it
will reuse everything set up here without any of these steps needing to be
redone.

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

## Step 4 — Deploy the Edge Function

```powershell
npm install -g supabase
supabase login
supabase link --project-ref your-project-ref
supabase functions deploy submission-ensure-drive-folder
```

If you haven't already run the earlier Submission Activity migrations, run
them first (order matters — each references tables the previous one
creates):

```sql
-- in Supabase → SQL Editor, in this order:
-- 1. supabase_migration_submission_activities.sql   (Part 1)
-- 2. supabase_migration_submission_uploads.sql       (Part 2)
-- 3. supabase_migration_submission_drive_folders.sql (Part 3, this round)
```

## What this function does (and doesn't) do yet

Calling `submission-ensure-drive-folder` with `{ activityId }` as an
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

It does **not** upload, rename, or otherwise touch any scholar file — Part
4 is what will call this (or reuse its cached result) and then perform the
actual upload into `yearLevelFolderId`, with the
`ActivityName_ScholarLastName_ScholarFirstName` renaming and collision
suffixing described in that part's own spec.

## Verifying it worked

Once deployed and configured, calling the function for a real activity id
should create, in Drive:
```
<your parent folder>/
  <Activity Name>/
    <Scholar's Year Level>/
```
and a matching row in `submission_drive_folders`. Calling it again for the
same activity/year level should return the same two ids with
`"cached": true` and create nothing new in Drive.
