import { corsHeaders } from "../_shared/cors.ts";
import { requireItAdmin } from "../_shared/verifyItAdmin.ts";

// New staff accounts start on this password — same convention as scholar
// accounts. Staff should change it after first login (Change Password in
// their profile). No forced-change enforcement yet.
const DEFAULT_PASSWORD = "123456";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { admin } = await requireItAdmin(req);
    const body = await req.json();

    const lastName = String(body.lastName ?? "").trim();
    const firstName = String(body.firstName ?? "").trim();
    const middleName = String(body.middleName ?? "").trim();
    const suffix = String(body.suffix ?? "").trim();
    const nickname = String(body.nickname ?? "").trim();
    const username = String(body.username ?? "").trim();
    const designation = String(body.designation ?? "").trim();
    const position = String(body.position ?? "").trim();
    const natureOfWork = String(body.natureOfWork ?? "").trim();
    const mobilePhone = String(body.mobilePhone ?? "").trim();
    const email = String(body.email ?? "").trim();
    const division = String(body.division ?? "").trim();
    const role = String(body.role ?? "staff").trim(); // "staff" | "division_admin" | "super_admin"

    if (!lastName || !firstName || !username || !email || !division) {
      return new Response(JSON.stringify({ error: "Last name, first name, username, email, and division are required." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!["staff", "division_admin", "super_admin"].includes(role)) {
      return new Response(JSON.stringify({ error: "Invalid role." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: existingUsername } = await admin.from("users").select("id").eq("username", username).maybeSingle();
    if (existingUsername) {
      return new Response(JSON.stringify({ error: `Username "${username}" is already taken.` }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: existingEmail } = await admin.from("users").select("id").ilike("email", email).maybeSingle();
    if (existingEmail) {
      return new Response(JSON.stringify({ error: `An account with email "${email}" already exists.` }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // email_confirm: true — the account is created already-confirmed, so no
    // confirmation email is ever sent (this is what sidesteps Supabase's
    // built-in email rate limit entirely, same fix as scholar accounts).
    const { data: authUser, error: createError } = await admin.auth.admin.createUser({
      email, password: DEFAULT_PASSWORD, email_confirm: true,
      user_metadata: { username, division, role },
    });
    if (createError || !authUser?.user) {
      return new Response(JSON.stringify({ error: createError?.message ?? "Failed to create login." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: insertError } = await admin.from("users").insert({
      id: authUser.user.id,
      username, last_name: lastName, first_name: firstName, middle_name: middleName,
      suffix, nickname, designation, position, nature_of_work: natureOfWork,
      mobile_phone: mobilePhone, email, is_admin: role !== "staff",
      division, role, profile_picture: "",
    });
    if (insertError) {
      // Roll back the orphaned auth user if the profile insert failed.
      await admin.auth.admin.deleteUser(authUser.user.id);
      return new Response(JSON.stringify({ error: insertError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, username, defaultPassword: DEFAULT_PASSWORD }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    return new Response(JSON.stringify({ error: "Unexpected error." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
