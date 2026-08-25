// Part 4. Shared "find or create the Parent Folder / Activity Name /
// Scholar Year Level / structure, using the submission_drive_folders
// cache table" logic — originally written inline in Part 3's
// submission-ensure-drive-folder/index.ts. Extracted here so Part 4's
// submission-upload-file can reuse the exact same idempotent
// find-or-create + cache + race-handling behavior instead of a second,
// possibly-drifting copy. submission-ensure-drive-folder has been
// refactored to call this too — its request/response contract is
// unchanged from Part 3.
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { findOrCreateFolder, sanitizeDriveFolderName } from "./googleDrive.ts";
import { throwJsonError } from "./cors.ts";

export interface DriveFolders {
  activityFolderId: string;
  yearLevelFolderId: string;
  cached: boolean;
}

/**
 * `getAccessToken` is a thunk, not a value, so a cache hit never pays for
 * a Google OAuth round trip — it's invoked only on an actual cache miss,
 * the same laziness Part 3 originally had inline. A caller that already
 * needs a token for something else afterward (Part 4's file upload,
 * which needs one regardless of cache hit/miss for the upload call
 * itself) can just pass `() => Promise.resolve(existingToken)` to avoid
 * fetching twice.
 */
export async function ensureSubmissionDriveFolders(
  admin: SupabaseClient,
  parentFolderId: string,
  activityId: string,
  activityName: string,
  yearLevel: string,
  getAccessToken: () => Promise<string>,
): Promise<DriveFolders> {
  const { data: cached, error: cacheReadError } = await admin
    .from("submission_drive_folders")
    .select("activity_folder_id, year_level_folder_id")
    .eq("activity_id", activityId)
    .eq("year_level", yearLevel)
    .maybeSingle();
  if (cacheReadError) {
    throwJsonError(cacheReadError.message, 500);
  }
  if (cached) {
    return { activityFolderId: cached.activity_folder_id, yearLevelFolderId: cached.year_level_folder_id, cached: true };
  }

  const accessToken = await getAccessToken();

  // Reuse the activity-level folder from any OTHER year-level's cache row
  // under the same activity, so a second year level uploading to the same
  // activity doesn't create a second "Activity Name" folder even though
  // this exact (activity, year_level) pair is a cache miss.
  const { data: siblingRow, error: siblingError } = await admin
    .from("submission_drive_folders")
    .select("activity_folder_id")
    .eq("activity_id", activityId)
    .limit(1)
    .maybeSingle();
  if (siblingError) {
    throwJsonError(siblingError.message, 500);
  }

  const activityFolderName = sanitizeDriveFolderName(activityName);
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
    // year_level) already inserted first (unique constraint) — read back
    // what won that race instead of failing a request whose Drive folders
    // were, in fact, created/found successfully.
    const { data: raceRow } = await admin
      .from("submission_drive_folders")
      .select("activity_folder_id, year_level_folder_id")
      .eq("activity_id", activityId)
      .eq("year_level", yearLevel)
      .maybeSingle();
    if (raceRow) {
      return { activityFolderId: raceRow.activity_folder_id, yearLevelFolderId: raceRow.year_level_folder_id, cached: true };
    }
    throwJsonError(`Folder ready in Drive but failed to cache it: ${insertError.message}`, 500);
  }

  return { activityFolderId, yearLevelFolderId, cached: false };
}
