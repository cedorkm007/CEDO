// Scholar Portal "forgot password" stand-in — the real forgot-password
// flow isn't functional yet, so this collects enough identifying info for
// staff to manually verify and reset a scholar's password by hand,
// recorded as a new row in a staff-managed Google Sheet (see
// ../_shared/googleSheets.ts). Deliberately public/unauthenticated
// (deployed with --no-verify-jwt): the whole point is reaching someone
// who can't log in, so there's no session to verify.
import { corsHeaders } from "../_shared/cors.ts";
import { appendSheetRow } from "../_shared/googleSheets.ts";

const SHEET_TAB_NAME = "Sheet1";
const MAX_FIELD_LENGTH = 200;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function cleanField(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, MAX_FIELD_LENGTH) : "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid request." }, 400);
    }

    const scholarId = cleanField(body.scholarId); // optional
    const lastName = cleanField(body.lastName);
    const firstName = cleanField(body.firstName);
    const middleInitial = cleanField(body.middleInitial);
    const school = cleanField(body.school);
    const yearLevel = cleanField(body.yearLevel);

    const missing: string[] = [];
    if (!lastName) missing.push("Last Name");
    if (!firstName) missing.push("First Name");
    if (!school) missing.push("School");
    if (!yearLevel) missing.push("Year Level");
    if (missing.length > 0) {
      return jsonResponse({ error: `Please fill in: ${missing.join(", ")}.` }, 400);
    }

    await appendSheetRow(
      SHEET_TAB_NAME,
      [new Date().toISOString(), scholarId, lastName, firstName, middleInitial, school, yearLevel],
      { addCheckboxAfter: true }, // an unchecked "Processed" box right after Year Level, for staff to tick once handled
    );

    return jsonResponse({ ok: true }, 200);
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    console.error("scholar-password-reset-request unexpected error:", thrown);
    return jsonResponse({ error: "Unexpected error while submitting the request." }, 500);
  }
});
