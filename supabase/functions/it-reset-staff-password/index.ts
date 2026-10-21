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
      .from("users").select("id, first_name, last_name").eq("id", targetId).maybeSingle();
    if (lookupError || !target) {
      return new Response(JSON.stringify({ error: "Staff account not found." }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // A random temporary password, shown once, that the person must replace at their next sign-in.
    const issued = await issueTemporaryPassword(admin, targetId);
    if (!issued.ok) {
      return new Response(JSON.stringify({ error: issued.error }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, name: `${target.first_name} ${target.last_name}`, temporaryPassword: issued.password, newPassword: issued.password, warning: issued.warning }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    return new Response(JSON.stringify({ error: "Unexpected error." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
