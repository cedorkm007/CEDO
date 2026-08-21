// Part 4 of the Submission Activity feature — actual scholar file
// upload. Given multipart/form-data { activityId, fieldId, file }:
//   1. Verifies the caller is a scholar (requireScholar) and that the
//      activity applies to their own year level — never trusts the
//      client's word for either.
//   2. Re-validates file type and the field's max-files rule
//      server-side — the UI already checks both, but this is the
//      boundary that actually matters (spec: "Enforce file type and
//      file-count rules again on the server, not only in the UI").
//   3. Ensures the Parent Folder / Activity Name / Scholar Year Level /
//      structure exists (shared with Part 3's submission-ensure-drive-folder
//      via ../_shared/ensureSubmissionDriveFolders.ts).
//   4. Renames the file to ActivityName_ScholarLastName_ScholarFirstName
//      (+ extension), appending _2/_3/... if that name is already taken
//      in the destination folder (checked live against Drive — see
//      findAvailableFileName's own comment for why that, not just this
//      app's own rows, is the actual duplicate-prevention mechanism).
//   5. Uploads the bytes to Drive, then records the row in
//      submission_uploads via the service-role client — a scholar can
//      only ever insert a row with their own scholar_id (it's taken from
//      their verified JWT, never from the request body), and there is no
//      update/delete path here or anywhere else, so a scholar can never
//      overwrite or delete another scholar's file or their own past one.
//
// Google Drive credentials are never sent to or readable from the
// browser — this function only ever runs server-side, same as Part 3.
import { corsHeaders } from "../_shared/cors.ts";
import { requireScholar } from "../_shared/verifyScholar.ts";
import { getGoogleAccessToken, sanitizeFileNameComponent, findAvailableFileName, uploadFile } from "../_shared/googleDrive.ts";
import { ensureSubmissionDriveFolders } from "../_shared/ensureSubmissionDriveFolders.ts";
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
    if (!isAllowedSubmissionUpload(file.name, file.type)) {
      return jsonResponse(
        { error: `"${file.name}" isn't an accepted file type. Allowed: ${SUBMISSION_ALLOWED_FILE_TYPES_LABEL}.` },
        400,
      );
    }

    // Re-derive activity + applicability server-side — same check as
    // submission-ensure-drive-folder, duplicated rather than imported
    // from there since that function's own job is folder-ensuring, not
    // being a general-purpose "check applicability" library call.
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

    const { data: field, error: fieldError } = await admin
      .from("submission_upload_fields")
      .select("id, label, max_files")
      .eq("id", fieldId)
      .eq("activity_id", activityId)
      .maybeSingle();
    if (fieldError || !field) return jsonResponse({ error: "Upload field not found for this activity." }, 404);

    // Server-side re-check of the max-files rule for THIS scholar/field —
    // the real boundary; the UI's own count is only a convenience.
    const { count: existingCount, error: countError } = await admin
      .from("submission_uploads")
      .select("id", { count: "exact", head: true })
      .eq("scholar_id", scholar.id)
      .eq("field_id", fieldId);
    if (countError) return jsonResponse({ error: countError.message }, 500);
    if ((existingCount ?? 0) >= (field.max_files as number)) {
      return jsonResponse(
        { error: `You've already reached the limit of ${field.max_files} file(s) for "${field.label}".` },
        400,
      );
    }

    const parentFolderId = Deno.env.get("GOOGLE_DRIVE_PARENT_FOLDER_ID");
    if (!parentFolderId) return jsonResponse({ error: "Google Drive is not configured yet." }, 500);

    // Needed regardless of whether the folder structure is a cache hit or
    // miss (the upload call itself always needs one), so it's fetched
    // once up front and handed to ensureSubmissionDriveFolders as an
    // already-resolved thunk instead of letting it fetch a second one on
    // a miss.
    const accessToken = await getGoogleAccessToken();
    const { yearLevelFolderId } = await ensureSubmissionDriveFolders(
      admin, parentFolderId, activityId, activity.name as string, yearLevel, () => Promise.resolve(accessToken),
    );

    const extension = fileExtension(file.name);
    const baseName = [
      sanitizeFileNameComponent(activity.name as string),
      sanitizeFileNameComponent(scholar.lastName),
      sanitizeFileNameComponent(scholar.firstName),
    ].filter(Boolean).join("_") || "Submission";

    const renamedFileName = await findAvailableFileName(accessToken, yearLevelFolderId, baseName, extension);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const mimeType = file.type || "application/octet-stream";
    const driveFileId = await uploadFile(accessToken, yearLevelFolderId, renamedFileName, mimeType, bytes);

    const { data: inserted, error: insertError } = await admin
      .from("submission_uploads")
      .insert({
        scholar_id: scholar.id,
        activity_id: activityId,
        field_id: fieldId,
        field_label_snapshot: field.label,
        original_file_name: file.name,
        renamed_file_name: renamedFileName,
        mime_type: mimeType,
        drive_file_id: driveFileId,
        status: "uploaded",
      })
      .select("id, original_file_name, renamed_file_name, mime_type, drive_file_id, status, created_at")
      .single();

    if (insertError || !inserted) {
      // The file DID make it to Drive even though the DB write failed —
      // flagged clearly (not swallowed) rather than silently losing track
      // of an orphaned Drive file. Telling the scholar to retry is safe:
      // findAvailableFileName's live Drive search means the retry gets
      // its own distinct name rather than colliding with the orphan, so
      // the worst case is one extra untracked Drive file, not data loss.
      console.error(`Uploaded to Drive (file id ${driveFileId}) but failed to record it in Supabase:`, insertError?.message);
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
          driveFileId: inserted.drive_file_id,
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
