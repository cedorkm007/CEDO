import { corsHeaders } from "../_shared/cors.ts";
import { requireSeadStaff } from "../_shared/verifySeadStaff.ts";
import { getStaffName, logScholarChange } from "../_shared/scholarLog.ts";

// Removes one scholar account: deletes their Supabase Auth login, which
// cascades (on delete cascade, see supabase_migration_scholar_portal.sql)
// to remove their public.scholars profile row automatically. Records the
// removal in the audit log before returning.

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { admin, callerId } = await requireSeadStaff(req);

    const body = await req.json();
    const id = String(body.id ?? "").trim();
    if (!id) {
      return new Response(JSON.stringify({ error: "Missing scholar id." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: scholar, error: fetchError } = await admin
      .from("scholars").select("id, scholar_id_number, first_name, last_name").eq("id", id).maybeSingle();
    if (fetchError || !scholar) {
      return new Response(JSON.stringify({ error: "Scholar account not found." }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: deleteError } = await admin.auth.admin.deleteUser(id);
    if (deleteError) {
      return new Response(JSON.stringify({ error: deleteError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const staffName = await getStaffName(admin, callerId);
    await logScholarChange(admin, {
      action: "removed",
      scholarId: scholar.id,
      scholarIdNumber: scholar.scholar_id_number,
      scholarName: `${scholar.first_name} ${scholar.last_name}`,
      performedBy: callerId,
      performedByName: staffName,
      source: "single",
    });

    return new Response(JSON.stringify({ ok: true, scholarIdNumber: scholar.scholar_id_number, name: `${scholar.first_name} ${scholar.last_name}` }), {
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
