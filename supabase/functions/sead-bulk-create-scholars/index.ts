import { corsHeaders } from "../_shared/cors.ts";
import { requireSeadStaff } from "../_shared/verifySeadStaff.ts";
import { getStaffName, logScholarChange } from "../_shared/scholarLog.ts";
import { generateTemporaryPassword } from "../_shared/passwordPolicy.ts";
import { markMustChangePassword } from "../_shared/temporaryPassword.ts";

// Bulk version of sead-create-scholar-account, driven by the "Bulk Upload"
// button on the Scholars tab (staff downloads a CSV template, fills it in,
// uploads it — the frontend parses it into rows and posts them here).
//
// Every row gets its own RANDOM temporary password (the same kind the single-add flow now gives: shown once to staff, and the scholar must choose
// their own at first sign-in, because each account is marked). There is no shared default password any more.
//
// Runs row-by-row rather than in parallel: keeps behavior predictable. Each
// row is wrapped in its own try/catch — a genuinely unexpected failure on
// one row (network blip mid-request, etc.) must not take down the whole
// batch and lose every row already processed. Every row in the batch shares
// one batch_id in the audit log so the whole upload can be undone as a unit.

const MAX_ROWS = 500;


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
    const { admin, callerId } = await requireSeadStaff(req);

    const body = await req.json();
    const rows: ScholarRow[] = Array.isArray(body.scholars) ? body.scholars : [];
    const asRemoved = body.asRemoved === true;

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

    const staffName = await getStaffName(admin, callerId);
    const batchId: string = typeof body.batchId === "string" && body.batchId ? body.batchId : crypto.randomUUID();
    const results: RowResult[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      let scholarIdNumber = "";
      try {
        scholarIdNumber = String(r.scholarIdNumber ?? "").trim();
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
        const password = generateTemporaryPassword();

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
          status: asRemoved ? "Removed" : "Regular",
        });
        if (insertError) {
          // Roll back the auth user so we don't leave an orphaned login with no profile.
          await admin.auth.admin.deleteUser(authUser.user.id);
          results.push({ index: i, scholarIdNumber, ok: false, error: insertError.message });
          continue;
        }

        if (asRemoved) {
          // Historical record only — ban immediately so this account never has a working login.
          const { error: banError } = await admin.auth.admin.updateUserById(authUser.user.id, { ban_duration: "876000h" });
          if (banError) {
            await admin.auth.admin.deleteUser(authUser.user.id);
            results.push({ index: i, scholarIdNumber, ok: false, error: banError.message });
            continue;
          }
        }

        if (!asRemoved) {
          const markError = await markMustChangePassword(admin, authUser.user.id);
          if (markError) {
            // Never leave an account with a temporary password that does not have to be changed.
            await admin.from("scholars").delete().eq("id", authUser.user.id);
            await admin.auth.admin.deleteUser(authUser.user.id);
            results.push({ index: i, scholarIdNumber, ok: false, error: "Could not mark the account to choose a new password at sign-in (run the Phase 6 database update first)." });
            continue;
          }
        }

        await logScholarChange(admin, {
          action: "added",
          scholarId: authUser.user.id,
          scholarIdNumber,
          scholarName: `${firstName} ${lastName}`,
          performedBy: callerId,
          performedByName: staffName,
          batchId,
          source: "bulk",
          description: asRemoved ? "Added directly as Removed — no working login was ever issued." : undefined,
        });

        results.push({ index: i, scholarIdNumber, ok: true, password });
      } catch (rowError) {
        // Whatever went wrong, this row failed — but every other row in
        // the batch still needs to be attempted and reported.
        const message = rowError instanceof Error ? rowError.message : "Unexpected error processing this row.";
        results.push({ index: i, scholarIdNumber: scholarIdNumber || `row ${i + 1}`, ok: false, error: message });
      }
    }

    return new Response(JSON.stringify({ ok: true, batchId, results }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const message = thrown instanceof Error ? thrown.message : "Unexpected error.";
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
