// Part 3 of the Submission Activity feature — Google Drive integration
// FOUNDATION. Given an activityId, ensures (finds or creates)
//   <Parent Folder> / <Activity Name> / <Scholar Year Level> /
// in Google Drive and returns both folder ids.
//
// Refactored in Part 4: the actual find-or-create + cache + race-handling
// logic now lives in ../_shared/ensureSubmissionDriveFolders.ts, shared
// with Part 4's submission-upload-file (which needs the exact same
// folder structure right before it uploads into it). This function's own
// request/response contract is unchanged from Part 3 — it still only
// ensures folders exist and never touches a file.
//
// Callable only by an authenticated scholar (requireScholar below) — this
// is a scholar-initiated action (a scholar viewing/opening an activity's
// upload area triggers folder setup ahead of an upload).
import { corsHeaders } from "../_shared/cors.ts";
import { requireScholar } from "../_shared/verifyScholar.ts";
import { getGoogleAccessToken } from "../_shared/googleDrive.ts";
import { ensureSubmissionDriveFolders } from "../_shared/ensureSubmissionDriveFolders.ts";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { admin, scholar } = await requireScholar(req);

    const body = await req.json();
    const activityId = String(body.activityId ?? "").trim();
    if (!activityId) return jsonResponse({ error: "activityId is required." }, 400);

    // Re-derive applicability server-side rather than trusting the client
    // — mirrors the same all_year_levels/target_year_levels check the
    // scholar-facing RLS policy on submission_activities already enforces
    // for reads (supabase_migration_submission_activities.sql), since this
    // admin client bypasses RLS and has to redo that check itself.
    const { data: activity, error: activityError } = await admin
      .from("submission_activities")
      .select("id, name, all_year_levels, target_year_levels")
      .eq("id", activityId)
      .maybeSingle();
    if (activityError || !activity) {
      return jsonResponse({ error: "Activity not found." }, 404);
    }

    const yearLevel = scholar.yearLevel.trim();
    if (!yearLevel) {
      return jsonResponse({ error: "Your account has no year level set — contact SEAD staff." }, 400);
    }

    const targetYearLevels = (activity.target_year_levels as string[] | null) ?? [];
    const isApplicable = Boolean(activity.all_year_levels) || targetYearLevels.includes(yearLevel);
    if (!isApplicable) {
      return jsonResponse({ error: "This activity does not apply to your year level." }, 403);
    }

    const parentFolderId = Deno.env.get("GOOGLE_DRIVE_PARENT_FOLDER_ID");
    if (!parentFolderId) {
      return jsonResponse({ error: "Google Drive parent folder is not configured yet." }, 500);
    }

    const folders = await ensureSubmissionDriveFolders(
      admin, parentFolderId, activityId, activity.name as string, yearLevel, getGoogleAccessToken,
    );

    return jsonResponse(
      { ok: true, activityFolderId: folders.activityFolderId, yearLevelFolderId: folders.yearLevelFolderId, cached: folders.cached },
      200,
    );
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    console.error("submission-ensure-drive-folder unexpected error:", thrown);
    return jsonResponse({ error: "Unexpected error." }, 500);
  }
});
