// Google Drive access-token + read helper — now used ONLY by the one-time
// submission-backfill-drive-files Edge Function, which downloads files
// originally uploaded to Drive before the Submission Activity feature
// moved to Supabase Storage (see supabase_migration_submission_supabase_
// storage.sql). The folder-management/rename/upload helpers this module
// used to export (find-or-create folder, collision-avoided renaming,
// multipart upload, move) are gone — nothing writes to Drive anymore.
//
// Uses an OAuth 2 refresh-token exchange. A personal Gmail account cannot
// give a bare service account its own Drive storage quota, whereas this
// exchange acts as the office Google account that granted the application
// access. Keep this module server-only: none of these secrets may reach the
// browser.
//
// Requires three secrets (see docs/GOOGLE_DRIVE_SETUP.md for exact setup
// steps and placeholder values) — GOOGLE_DRIVE_PARENT_FOLDER_ID is no
// longer read here since nothing creates folders anymore:
//   GOOGLE_OAUTH_CLIENT_ID
//   GOOGLE_OAUTH_CLIENT_SECRET
//   GOOGLE_OAUTH_REFRESH_TOKEN
//
// Safe to remove entirely (module, secrets, and docs/GOOGLE_DRIVE_SETUP.md)
// once the one-time backfill has been run to completion and confirmed.

import { throwJsonError } from "./cors.ts";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";

/**
 * Google's API error responses share one shape: `{ error: { code,
 * message, errors: [...] } }`. Appended to error messages below so the
 * actual cause is visible directly instead of only in server-side logs.
 */
function driveErrorDetail(json: unknown): string {
  const message = (json as { error?: { message?: unknown } } | null)?.error?.message;
  if (typeof message === "string" && message.trim()) return message;
  try {
    return JSON.stringify(json);
  } catch {
    return "unknown error";
  }
}

let cachedToken: { value: string; expiresAt: number } | null = null;

/**
 * Exchanges the long-lived OAuth refresh token for a short-lived Drive access
 * token. The scope is deliberately chosen during the one-time OAuth consent
 * setup (`drive.file`), not requested here. Cache only for this warm Edge
 * Function instance and always leave one minute of expiry headroom.
 */
export async function getGoogleAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 60 > now) return cachedToken.value;

  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET");
  const refreshToken = Deno.env.get("GOOGLE_OAUTH_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken) {
    throwJsonError("Google Drive credentials are not configured yet.", 500);
  }

  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });
  const tokenJson: { access_token?: unknown; expires_in?: unknown } = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || typeof tokenJson.access_token !== "string" || !tokenJson.access_token) {
    console.error("Google token exchange failed:", tokenJson);
    throwJsonError(`Failed to authenticate with Google Drive. (${driveErrorDetail(tokenJson)})`, 502);
  }

  const expiresIn = Number(tokenJson.expires_in);
  cachedToken = { value: tokenJson.access_token, expiresAt: now + (Number.isFinite(expiresIn) ? expiresIn : 3600) };
  return cachedToken.value;
}

/**
 * Downloads one file's raw bytes from Drive by id — read-only (a plain GET
 * with alt=media), used by the one-time backfill to pull files off Drive
 * before storing them in Supabase Storage. Never deletes or modifies
 * anything in Drive; the original file is left exactly as-is.
 */
export async function downloadFile(accessToken: string, fileId: string): Promise<Uint8Array> {
  const url = `${DRIVE_FILES_URL}/${fileId}?alt=media&supportsAllDrives=true`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    console.error(`Drive file download failed for ${fileId}:`, json);
    throwJsonError(`Failed to download a file from Google Drive. (${driveErrorDetail(json)})`, 502);
  }
  return new Uint8Array(await res.arrayBuffer());
}
