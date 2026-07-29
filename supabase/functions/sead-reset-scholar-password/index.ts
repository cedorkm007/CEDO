import { corsHeaders } from "../_shared/cors.ts";
import { requireSeadStaff } from "../_shared/verifySeadStaff.ts";

const DEFAULT_PASSWORD = "123456";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { admin } = await requireSeadStaff(req);

    const body = await req.json();
    const scholarIdNumber = String(body.scholarIdNumber ?? "").trim();
    if (!scholarIdNumber) {
      return new Response(JSON.stringify({ error: "scholarIdNumber is required." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: scholar, error: lookupError } = await admin
      .from("scholars")
      .select("id, first_name, last_name")
      .eq("scholar_id_number", scholarIdNumber)
      .maybeSingle();

    if (lookupError || !scholar) {
      return new Response(JSON.stringify({ error: `No scholar found with ID ${scholarIdNumber}.` }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: updateError } = await admin.auth.admin.updateUserById(scholar.id, { password: DEFAULT_PASSWORD });
    if (updateError) {
      return new Response(JSON.stringify({ error: updateError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, name: `${scholar.first_name} ${scholar.last_name}`, newPassword: DEFAULT_PASSWORD }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    return new Response(JSON.stringify({ error: "Unexpected error." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
