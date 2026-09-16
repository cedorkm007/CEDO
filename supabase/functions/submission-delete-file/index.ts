// Lets forms_management staff delete an already-attached submission
// file from the Review Submissions panel — either standalone, or
// automatically when a submission is marked "Needs Resubmission" (see
// reviewSubmissionUploads/deleteSubmissionUploadFile in
// submissionActivitiesApi.ts). Never deletes the submission_uploads
// row itself (there is no DELETE policy on it, by design — the row is
// the review's audit trail); only clears storage_path/drive_file_id
// and stamps file_removed_at, then removes the object from the
// "submission-uploads" Storage bucket. Storage writes for this bucket
// have always gone through a service-role Edge Function (see
// submission-upload-file/index.ts) rather than a client-side storage
// policy, so this follows the same convention.
import { corsHeaders } from "../_shared/cors.ts";
import { requireFormsManagementStaff } from "../_shared/verifyFormsManagementStaff.ts";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { admin } = await requireFormsManagementStaff(req);

    const body = await req.json().catch(() => ({}));
    const uploadId = String((body as Record<string, unknown>).uploadId ?? "").trim();
    if (!uploadId) return jsonResponse({ error: "uploadId is required." }, 400);

    const { data: row, error: rowError } = await admin
      .from("submission_uploads")
      .select("id, storage_path")
      .eq("id", uploadId)
      .maybeSingle();
    if (rowError) return jsonResponse({ error: rowError.message }, 500);
    if (!row) return jsonResponse({ error: "Upload not found." }, 404);

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
    console.error("submission-delete-file unexpected error:", thrown);
    return jsonResponse({ error: "Unexpected error while deleting the file." }, 500);
  }
});
