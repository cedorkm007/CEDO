import { corsHeaders } from "../_shared/cors.ts";
import { requireItAdmin } from "../_shared/verifyItAdmin.ts";
import { issueTemporaryPassword } from "../_shared/temporaryPassword.ts";

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
      .from("school_accounts").select("id, schools(name)").eq("id", targetId).maybeSingle();
    if (lookupError || !target) {
      return new Response(JSON.stringify({ error: "School account not found." }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const schoolName = (target as { schools?: { name?: string } }).schools?.name ?? "This school";

    // A random temporary password, shown once, that the school must replace at its next sign-in.
    const issued = await issueTemporaryPassword(admin, targetId);
    if (!issued.ok) {
      return new Response(JSON.stringify({ error: issued.error }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, name: schoolName, temporaryPassword: issued.password, newPassword: issued.password, warning: issued.warning }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    return new Response(JSON.stringify({ error: "Unexpected error." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
