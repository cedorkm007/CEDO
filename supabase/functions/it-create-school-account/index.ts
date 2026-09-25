import { corsHeaders } from "../_shared/cors.ts";
import { requireItAdmin } from "../_shared/verifyItAdmin.ts";

// Same convention as staff/scholar accounts — school logs in on this
// default password and can change it later (no forced-change enforcement
// yet, matching it-create-staff-account/it-create-scholar-account).
const DEFAULT_PASSWORD = "123456";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { admin } = await requireItAdmin(req);
    const body = await req.json();

    const schoolId = String(body.schoolId ?? "").trim();
    const email = String(body.email ?? "").trim();

    if (!schoolId || !email) {
      return new Response(JSON.stringify({ error: "School and email are required." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: school, error: schoolLookupError } = await admin.from("schools").select("id, name").eq("id", schoolId).maybeSingle();
    if (schoolLookupError || !school) {
      return new Response(JSON.stringify({ error: "School not found." }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: existingAccount } = await admin.from("school_accounts").select("id").eq("school_id", schoolId).maybeSingle();
    if (existingAccount) {
      return new Response(JSON.stringify({ error: `"${school.name}" already has an account.` }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: existingEmail } = await admin.from("school_accounts").select("id").ilike("email", email).maybeSingle();
    if (existingEmail) {
      return new Response(JSON.stringify({ error: `An account with email "${email}" already exists.` }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // email_confirm: true — created already-confirmed, so no confirmation
    // email is ever sent (sidesteps Supabase's built-in email rate limit,
    // same fix as staff/scholar accounts).
    const { data: authUser, error: createError } = await admin.auth.admin.createUser({
      email, password: DEFAULT_PASSWORD, email_confirm: true,
      user_metadata: { schoolId, kind: "school" },
    });
    if (createError || !authUser?.user) {
      return new Response(JSON.stringify({ error: createError?.message ?? "Failed to create login." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: insertError } = await admin.from("school_accounts").insert({
      id: authUser.user.id, school_id: schoolId, email,
    });
    if (insertError) {
      // Roll back the orphaned auth user if the account row insert failed.
      await admin.auth.admin.deleteUser(authUser.user.id);
      return new Response(JSON.stringify({ error: insertError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, schoolName: school.name, defaultPassword: DEFAULT_PASSWORD }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    return new Response(JSON.stringify({ error: "Unexpected error." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
