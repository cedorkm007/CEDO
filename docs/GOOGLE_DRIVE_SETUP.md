# Submission Activities — Google Drive OAuth setup

Submission Activity uploads use the office Google account's Drive storage.
They do **not** use a service account: personal Gmail accounts cannot give a
bare service account storage quota, which causes Google's “Service Accounts do
not have storage quota” upload error.

The Edge Functions use OAuth 2 with the non-sensitive
`https://www.googleapis.com/auth/drive.file` scope. This scope permits the app
to manage files and folders it creates itself. Do not use the full
`https://www.googleapis.com/auth/drive` scope for this setup.

> Keep the client secret and refresh token private. They are Supabase Edge
> Function secrets, never `VITE_` variables and never frontend code.

## 1. Create an OAuth client

1. Open [Google Cloud Console](https://console.cloud.google.com/) and select
   the project used for CEDO (or create one).
2. Go to **APIs & Services → Library**, find **Google Drive API**, and enable
   it.
3. Go to **APIs & Services → OAuth consent screen**. Choose **External** for a
   personal Gmail account, complete the required app details, and add yourself
   as a test user while setting it up.
4. In **Data access** / **Scopes**, add exactly
   `https://www.googleapis.com/auth/drive.file`.
5. Go to **Credentials → Create credentials → OAuth client ID**. Choose **Web
   application** and add this Authorized redirect URI exactly:

   ```text
   https://developers.google.com/oauthplayground
   ```

6. Save the client and keep its **Client ID** and **Client secret** ready.

## 2. Create the refresh token and the new parent folder

The parent folder must be created through this same OAuth client. A folder
created manually beforehand is not necessarily available to an app limited to
`drive.file`.

1. Open [Google OAuth 2.0 Playground](https://developers.google.com/oauthplayground/).
2. Click the settings cog. Check **Use your own OAuth credentials**, then paste
   the Client ID and Client secret created above. Close the settings panel.
3. In **Step 1**, enter `https://www.googleapis.com/auth/drive.file` in the
   scope box and click **Authorize APIs**. Sign in to the office Google account
   that should own the uploaded files, then approve access.
4. In **Step 2**, click **Exchange authorization code for tokens**. Copy the
   **Refresh token** shown there. Do not use the Playground's default OAuth
   credentials or a token generated with another client.
5. While the Playground access token is still valid, create a new top-level
   parent folder by sending this request in **Step 3: Configure request to API**:

   ```text
   POST https://www.googleapis.com/drive/v3/files
   Content-Type: application/json

   {"name":"CEDO Submission Activities","mimeType":"application/vnd.google-apps.folder"}
   ```

   Click **Send the request**. Copy the `id` from the JSON response; it is the
   new `GOOGLE_DRIVE_PARENT_FOLDER_ID`. Do not reuse the old service-account
   folder ID.

## 3. Configure Supabase secrets

From a terminal already linked to the correct Supabase project, set these four
secrets (replace every placeholder):

```powershell
supabase secrets set GOOGLE_OAUTH_CLIENT_ID="your-client-id.apps.googleusercontent.com"
supabase secrets set GOOGLE_OAUTH_CLIENT_SECRET="your-client-secret"
supabase secrets set GOOGLE_OAUTH_REFRESH_TOKEN="your-refresh-token"
supabase secrets set GOOGLE_DRIVE_PARENT_FOLDER_ID="the-new-folder-id"
```

After a successful test upload, remove the obsolete
`GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`
secrets from the project if they are still present.

## 4. Publish the OAuth consent screen

This is important: an External app left in Testing can issue refresh tokens
that expire after seven days — the exact failure mode this whole doc exists
to prevent (`invalid_grant: Token has been expired or revoked`). With only
the `drive.file` scope, publishing does not require Google's *restricted-scope
verification* review, but Google now requires a few Branding fields to be
filled in before the Publish button will even activate — this part isn't
obviously flagged in the Cloud Console UI, so it's easy to get stuck here.

As of late 2026, the consent screen configuration lives under
**APIs & Services → Google Auth Platform** (not "OAuth consent screen"
directly — that old menu item is gone). It's split into sub-tabs:
**Branding**, **Audience**, **Data Access**, **Verification Center**.

1. Go to the **Branding** tab and fill in:
   - **App name** — anything descriptive (e.g. "CEDO Submission Uploads").
   - **User support email** — an address someone actually monitors.
   - **Application home page** — a real, reachable URL. `https://cedo-ten.vercel.app`
     works fine; there's no requirement it be a page specifically about this
     OAuth integration.
   - **Privacy Policy URL** — also required, even for an internal-only
     unverified app. Reusing the same homepage URL is fine if there's no
     dedicated privacy page.
   - **Developer contact information** — same support email is fine.
2. Go to the **Audience** tab and try **Publish App**. If it asks for an
   **Authorized domain** for whatever domain you used above, that domain
   must already be a **verified property in Google Search Console** for the
   same Google account — Google will reject it with a "Missing Domain"
   error otherwise, not a "please verify" prompt. To verify:
   - [Google Search Console](https://search.google.com/search-console) →
     Add property → **URL prefix** → the exact URL you used (e.g.
     `https://cedo-ten.vercel.app`).
   - Use the **HTML file** or **HTML tag** verification method (not DNS —
     there's no separate DNS control over a shared domain like
     `*.vercel.app`). The HTML file just needs to be served from the site's
     public root (for this project: drop it in `public/`, Vite copies
     `public/*` to the deployed root as-is); the HTML tag goes in
     `index.html`'s `<head>`.
   - Once verified, go back to Branding/Audience and enter the **bare
     domain** (no `https://`, no path — e.g. `cedo-ten.vercel.app`) as the
     Authorized domain.
3. Publish should now succeed.

## 5. Deploy the Edge Functions

Deploy the function after the secrets are configured:

```powershell
supabase functions deploy submission-upload-file
```

Only `submission-upload-file` needs deploying — it imports
`supabase/functions/_shared/googleDrive.ts` directly, and it's the only
Edge Function that does (the separate `submission-ensure-drive-folder`
function from earlier in this project was removed: nothing in the
frontend ever called it, so it never actually pre-warmed anything —
Drive folder creation has always happened lazily, on first upload,
inside `submission-upload-file` itself). No database migration is
required for this authentication change.

## Verify the result

In the Scholar Portal, submit an allowed test document to an unlocked
Submission Activity. The app should create this structure and upload the file:

```text
<new OAuth-created parent folder>/
  <Activity Name>/
    <Scholar Year Level>/
      <Scholar School>/
        <ActivityName>_<ScholarLastName>_<ScholarFirstName>.<extension>
```

The School level was added after this doc was first written — a blank/unset
school produces a folder literally named `No School Set` rather than an empty
folder name. The Year Level folder is shared across every school within it
(only the School subfolder differs per scholar), so switching a scholar's
school never creates a duplicate Year Level folder.

The upload should also create a row in `submission_drive_folders` and a file
record in `submission_uploads`. If it fails, keep the exact error message: the
Drive error detail is returned by the Edge Function and usually identifies a
bad secret, expired/revoked refresh token, or an incorrectly created parent
folder.
