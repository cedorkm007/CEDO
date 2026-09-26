// Part 4 of the Submission Activity feature — actual scholar file
// upload. Given multipart/form-data { activityId, fieldId, file }:
//   1. Verifies the caller is a scholar (requireScholar) and that the
//      activity applies to their own year level — never trusts the
//      client's word for either.
//   2. Re-validates file type and the field's max-files rule
//      server-side — the UI already checks both, but this is the
//      boundary that actually matters (spec: "Enforce file type and
//      file-count rules again on the server, not only in the UI").
//   3. Stores the (already client-compressed, where applicable — see
//      src/scholar/submissionCompression.ts) file bytes in the private
//      "submission-uploads" Supabase Storage bucket at
//      "{scholar_id}/{upload_id}{ext}", then records the row in
//      submission_uploads via the service-role client — a scholar can
//      only ever insert a row with their own scholar_id (it's taken from
//      their verified JWT, never from the request body), and there is no
//      update/delete path here or anywhere else, so a scholar can never
//      overwrite or delete another scholar's file or their own past one.
//
// Formerly uploaded to Google Drive (Parent Folder / Activity Name /
// Scholar Year Level / School, with live collision-avoided renaming) —
// see supabase_migration_submission_supabase_storage.sql for the
// migration off Drive and supabase/functions/submission-backfill-drive-
// files for the one-time backfill of files uploaded before this change.
import { corsHeaders } from "../_shared/cors.ts";
import { requireScholar } from "../_shared/verifyScholar.ts";
import { isAllowedSubmissionUpload, SUBMISSION_ALLOWED_FILE_TYPES_LABEL } from "../_shared/allowedFileTypes.ts";

// Not part of the spec's explicit rules (file type + file count) but a
// reasonable defensive cap so one huge file can't tie up the function or
// blow past the Edge Function platform's own request-size ceiling with a
// worse, less helpful error. Easy to raise — nothing else depends on this
// exact number.
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function fileExtension(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  return idx >= 0 ? fileName.slice(idx) : "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { admin, scholar } = await requireScholar(req);

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return jsonResponse({ error: "Expected multipart/form-data with a file." }, 400);
    }

    const activityId = String(form.get("activityId") ?? "").trim();
    const fieldId = String(form.get("fieldId") ?? "").trim();
    const file = form.get("file");
    if (!activityId || !fieldId) return jsonResponse({ error: "activityId and fieldId are required." }, 400);
    if (!(file instanceof File)) return jsonResponse({ error: "No file was received." }, 400);
    if (file.size === 0) return jsonResponse({ error: "The selected file is empty." }, 400);
    if (file.size > MAX_UPLOAD_BYTES) {
      return jsonResponse({ error: `File is too large — the limit is ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.` }, 400);
    }

    // Re-derive activity + applicability server-side — never trust the
    // client's word for either.
    const { data: activity, error: activityError } = await admin
      .from("submission_activities")
      .select("id, name, all_year_levels, target_year_levels")
      .eq("id", activityId)
      .maybeSingle();
    if (activityError || !activity) return jsonResponse({ error: "Activity not found." }, 404);

    const yearLevel = scholar.yearLevel.trim();
    if (!yearLevel) return jsonResponse({ error: "Your account has no year level set — contact SEAD staff." }, 400);

    const targetYearLevels = (activity.target_year_levels as string[] | null) ?? [];
    const isApplicable = Boolean(activity.all_year_levels) || targetYearLevels.includes(yearLevel);
    if (!isApplicable) return jsonResponse({ error: "This activity does not apply to your year level." }, 403);

    // The UI can show a locked activity so scholars understand what remains,
    // but it is never the security boundary. This service-role RPC evaluates
    // every configured Quest/attendance/course/year-level rule for the
    // verified caller before any Drive folder or file is created.
    const { data: unlocked, error: unlockError } = await admin.rpc(
      "is_submission_activity_unlocked_for_scholar",
      { p_activity_id: activityId, p_scholar_id: scholar.id },
    );
    if (unlockError) return jsonResponse({ error: "Could not verify activity requirements." }, 500);
    if (!unlocked) return jsonResponse({ error: "This submission activity is locked. Complete all listed requirements before uploading." }, 403);

    const { data: field, error: fieldError } = await admin
      .from("submission_upload_fields")
      .select("id, label, max_files, allowed_categories")
      .eq("id", fieldId)
      .eq("activity_id", activityId)
      .maybeSingle();
    if (fieldError || !field) return jsonResponse({ error: "Upload field not found for this activity." }, 404);

    // Field-scoped type check — the actual security boundary for this
    // rule, checked here (after the field is known) rather than earlier
    // with a blanket "any accepted type" check, since a field can accept
    // a subset of SUBMISSION_ALLOWED_FILE_TYPES
    // (supabase_migration_submission_upload_field_categories.sql).
    // Existing fields created before that migration default to every
    // category server-side too (see that migration's own backfill), so
    // this doesn't change behavior for anything created before this
    // update.
    const allowedCategories = (Array.isArray(field.allowed_categories) ? field.allowed_categories as string[] : null) ?? undefined;
    if (!isAllowedSubmissionUpload(file.name, file.type, allowedCategories)) {
      const allowedLabel = allowedCategories && allowedCategories.length > 0 ? allowedCategories.join(", ") : SUBMISSION_ALLOWED_FILE_TYPES_LABEL;
      return jsonResponse(
        { error: `"${file.name}" isn't an accepted file type for "${field.label}". Allowed: ${allowedLabel}.` },
        400,
      );
    }

    // Server-side re-check of the max-files rule for THIS scholar/field —
    // the real boundary; the UI's own count is only a convenience. A file
    // staff marked "needs_resubmission" doesn't occupy its slot — otherwise
    // a rejected scholar could never upload a replacement once a field was
    // already at its limit. Same for a file removed via submission-delete-file
    // (staff) or submission-unsubmit-file (scholar, while still pending
    // review) — file_removed_at is set but status is left untouched (see
    // either function's own comment), so it must be excluded here too or a
    // scholar could never re-upload into a slot they (or staff) already freed.
    const { count: existingCount, error: countError } = await admin
      .from("submission_uploads")
      .select("id", { count: "exact", head: true })
      .eq("scholar_id", scholar.id)
      .eq("field_id", fieldId)
      .neq("status", "needs_resubmission")
      .is("file_removed_at", null);
    if (countError) return jsonResponse({ error: countError.message }, 500);
    if ((existingCount ?? 0) >= (field.max_files as number)) {
      return jsonResponse(
        { error: `You've already reached the limit of ${field.max_files} file(s) for "${field.label}".` },
        400,
      );
    }

    const uploadId = crypto.randomUUID();
    const extension = fileExtension(file.name);
    const storagePath = `${scholar.id}/${uploadId}${extension}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mimeType = file.type || "application/octet-stream";

    const { error: storageError } = await admin.storage
      .from("submission-uploads")
      .upload(storagePath, bytes, { contentType: mimeType, upsert: false });
    if (storageError) return jsonResponse({ error: `Failed to store the file: ${storageError.message}` }, 500);

    const { data: inserted, error: insertError } = await admin
      .from("submission_uploads")
      .insert({
        id: uploadId,
        scholar_id: scholar.id,
        activity_id: activityId,
        field_id: fieldId,
        field_label_snapshot: field.label,
        original_file_name: file.name,
        renamed_file_name: file.name,
        mime_type: mimeType,
        drive_file_id: "",
        storage_path: storagePath,
        file_size_bytes: file.size,
        status: "uploaded",
      })
      .select("id, original_file_name, renamed_file_name, mime_type, storage_path, status, created_at")
      .single();

    if (insertError || !inserted) {
      // Unlike the old Drive path, this is our own bucket — clean up the
      // just-uploaded object so a failed insert never leaves an untracked
      // file with no DB row, rather than leaving an orphan and hoping a
      // retry doesn't collide (there's no OAuth-quota reason to tolerate
      // an orphan here the way there was with Drive).
      await admin.storage.from("submission-uploads").remove([storagePath]);
      console.error(`Stored file at ${storagePath} but failed to record it in Supabase:`, insertError?.message);
      return jsonResponse({ error: "File was uploaded but couldn't be recorded — please retry." }, 500);
    }

    return jsonResponse(
      {
        ok: true,
        upload: {
          id: inserted.id,
          originalFileName: inserted.original_file_name,
          renamedFileName: inserted.renamed_file_name,
          mimeType: inserted.mime_type,
          storagePath: inserted.storage_path,
          status: inserted.status,
          createdAt: inserted.created_at,
        },
      },
      200,
    );
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    console.error("submission-upload-file unexpected error:", thrown);
    return jsonResponse({ error: "Unexpected error while uploading." }, 500);
  }
});
