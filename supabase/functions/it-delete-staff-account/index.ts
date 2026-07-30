import { corsHeaders } from "../_shared/cors.ts";
import { requireItAdmin } from "../_shared/verifyItAdmin.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { admin, callerId } = await requireItAdmin(req);
    const body = await req.json();
    const targetId = String(body.id ?? "").trim();

    if (!targetId) {
      return new Response(JSON.stringify({ error: "id is required." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (targetId === callerId) {
      return new Response(JSON.stringify({ error: "You can't delete your own account from here." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: target, error: lookupError } = await admin
      .from("users").select("id, username, first_name, last_name").eq("id", targetId).maybeSingle();
    if (lookupError || !target) {
      return new Response(JSON.stringify({ error: "Staff account not found." }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Remove the profile row first, then the login. If the login delete fails,
    // we've at least removed their access to app data instead of the reverse
    // (a login with no profile, which would break the app's sign-in flow).
    const { error: deleteProfileError } = await admin.from("users").delete().eq("id", targetId);
    if (deleteProfileError) {
      return new Response(JSON.stringify({ error: deleteProfileError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: deleteAuthError } = await admin.auth.admin.deleteUser(targetId);
    if (deleteAuthError) {
      return new Response(JSON.stringify({ error: `Profile removed, but the login itself failed to delete: ${deleteAuthError.message}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, name: `${target.first_name} ${target.last_name}` }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    return new Response(JSON.stringify({ error: "Unexpected error." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
