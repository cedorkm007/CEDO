import { corsHeaders } from "../_shared/cors.ts";
import { requireSeadStaff } from "../_shared/verifySeadStaff.ts";
import { getStaffName, logScholarChange } from "../_shared/scholarLog.ts";

// Reverses a bulk scholar upload: finds every "added" log row for the given
// batch_id that hasn't already been undone, deletes each of those scholar
// accounts, and marks the original log rows as undone. Each removal is
// logged as its own 'removed' entry (source 'undo') so the history shows
// exactly what was reversed, when, and by whom — which may be a different
// staff member than the one who ran the original upload.
//
// Per-row try/catch for the same reason as sead-bulk-create-scholars: one
// row failing to delete (e.g. already removed individually since the
// upload) must not stop the rest of the batch from being undone.

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { admin, callerId } = await requireSeadStaff(req);

    const body = await req.json();
    const batchId = String(body.batchId ?? "").trim();
    if (!batchId) {
      return new Response(JSON.stringify({ error: "Missing batchId." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: batchRows, error: fetchError } = await admin
      .from("sead_scholar_account_log")
      .select("id, scholar_id, scholar_id_number, scholar_name")
      .eq("batch_id", batchId)
      .eq("action", "added")
      .eq("undone", false);

    if (fetchError) {
      return new Response(JSON.stringify({ error: fetchError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!batchRows || batchRows.length === 0) {
      return new Response(JSON.stringify({ error: "Nothing left to undo for this upload — it may have already been undone." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const staffName = await getStaffName(admin, callerId);
    const results: { scholarIdNumber: string; ok: boolean; error?: string }[] = [];

    for (const row of batchRows) {
      try {
        if (!row.scholar_id) {
          results.push({ scholarIdNumber: row.scholar_id_number, ok: false, error: "No account reference stored for this row." });
          continue;
        }

        const { error: deleteError } = await admin.auth.admin.deleteUser(row.scholar_id);
        if (deleteError) {
          results.push({ scholarIdNumber: row.scholar_id_number, ok: false, error: deleteError.message });
          continue;
        }

        await admin.from("sead_scholar_account_log").update({ undone: true }).eq("id", row.id);
        await logScholarChange(admin, {
          action: "removed",
          scholarId: row.scholar_id,
          scholarIdNumber: row.scholar_id_number,
          scholarName: row.scholar_name,
          performedBy: callerId,
          performedByName: staffName,
          batchId,
          source: "undo",
        });

        results.push({ scholarIdNumber: row.scholar_id_number, ok: true });
      } catch (rowError) {
        const message = rowError instanceof Error ? rowError.message : "Unexpected error undoing this row.";
        results.push({ scholarIdNumber: row.scholar_id_number, ok: false, error: message });
      }
    }

    const removedCount = results.filter(r => r.ok).length;
    return new Response(JSON.stringify({ ok: true, removedCount, results }), {
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
