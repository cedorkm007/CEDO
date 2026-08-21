// Part 3 of the Submission Activity feature — Google Drive integration
// FOUNDATION. Given an activityId, ensures (finds or creates)
//   <Parent Folder> / <Activity Name> / <Scholar Year Level> /
// in Google Drive and returns both folder ids. Does NOT upload any file —
// that's Part 4, once this foundation is in place and credentials/folder
// are confirmed working end-to-end.
//
// Callable only by an authenticated scholar (requireScholar below) — this
// is a scholar-initiated action (a scholar viewing/opening an activity's
// upload area triggers folder setup ahead of Part 4's actual upload).
import { corsHeaders } from "../_shared/cors.ts";
import { requireScholar } from "../_shared/verifyScholar.ts";
import { getGoogleAccessToken, findOrCreateFolder, sanitizeDriveFolderName } from "../_shared/googleDrive.ts";

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

    // 1. Cache hit — the common case once any scholar in this activity/
    // year-level pair has uploaded before. No Drive API calls at all.
    const { data: cached, error: cacheReadError } = await admin
      .from("submission_drive_folders")
      .select("activity_folder_id, year_level_folder_id")
      .eq("activity_id", activityId)
      .eq("year_level", yearLevel)
      .maybeSingle();
    if (cacheReadError) {
      return jsonResponse({ error: cacheReadError.message }, 500);
    }
    if (cached) {
      return jsonResponse(
        { ok: true, activityFolderId: cached.activity_folder_id, yearLevelFolderId: cached.year_level_folder_id, cached: true },
        200,
      );
    }

    const parentFolderId = Deno.env.get("GOOGLE_DRIVE_PARENT_FOLDER_ID");
    if (!parentFolderId) {
      return jsonResponse({ error: "Google Drive parent folder is not configured yet." }, 500);
    }

    const accessToken = await getGoogleAccessToken();

    // 2. Reuse the activity-level folder from any OTHER year-level's cache
    // row under the same activity, so a second year level uploading to the
    // same activity doesn't create a second "Activity Name" folder even
    // though this exact (activity, year_level) pair is a cache miss.
    const { data: siblingRow, error: siblingError } = await admin
      .from("submission_drive_folders")
      .select("activity_folder_id")
      .eq("activity_id", activityId)
      .limit(1)
      .maybeSingle();
    if (siblingError) {
      return jsonResponse({ error: siblingError.message }, 500);
    }

    const activityFolderName = sanitizeDriveFolderName(activity.name as string);
    const activityFolderId = siblingRow?.activity_folder_id
      ?? (await findOrCreateFolder(accessToken, activityFolderName, parentFolderId));

    const yearLevelFolderName = sanitizeDriveFolderName(yearLevel);
    const yearLevelFolderId = await findOrCreateFolder(accessToken, yearLevelFolderName, activityFolderId);

    const { error: insertError } = await admin.from("submission_drive_folders").insert({
      activity_id: activityId,
      year_level: yearLevel,
      activity_folder_id: activityFolderId,
      year_level_folder_id: yearLevelFolderId,
    });
    if (insertError) {
      // Most likely a concurrent call for the same (activity_id,
      // year_level) already inserted first (unique constraint) — read
      // back what won that race instead of failing a request whose Drive
      // folders were, in fact, created/found successfully.
      const { data: raceRow } = await admin
        .from("submission_drive_folders")
        .select("activity_folder_id, year_level_folder_id")
        .eq("activity_id", activityId)
        .eq("year_level", yearLevel)
        .maybeSingle();
      if (raceRow) {
        return jsonResponse(
          { ok: true, activityFolderId: raceRow.activity_folder_id, yearLevelFolderId: raceRow.year_level_folder_id, cached: true },
          200,
        );
      }
      return jsonResponse({ error: `Folder ready in Drive but failed to cache it: ${insertError.message}` }, 500);
    }

    return jsonResponse({ ok: true, activityFolderId, yearLevelFolderId, cached: false }, 200);
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    console.error("submission-ensure-drive-folder unexpected error:", thrown);
    return jsonResponse({ error: "Unexpected error." }, 500);
  }
});
