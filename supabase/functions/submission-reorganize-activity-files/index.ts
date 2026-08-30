// Milestone 2 of the "Drive folder reorganization + submission
// monitoring" task — Q1's answer was "retroactively move existing files"
// (not leave them under the old two-level structure). This Edge Function
// is the actual mover.
//
// Scoped to ONE activity per invocation, not a global "reorganize
// everything" operation — deliberately, for two reasons: (1) it keeps
// each run bounded well within an Edge Function's execution limits
// regardless of how many activities exist in total, matching this
// project's own established precedent of chunking large batch operations
// (see the Formation attendance bulk-QR work) rather than one big
// unbounded server-side loop; (2) it lets staff verify one activity's
// result before moving on to the next, rather than firing an
// irreversible mass-operation across everything at once with no
// checkpoint.
//
// For each of the activity's uploaded files (submission_uploads rows
// with a real drive_file_id):
//   1. Look up the uploading scholar's CURRENT year_level and school.
//   2. Call the same ensureSubmissionDriveFolders() helper Part 4's
//      upload function already uses — it finds-or-creates the School
//      subfolder, correctly reusing the legacy Year-Level folder (from
//      the pre-Milestone-1 cache row) as that new folder's parent. Its
//      returned yearLevelFolderId is therefore exactly the file's
//      CURRENT actual parent to remove, with no separate legacy-row
//      query needed here.
//   3. moveFile() the file from that Year-Level folder into the School
//      folder — a real Drive move (parent swap), not a re-upload.
//
// Safely re-runnable: moveFile()'s removeParents is a no-op if the old
// parent is no longer actually attached to the file (see its own doc
// comment) — so a file already moved by an earlier run of this same
// function is silently skipped rather than erroring, and a partially-
// completed run (e.g. it errored partway through a large activity) can
// just be re-invoked for the same activityId.
//
// Does NOT move a scholar's file if their year_level or school has
// changed SINCE they uploaded — this reorganizes by each file's
// uploader's CURRENT data, which is the only data available (this table
// never snapshotted year_level/school at upload time). Flagging this as
// a known, accepted limitation rather than a bug: it matches how the
// live (non-legacy) upload path already behaves (a scholar's file always
// lives under whatever their year_level/school are on record now), so
// this mover just brings legacy files in line with that same rule.

import { corsHeaders } from "../_shared/cors.ts";
import { requireFormsManagementStaff } from "../_shared/verifyFormsManagementStaff.ts";
import { getGoogleAccessToken, moveFile } from "../_shared/googleDrive.ts";
import { ensureSubmissionDriveFolders } from "../_shared/ensureSubmissionDriveFolders.ts";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

interface FileResult {
  uploadId: string;
  fileName: string;
  scholarName: string;
  ok: boolean;
  error?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { admin } = await requireFormsManagementStaff(req);

    const body = await req.json().catch(() => ({}));
    const activityId = String(body.activityId ?? "").trim();
    if (!activityId) return jsonResponse({ error: "activityId is required." }, 400);

    const { data: activity, error: activityError } = await admin
      .from("submission_activities").select("id, name").eq("id", activityId).maybeSingle();
    if (activityError || !activity) return jsonResponse({ error: "Activity not found." }, 404);

    const parentFolderId = Deno.env.get("GOOGLE_DRIVE_PARENT_FOLDER_ID");
    if (!parentFolderId) return jsonResponse({ error: "Google Drive is not configured." }, 500);

    // Two separate queries + a manual merge, not an embedded
    // scholars!inner(...) join — matches this codebase's own established
    // convention for this kind of lookup (see e.g. fetchAttendanceRoster
    // in sdpMonitorApi.ts), which has no precedent anywhere for
    // PostgREST's embedded-resource join syntax. Every uploaded file for
    // this activity that actually has a Drive file.
    const { data: uploads, error: uploadsError } = await admin
      .from("submission_uploads")
      .select("id, drive_file_id, original_file_name, scholar_id")
      .eq("activity_id", activityId)
      .neq("drive_file_id", "");
    if (uploadsError) return jsonResponse({ error: uploadsError.message }, 500);
    if (!uploads || uploads.length === 0) {
      return jsonResponse({ ok: true, activityName: activity.name, totalFiles: 0, movedCount: 0, results: [] }, 200);
    }

    // Each uploader's CURRENT year_level/school (see the file header
    // comment on why "current," not "at upload time").
    const scholarIds = [...new Set(uploads.map(u => u.scholar_id))];
    const { data: scholarRows, error: scholarsError } = await admin
      .from("scholars")
      .select("id, first_name, last_name, year_level, school")
      .in("id", scholarIds);
    if (scholarsError) return jsonResponse({ error: scholarsError.message }, 500);
    const scholarById = new Map((scholarRows ?? []).map(s => [s.id, s]));

    // Fetched once up front, lazily reused via the thunk
    // ensureSubmissionDriveFolders already expects — every file in this
    // activity needs it regardless of cache hit/miss, since moveFile()
    // itself always needs a token even when the folder lookup is a cache
    // hit (unlike Part 4's upload path, where a cache hit could
    // technically skip fetching one — not the case here).
    const accessToken = await getGoogleAccessToken();

    const results: FileResult[] = [];
    let movedCount = 0;

    for (const upload of uploads) {
      const scholar = scholarById.get(upload.scholar_id);
      const scholarName = scholar ? `${scholar.first_name} ${scholar.last_name}`.trim() : "(unknown scholar)";
      if (!scholar) {
        results.push({ uploadId: upload.id, fileName: upload.original_file_name, scholarName, ok: false, error: "Scholar record not found." });
        continue;
      }
      try {
        const yearLevel = (scholar.year_level ?? "").trim();
        const school = (scholar.school ?? "").trim();
        const folders = await ensureSubmissionDriveFolders(
          admin, parentFolderId, activityId, activity.name, yearLevel, school,
          () => Promise.resolve(accessToken),
        );
        await moveFile(accessToken, upload.drive_file_id, folders.yearLevelFolderId, folders.schoolFolderId);
        results.push({ uploadId: upload.id, fileName: upload.original_file_name, scholarName, ok: true });
        movedCount++;
      } catch (fileError) {
        const message = fileError instanceof Response
          ? (await fileError.json().catch(() => ({ error: "Unknown error" }))).error ?? "Unknown error"
          : fileError instanceof Error ? fileError.message : "Unknown error";
        console.error(`Failed to move upload ${upload.id} (${scholarName}):`, message);
        results.push({ uploadId: upload.id, fileName: upload.original_file_name, scholarName, ok: false, error: message });
      }
    }

    return jsonResponse({
      ok: true, activityName: activity.name, totalFiles: uploads.length, movedCount, results,
    }, 200);
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    console.error("submission-reorganize-activity-files unexpected error:", thrown);
    return jsonResponse({ error: "Unexpected error while reorganizing files." }, 500);
  }
});
