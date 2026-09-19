import { corsHeaders } from "../_shared/cors.ts";
import { requireSeadStaff } from "../_shared/verifySeadStaff.ts";
import { getStaffName, logScholarChange } from "../_shared/scholarLog.ts";

// Marks an existing scholar as "Removed": bans their Supabase Auth login
// (ban_duration, not deleteUser — this is reversible, unlike
// sead-delete-scholar-account) and sets scholars.status to 'Removed',
// remembering the prior status so sead-restore-scholar-account can put it
// back. The scholar's row and all their history stay intact; they're just
// siloed out of the active roster and can no longer sign in.

const BAN_DURATION = "876000h"; // ~100 years — GoTrue has no "forever" sentinel; "none" specifically means unban.

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
      .from("scholars").select("id, scholar_id_number, first_name, last_name, status").eq("id", id).maybeSingle();
    if (fetchError || !scholar) {
      return new Response(JSON.stringify({ error: "Scholar account not found." }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (scholar.status === "Removed") {
      return new Response(JSON.stringify({ error: "This scholar is already removed." }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: banError } = await admin.auth.admin.updateUserById(id, { ban_duration: BAN_DURATION });
    if (banError) {
      return new Response(JSON.stringify({ error: banError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: updateError } = await admin.from("scholars")
      .update({ status: "Removed", status_before_removal: scholar.status })
      .eq("id", id);
    if (updateError) {
      // Undo the ban so the account isn't left locked out with no status change to show for it.
      await admin.auth.admin.updateUserById(id, { ban_duration: "none" });
      return new Response(JSON.stringify({ error: updateError.message }), {
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
      description: `Marked as Removed (was ${scholar.status}) — login deactivated.`,
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
