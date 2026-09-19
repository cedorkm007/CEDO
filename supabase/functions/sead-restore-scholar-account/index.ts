import { corsHeaders } from "../_shared/cors.ts";
import { requireSeadStaff } from "../_shared/verifySeadStaff.ts";
import { getStaffName, logScholarChange } from "../_shared/scholarLog.ts";

// Undoes sead-remove-scholar-account: un-bans the scholar's Supabase Auth
// login and restores scholars.status to whatever it was right before
// removal (status_before_removal), or 'Regular' if that's unset — which is
// the case for a scholar added directly as Removed (a historical record
// that never had a "prior" active status).

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
      .from("scholars").select("id, scholar_id_number, first_name, last_name, status, status_before_removal").eq("id", id).maybeSingle();
    if (fetchError || !scholar) {
      return new Response(JSON.stringify({ error: "Scholar account not found." }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (scholar.status !== "Removed") {
      return new Response(JSON.stringify({ error: "This scholar isn't removed." }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: unbanError } = await admin.auth.admin.updateUserById(id, { ban_duration: "none" });
    if (unbanError) {
      return new Response(JSON.stringify({ error: unbanError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const restoredStatus = scholar.status_before_removal ?? "Regular";
    const { error: updateError } = await admin.from("scholars")
      .update({ status: restoredStatus, status_before_removal: null })
      .eq("id", id);
    if (updateError) {
      return new Response(JSON.stringify({ error: updateError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const staffName = await getStaffName(admin, callerId);
    await logScholarChange(admin, {
      action: "updated",
      scholarId: scholar.id,
      scholarIdNumber: scholar.scholar_id_number,
      scholarName: `${scholar.first_name} ${scholar.last_name}`,
      performedBy: callerId,
      performedByName: staffName,
      source: "single",
      description: `Restored from Removed to ${restoredStatus} — login reactivated.`,
    });

    return new Response(JSON.stringify({ ok: true, scholarIdNumber: scholar.scholar_id_number, status: restoredStatus }), {
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
