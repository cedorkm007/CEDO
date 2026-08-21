// Minimal Google Drive folder find-or-create helper — Part 3 of the
// Submission Activity feature (foundation only; actual file upload is
// Part 4, not implemented here).
//
// Hand-rolls the service-account JWT-bearer OAuth exchange with Deno's
// built-in Web Crypto instead of pulling in the googleapis npm package:
// Edge Functions run on Deno, this sandbox has no network to verify an
// esm.sh dependency actually resolves/works here, and the flow itself is
// a few dozen lines — not worth the dependency risk for that.
//
// Requires three secrets (see docs/GOOGLE_DRIVE_SETUP.md for exact setup
// steps and placeholder values):
//   GOOGLE_SERVICE_ACCOUNT_EMAIL
//   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY   (PEM; see setup doc for the
//     newline-escaping `supabase secrets set` needs for a multi-line value)
//   GOOGLE_DRIVE_PARENT_FOLDER_ID
//
// The parent Drive folder must be shared with the service account's own
// email as an Editor — a service account has no Drive storage of its own
// to create anything in otherwise; sharing a real user's/Shared Drive
// folder with it is the standard way around that.
//
// Never expose these secrets, or this module, to the frontend — it only
// ever runs inside an Edge Function.

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  // `supabase secrets set` stores whatever string it's given; a PEM's real
  // newlines are commonly passed through as literal "\n" so the value
  // survives as one line — accept either form.
  const cleaned = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

/**
 * Signs a short-lived service-account JWT and exchanges it for a Drive
 * access token. Cached in-memory for this function instance's lifetime as
 * a pure optimization for back-to-back calls on a warm instance — always
 * re-checked against its own expiry first, never assumed valid, and a
 * cold/new instance just re-fetches with no correctness difference either
 * way.
 */
export async function getGoogleAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 60 > now) return cachedToken.value;

  const email = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const privateKeyPem = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY");
  if (!email || !privateKeyPem) {
    throw new Response(JSON.stringify({ error: "Google Drive credentials are not configured yet." }), {
      status: 500,
    });
  }

  const header = { alg: "RS256", typ: "JWT" };
  const claim = { iss: email, scope: DRIVE_SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 };
  const encoder = new TextEncoder();
  const unsigned =
    `${base64UrlEncode(encoder.encode(JSON.stringify(header)))}.` +
    `${base64UrlEncode(encoder.encode(JSON.stringify(claim)))}`;

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "pkcs8",
      pemToArrayBuffer(privateKeyPem),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch (thrown) {
    console.error("Failed to import Google service account private key:", thrown);
    throw new Response(JSON.stringify({ error: "Google Drive credentials are misconfigured." }), { status: 500 });
  }

  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(unsigned));
  const jwt = `${unsigned}.${base64UrlEncode(new Uint8Array(signature))}`;

  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const tokenJson = await tokenRes.json();
  if (!tokenRes.ok || !tokenJson.access_token) {
    console.error("Google token exchange failed:", tokenJson);
    throw new Response(JSON.stringify({ error: "Failed to authenticate with Google Drive." }), { status: 502 });
  }

  cachedToken = { value: tokenJson.access_token, expiresAt: now + (tokenJson.expires_in ?? 3600) };
  return cachedToken.value;
}

/**
 * Strips/replaces characters worth avoiding in a Drive folder name even
 * though Drive itself is lenient about most of them — same defensive
 * posture Part 4's file renaming will need anyway, and keeps the
 * structure copy-paste-safe if staff ever mirror/export it elsewhere.
 * Caps length defensively; Drive's real limit is far higher.
 */
export function sanitizeDriveFolderName(name: string): string {
  const cleaned = name
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[\/\\:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned.length > 0 ? cleaned : "Untitled").slice(0, 200);
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
    throw new Response(JSON.stringify({ error: "Failed to search Google Drive." }), { status: 502 });
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
    throw new Response(JSON.stringify({ error: "Failed to create a folder in Google Drive." }), { status: 502 });
  }
  return createJson.id as string;
}
