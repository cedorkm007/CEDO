import { corsHeaders } from "../_shared/cors.ts";
import { requireItAdmin } from "../_shared/verifyItAdmin.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { admin } = await requireItAdmin(req);
    const body = await req.json();
    const targetId = String(body.id ?? "").trim();

    if (!targetId) {
      return new Response(JSON.stringify({ error: "id is required." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: target, error: lookupError } = await admin
      .from("school_accounts").select("id, school_id, schools(name)").eq("id", targetId).maybeSingle();
    if (lookupError || !target) {
      return new Response(JSON.stringify({ error: "School account not found." }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const schoolName = (target as { schools?: { name?: string } }).schools?.name ?? "This school";

    // Remove the account row first, then the login. If the login delete
    // fails, we've at least removed their access to app data instead of the
    // reverse (a login with no account row, which would break sign-in).
    const { error: deleteRowError } = await admin.from("school_accounts").delete().eq("id", targetId);
    if (deleteRowError) {
      return new Response(JSON.stringify({ error: deleteRowError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: deleteAuthError } = await admin.auth.admin.deleteUser(targetId);
    if (deleteAuthError) {
      return new Response(JSON.stringify({ error: `Account removed, but the login itself failed to delete: ${deleteAuthError.message}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, name: schoolName }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    return new Response(JSON.stringify({ error: "Unexpected error." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
