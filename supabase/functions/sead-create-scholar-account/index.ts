import { corsHeaders } from "../_shared/cors.ts";
import { requireSeadStaff } from "../_shared/verifySeadStaff.ts";
import { getStaffName, logScholarChange } from "../_shared/scholarLog.ts";

// New scholar accounts created from the SEAD UI start on the office's
// standard default password, same convention as the one-click reset.
// Scholars should be told to change it after first login (there's no
// forced-change enforcement yet — see scripts/import-scholars-from-csv.mjs
// for the alternative random-per-scholar-password approach used for bulk
// CSV imports, which is more secure for large batches).
const DEFAULT_PASSWORD = "123456";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { admin, callerId } = await requireSeadStaff(req);

    const body = await req.json();
    const scholarIdNumber = String(body.scholarIdNumber ?? "").trim();
    const firstName = String(body.firstName ?? "").trim();
    const lastName = String(body.lastName ?? "").trim();
    const middleName = String(body.middleName ?? "").trim();
    const birthday = String(body.birthday ?? "").trim(); // YYYY-MM-DD
    const address = String(body.address ?? "").trim();
    const school = String(body.school ?? "").trim();
    const course = String(body.course ?? "").trim();
    const civilStatus = String(body.civilStatus ?? "").trim();
    const contactNo = String(body.contactNo ?? "").trim();

    if (!scholarIdNumber || !firstName || !lastName || !birthday) {
      return new Response(JSON.stringify({ error: "Scholar ID, first name, last name, and birthday are required." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: existing } = await admin.from("scholars").select("id").eq("scholar_id_number", scholarIdNumber).maybeSingle();
    if (existing) {
      return new Response(JSON.stringify({ error: `Scholar ID ${scholarIdNumber} already exists.` }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const email = `${scholarIdNumber.toLowerCase()}@scholars.cedo.local`;

    const { data: authUser, error: createError } = await admin.auth.admin.createUser({
      email, password: DEFAULT_PASSWORD, email_confirm: true,
      user_metadata: { scholarIdNumber, kind: "scholar" },
    });
    if (createError || !authUser?.user) {
      return new Response(JSON.stringify({ error: createError?.message ?? "Failed to create login." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
      return new Response(JSON.stringify({ error: insertError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const staffName = await getStaffName(admin, callerId);
    await logScholarChange(admin, {
      action: "added",
      scholarId: authUser.user.id,
      scholarIdNumber,
      scholarName: `${firstName} ${lastName}`,
      performedBy: callerId,
      performedByName: staffName,
      source: "single",
    });

    return new Response(JSON.stringify({ ok: true, scholarIdNumber, defaultPassword: DEFAULT_PASSWORD }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    return new Response(JSON.stringify({ error: "Unexpected error." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
