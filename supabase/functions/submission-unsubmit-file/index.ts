// Lets a scholar pull back their own submission file while it's still
// awaiting review, so they can upload a replacement — scholar-facing
// mirror of submission-delete-file/index.ts (staff-only). Never deletes
// the submission_uploads row itself (no DELETE policy on it, by design —
// the row is the review audit trail); only clears storage_path/
// drive_file_id and stamps file_removed_at, then removes the object from
// the "submission-uploads" Storage bucket, identical to the staff path.
//
// Deliberately restricted to status === 'uploaded' (still pending review)
// — once staff accepts a file, only staff can undo that (mark it "Needs
// Resubmission", which already frees the slot for a new upload today).
import { corsHeaders } from "../_shared/cors.ts";
import { requireScholar } from "../_shared/verifyScholar.ts";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { admin, scholar } = await requireScholar(req);

    const body = await req.json().catch(() => ({}));
    const uploadId = String((body as Record<string, unknown>).uploadId ?? "").trim();
    if (!uploadId) return jsonResponse({ error: "uploadId is required." }, 400);

    const { data: row, error: rowError } = await admin
      .from("submission_uploads")
      .select("id, scholar_id, status, storage_path, file_removed_at")
      .eq("id", uploadId)
      .maybeSingle();
    if (rowError) return jsonResponse({ error: rowError.message }, 500);
    if (!row) return jsonResponse({ error: "Upload not found." }, 404);
    if (row.scholar_id !== scholar.id) return jsonResponse({ error: "You can only unsubmit your own files." }, 403);
    if (row.file_removed_at) return jsonResponse({ error: "This file has already been removed." }, 400);
    if (row.status !== "uploaded") {
      return jsonResponse({ error: "Only a file still awaiting review can be unsubmitted." }, 400);
    }

    const storagePath = String(row.storage_path ?? "");
    if (storagePath) {
      const { error: removeError } = await admin.storage.from("submission-uploads").remove([storagePath]);
      if (removeError) return jsonResponse({ error: `Failed to delete the file: ${removeError.message}` }, 500);
    }

    const { error: updateError } = await admin
      .from("submission_uploads")
      .update({ storage_path: null, drive_file_id: "", file_removed_at: new Date().toISOString() })
      .eq("id", uploadId);
    if (updateError) return jsonResponse({ error: updateError.message }, 500);

    return jsonResponse({ ok: true }, 200);
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    console.error("submission-unsubmit-file unexpected error:", thrown);
    return jsonResponse({ error: "Unexpected error while unsubmitting the file." }, 500);
  }
});
