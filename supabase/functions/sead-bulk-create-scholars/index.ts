import { corsHeaders } from "../_shared/cors.ts";
import { requireSeadStaff } from "../_shared/verifySeadStaff.ts";

// Bulk version of sead-create-scholar-account, driven by the "Bulk Upload"
// button on the Scholars tab (staff downloads a CSV template, fills it in,
// uploads it — the frontend parses it into rows and posts them here).
//
// Unlike the single-add flow (one shared default password, "123456", meant
// to be changed by the scholar on first login), each row here gets its own
// random password. Handing the same default password to a whole freshly
// created batch at once is a bigger exposure than a single manually-created
// account — same reasoning scripts/import-scholars-from-csv.mjs uses.
//
// Runs row-by-row rather than in parallel: keeps behavior predictable, and
// means one bad row never blocks the rest of the batch — the response
// reports per-row success/failure so staff can fix and re-upload just the
// failed rows.

const MAX_ROWS = 500;

function generatePassword(length = 12): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

interface ScholarRow {
  scholarIdNumber?: string;
  firstName?: string;
  lastName?: string;
  middleName?: string;
  birthday?: string; // YYYY-MM-DD
  address?: string;
  school?: string;
  course?: string;
  civilStatus?: string;
  contactNo?: string;
}

interface RowResult {
  index: number;
  scholarIdNumber: string;
  ok: boolean;
  password?: string;
  error?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { admin } = await requireSeadStaff(req);

    const body = await req.json();
    const rows: ScholarRow[] = Array.isArray(body.scholars) ? body.scholars : [];

    if (rows.length === 0) {
      return new Response(JSON.stringify({ error: "No scholar rows provided." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (rows.length > MAX_ROWS) {
      return new Response(JSON.stringify({ error: `Too many rows in one batch (max ${MAX_ROWS}). Split the CSV into smaller files and upload separately.` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: RowResult[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const scholarIdNumber = String(r.scholarIdNumber ?? "").trim();
      const firstName = String(r.firstName ?? "").trim();
      const lastName = String(r.lastName ?? "").trim();
      const middleName = String(r.middleName ?? "").trim();
      const birthday = String(r.birthday ?? "").trim();
      const address = String(r.address ?? "").trim();
      const school = String(r.school ?? "").trim();
      const course = String(r.course ?? "").trim();
      const civilStatus = String(r.civilStatus ?? "").trim();
      const contactNo = String(r.contactNo ?? "").trim();
      const rowLabel = scholarIdNumber || `row ${i + 1}`;

      if (!scholarIdNumber || !firstName || !lastName || !birthday) {
        results.push({ index: i, scholarIdNumber: rowLabel, ok: false, error: "Missing Scholar ID, first name, last name, or birthday." });
        continue;
      }

      const { data: existing } = await admin.from("scholars").select("id").eq("scholar_id_number", scholarIdNumber).maybeSingle();
      if (existing) {
        results.push({ index: i, scholarIdNumber, ok: false, error: `Scholar ID ${scholarIdNumber} already exists.` });
        continue;
      }

      const email = `${scholarIdNumber.toLowerCase()}@scholars.cedo.local`;
      const password = generatePassword();

      const { data: authUser, error: createError } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { scholarIdNumber, kind: "scholar" },
      });
      if (createError || !authUser?.user) {
        results.push({ index: i, scholarIdNumber, ok: false, error: createError?.message ?? "Failed to create login." });
        continue;
      }

      const { error: insertError } = await admin.from("scholars").insert({
        id: authUser.user.id,
        scholar_id_number: scholarIdNumber,
        first_name: firstName,
        last_name: lastName,
        middle_name: middleName,
        birthday,
        email,
        address,
        school,
        course,
        civil_status: civilStatus,
        contact_no: contactNo,
      });
      if (insertError) {
        // Roll back the auth user so we don't leave an orphaned login with no profile.
        await admin.auth.admin.deleteUser(authUser.user.id);
        results.push({ index: i, scholarIdNumber, ok: false, error: insertError.message });
        continue;
      }

      results.push({ index: i, scholarIdNumber, ok: true, password });
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    return new Response(JSON.stringify({ error: "Unexpected error." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
