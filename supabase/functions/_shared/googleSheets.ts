// Minimal Google Sheets "append a row" helper, using a service account —
// unlike googleDrive.ts (which acts as a real Google account via an OAuth
// refresh token, since a bare service account gets no Drive storage quota
// of its own), Sheets has no such quota problem: a service account just
// needs Editor access on the one target spreadsheet (shared with its
// client_email from the Sheet's own Share dialog), and can call the
// Sheets API directly under its own identity.
//
// Requires three secrets:
//   GOOGLE_SHEETS_CLIENT_EMAIL   — the service account's client_email
//   GOOGLE_SHEETS_PRIVATE_KEY    — its PEM private key, literal "\n" for
//                                  newlines (this file unescapes them)
//   GOOGLE_SHEETS_SHEET_ID       — the target spreadsheet's id (from its
//                                  URL: /spreadsheets/d/<this part>/edit)
//
// Keep this module server-only: none of these secrets may reach the browser.

import { throwJsonError } from "./cors.ts";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

/**
 * Signs a short-lived JWT with the service account's own private key (the
 * "JWT bearer" flow — no refresh token, no user consent screen, since a
 * service account authenticates as itself) and exchanges it for a Sheets
 * API access token. Cached per warm Edge Function instance, same pattern
 * as getGoogleAccessToken in googleDrive.ts.
 */
async function getSheetsAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 60 > now) return cachedToken.value;

  const clientEmail = Deno.env.get("GOOGLE_SHEETS_CLIENT_EMAIL");
  const privateKeyPem = Deno.env.get("GOOGLE_SHEETS_PRIVATE_KEY")?.replace(/\\n/g, "\n");
  if (!clientEmail || !privateKeyPem) {
    throwJsonError("Google Sheets credentials are not configured yet.", 500);
  }

  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: clientEmail,
    scope: SHEETS_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const encoder = new TextEncoder();
  const unsigned =
    `${base64UrlEncode(encoder.encode(JSON.stringify(header)))}.` +
    `${base64UrlEncode(encoder.encode(JSON.stringify(claims)))}`;

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, encoder.encode(unsigned));
  const jwt = `${unsigned}.${base64UrlEncode(new Uint8Array(signature))}`;

  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const tokenJson: { access_token?: unknown; expires_in?: unknown; error_description?: unknown } =
    await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || typeof tokenJson.access_token !== "string" || !tokenJson.access_token) {
    console.error("Google Sheets token exchange failed:", tokenJson);
    throwJsonError(`Failed to authenticate with Google Sheets. (${tokenJson.error_description ?? "unknown error"})`, 502);
  }

  const expiresIn = Number(tokenJson.expires_in);
  cachedToken = { value: tokenJson.access_token, expiresAt: now + (Number.isFinite(expiresIn) ? expiresIn : 3600) };
  return cachedToken.value;
}

const cachedGridIds = new Map<string, number>();

/**
 * batchUpdate requests address a tab by its numeric grid id, not its name
 * — resolved once per warm instance per (spreadsheet, tab name) pair and
 * cached, same reasoning as the access token cache above.
 */
async function getSheetGridId(spreadsheetId: string, accessToken: string, sheetName: string): Promise<number> {
  const cacheKey = `${spreadsheetId}:${sheetName}`;
  const cached = cachedGridIds.get(cacheKey);
  if (cached !== undefined) return cached;

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties(sheetId,title)`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("Google Sheets metadata lookup failed:", json);
    throwJsonError("Failed to look up the spreadsheet's tabs.", 502);
  }
  const sheets = (json as { sheets?: { properties: { sheetId: number; title: string } }[] }).sheets ?? [];
  const match = sheets.find(s => s.properties.title === sheetName);
  if (!match) throwJsonError(`Tab "${sheetName}" was not found in the spreadsheet.`, 500);

  cachedGridIds.set(cacheKey, match.properties.sheetId);
  return match.properties.sheetId;
}

/**
 * Appends one row to the end of `sheetName` (a tab within the configured
 * spreadsheet — "Sheet1" is a new Google Sheet's default tab name).
 * USER_ENTERED so a value like a date string gets Google Sheets' own
 * normal parsing, same as typing it in by hand, rather than being forced
 * to store it as a literal string.
 *
 * `addCheckboxAfter: true` also drops an unchecked checkbox into the
 * column immediately following the appended values (e.g. for staff to
 * tick once a request has been handled) — a separate batchUpdate call
 * against the exact row `values.append` reports it landed on, since the
 * plain values.append endpoint has no concept of cell formatting/data
 * validation itself.
 */
export async function appendSheetRow(sheetName: string, values: string[], options?: { addCheckboxAfter?: boolean }): Promise<void> {
  const sheetId = Deno.env.get("GOOGLE_SHEETS_SHEET_ID");
  if (!sheetId) throwJsonError("Google Sheets is not configured yet.", 500);

  const accessToken = await getSheetsAccessToken();
  const range = encodeURIComponent(`${sheetName}!A:Z`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [values] }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("Google Sheets append failed:", json);
    const message = (json as { error?: { message?: string } })?.error?.message ?? "unknown error";
    throwJsonError(`Failed to record the request. (${message})`, 502);
  }
  if (!options?.addCheckboxAfter) return;

  const updatedRange = (json as { updates?: { updatedRange?: string } }).updates?.updatedRange;
  const rowMatch = updatedRange?.match(/![A-Z]+(\d+):/);
  if (!rowMatch) {
    // The row was already written successfully — a missing checkbox is a
    // cosmetic gap, not worth failing the whole request over.
    console.error("Could not parse the appended row number from:", updatedRange);
    return;
  }
  const rowIndex = Number(rowMatch[1]) - 1; // batchUpdate row/column indexes are 0-based
  const columnIndex = values.length;
  const gridId = await getSheetGridId(sheetId, accessToken, sheetName);

  const batchRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [{
        repeatCell: {
          range: { sheetId: gridId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: columnIndex, endColumnIndex: columnIndex + 1 },
          cell: { userEnteredValue: { boolValue: false }, dataValidation: { condition: { type: "BOOLEAN" }, strict: true } },
          fields: "userEnteredValue,dataValidation",
        },
      }],
    }),
  });
  const batchJson = await batchRes.json().catch(() => ({}));
  if (!batchRes.ok) {
    // Same reasoning as above — the row itself is already recorded.
    console.error("Google Sheets checkbox batchUpdate failed:", batchJson);
  }
}
