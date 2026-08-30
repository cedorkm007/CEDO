// Minimal Google Drive folder find-or-create helper — Part 3 of the
// Submission Activity feature. This helper is shared by the folder-creation
// and file-upload Edge Functions.
//
// Uses an OAuth 2 refresh-token exchange. A personal Gmail account cannot
// give a bare service account its own Drive storage quota, whereas this
// exchange acts as the office Google account that granted the application
// access. Keep this module server-only: none of these secrets may reach the
// browser.
//
// Requires four secrets (see docs/GOOGLE_DRIVE_SETUP.md for exact setup
// steps and placeholder values):
//   GOOGLE_OAUTH_CLIENT_ID
//   GOOGLE_OAUTH_CLIENT_SECRET
//   GOOGLE_OAUTH_REFRESH_TOKEN
//   GOOGLE_DRIVE_PARENT_FOLDER_ID
// The parent folder must be created by this OAuth application while using
// the `drive.file` scope; see docs/GOOGLE_DRIVE_SETUP.md.

import { throwJsonError } from "./cors.ts";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";

/**
 * Google's API error responses share one shape: `{ error: { code,
 * message, errors: [...] } }`. Every throwJsonError call below that's
 * driven by a Drive/OAuth response appends this to its own generic
 * message — e.g. "Failed to search Google Drive. (File not found:
 * 1AbC... .)" — so the actual cause (bad credentials, a parent folder ID
 * the OAuth app cannot access, a malformed request, a transient API
 * error, etc.) is visible directly in the client-facing error message
 * instead of only in server-side logs a person may not have dashboard
 * access to check. Falls back to a JSON dump of whatever shape the
 * response actually had if it doesn't match Google's usual one, rather
 * than silently dropping the detail.
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
 * Strips/replaces characters worth avoiding in a Drive folder name even
 * though Drive itself is lenient about most of them — same defensive
 * posture Part 4's file renaming will need anyway, and keeps the
 * structure copy-paste-safe if staff ever mirror/export it elsewhere.
 * Caps length defensively; Drive's real limit is far higher.
 */
function sanitizeNameComponent(name: string, maxLen: number): string {
  const cleaned = name
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[\/\\:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned.length > 0 ? cleaned : "Untitled").slice(0, maxLen);
}

export function sanitizeDriveFolderName(name: string): string {
  return sanitizeNameComponent(name, 200);
}

/**
 * Same defensive rules as sanitizeDriveFolderName, capped shorter (60
 * chars) since this is meant for ONE component of a Part 4 renamed
 * filename (ActivityName_ScholarLastName_ScholarFirstName) — three
 * uncapped 200-char components could otherwise produce an unwieldy final
 * filename.
 */
export function sanitizeFileNameComponent(name: string): string {
  return sanitizeNameComponent(name, 60);
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * Finds a non-trashed folder by exact name directly under `parentId`;
 * creates it if none exists. This search-then-create is the actual
 * duplicate-prevention mechanism — the Supabase cache table the caller
 * checks first (submission_drive_folders) is purely a fast path so a warm
 * cache skips the Drive API entirely; this is what stays correct even on
 * a cache miss, a manually-cleared cache row, or a folder someone created
 * by hand in Drive directly.
 */
export async function findOrCreateFolder(accessToken: string, name: string, parentId: string): Promise<string> {
  const q =
    `name='${escapeDriveQueryValue(name)}' and '${parentId}' in parents ` +
    `and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const listUrl =
    `${DRIVE_FILES_URL}?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1` +
    `&supportsAllDrives=true&includeItemsFromAllDrives=true`;

  const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  const listJson = await listRes.json();
  if (!listRes.ok) {
    console.error("Drive folder search failed:", listJson);
    throwJsonError(`Failed to search Google Drive. (${driveErrorDetail(listJson)})`, 502);
  }
  const existingId = listJson.files?.[0]?.id;
  if (existingId) return existingId as string;

  const createRes = await fetch(`${DRIVE_FILES_URL}?supportsAllDrives=true`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
  });
  const createJson = await createRes.json();
  if (!createRes.ok || !createJson.id) {
    console.error("Drive folder create failed:", createJson);
    throwJsonError(`Failed to create a folder in Google Drive. (${driveErrorDetail(createJson)})`, 502);
  }
  return createJson.id as string;
}

/**
 * Milestone 2 of the "Drive folder reorganization + submission
 * monitoring" task. Reparents an existing Drive file — a real move
 * (single Drive API call swapping `parents`), never a download +
 * re-upload + delete, so the file's id, sharing links, and revision
 * history are all preserved exactly.
 *
 * Idempotent by design: `removeParents` is simply ignored by the Drive
 * API for any parent id the file is no longer actually attached to
 * (rather than erroring), so calling this again for a file that was
 * already moved by an earlier run is a safe no-op — the file just stays
 * in `newParentId`, exactly where it already was.
 */
export async function moveFile(accessToken: string, fileId: string, oldParentId: string, newParentId: string): Promise<void> {
  const url =
    `${DRIVE_FILES_URL}/${fileId}?addParents=${encodeURIComponent(newParentId)}` +
    `&removeParents=${encodeURIComponent(oldParentId)}&supportsAllDrives=true&fields=id,parents`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = await res.json();
  if (!res.ok) {
    console.error("Drive file move failed:", json);
    throwJsonError(`Failed to move a file in Google Drive. (${driveErrorDetail(json)})`, 502);
  }
}

/**
 * Part 4. Given a desired "<base><extension>" name, returns the first
 * name in that sequence (base, base_2, base_3, ...) that doesn't already
 * exist as a non-trashed file directly under `parentId` — checked live
 * against Drive itself, not just against this app's own
 * submission_uploads rows, since the year-level folder is shared across
 * every scholar submitting to that activity/year level and two different
 * scholars can end up with the same
 * ActivityName_LastName_FirstName base (same last/first name, or a
 * manually-added file with a colliding name). This is the same
 * search-then-act idempotent pattern findOrCreateFolder above already
 * uses for folders, applied to files.
 *
 * Bounded at 200 attempts purely so a pathological case (hundreds of
 * same-named files already in the folder) can't hang a request forever;
 * in practice this loop runs once or twice.
 */
export async function findAvailableFileName(
  accessToken: string, parentId: string, baseName: string, extension: string,
): Promise<string> {
  let candidate = `${baseName}${extension}`;
  for (let suffix = 2; suffix <= 200; suffix++) {
    const q = `name='${escapeDriveQueryValue(candidate)}' and '${parentId}' in parents and trashed=false`;
    const listUrl =
      `${DRIVE_FILES_URL}?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1` +
      `&supportsAllDrives=true&includeItemsFromAllDrives=true`;
    const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    const listJson = await listRes.json();
    if (!listRes.ok) {
      console.error("Drive file-name availability search failed:", listJson);
      throwJsonError(`Failed to check Google Drive for existing files. (${driveErrorDetail(listJson)})`, 502);
    }
    if (!listJson.files || listJson.files.length === 0) return candidate;
    candidate = `${baseName}_${suffix}${extension}`;
  }
  throwJsonError("Could not find an available file name in Google Drive.", 502);
}

/**
 * Uploads file bytes into `parentFolderId` under the given (already
 * collision-checked) name, using Drive's multipart/related upload
 * (metadata JSON part + raw byte part in one request) — the standard
 * simple-upload shape for files this small; no resumable-upload session
 * needed at this scale.
 */
export async function uploadFile(
  accessToken: string, parentFolderId: string, fileName: string, mimeType: string, bytes: Uint8Array,
): Promise<string> {
  const boundary = `drive-upload-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({ name: fileName, parents: [parentFolderId] });
  const encoder = new TextEncoder();

  const preamble = encoder.encode(
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${metadata}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType || "application/octet-stream"}\r\n\r\n`,
  );
  const closing = encoder.encode(`\r\n--${boundary}--`);

  const body = new Uint8Array(preamble.length + bytes.length + closing.length);
  body.set(preamble, 0);
  body.set(bytes, preamble.length);
  body.set(closing, preamble.length + bytes.length);

  const uploadRes = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    },
  );
  const uploadJson = await uploadRes.json();
  if (!uploadRes.ok || !uploadJson.id) {
    console.error("Drive file upload failed:", uploadJson);
    throwJsonError(`Failed to upload the file to Google Drive. (${driveErrorDetail(uploadJson)})`, 502);
  }
  return uploadJson.id as string;
}
