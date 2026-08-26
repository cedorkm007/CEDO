// Shared "find or create the Parent Folder / Activity Name / Scholar
// Year Level / School / structure, using the submission_drive_folders
// cache table" logic — originally written inline in Part 3's now-removed
// submission-ensure-drive-folder Edge Function, then extracted here so
// Part 4's submission-upload-file could reuse the exact same idempotent
// find-or-create + cache + race-handling behavior instead of a second,
// possibly-drifting copy.
//
// submission-ensure-drive-folder itself was REMOVED in Milestone 2 of
// the OAuth2 migration task: nothing in the frontend ever called it
// (grepped and confirmed twice, across two separate sessions) — folder
// creation has always actually happened lazily, inside
// submission-upload-file's own call to this file, on first upload. This
// file's own logic and this function's contract are unchanged by that
// removal; it's called from exactly one place now instead of two.
//
// Milestone 1 of the "Drive folder reorganization + submission
// monitoring" task added the School level (this file previously stopped
// at Year Level) — see supabase_migration_submission_drive_folders_school.sql
// for the schema change and why `school` is nullable there specifically
// so old two-level cache rows can never collide with new three-level
// ones.
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { findOrCreateFolder, sanitizeDriveFolderName } from "./googleDrive.ts";
import { throwJsonError } from "./cors.ts";

/** Folder name used for a scholar with no school set (school === "") — an explicit, human-readable stand-in rather than creating a Drive folder with an empty name. */
const NO_SCHOOL_FOLDER_NAME = "No School Set";

export interface DriveFolders {
  activityFolderId: string;
  yearLevelFolderId: string;
  schoolFolderId: string;
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
 *
 * `school` should be the scholar's own scholars.school value, trimmed by
 * the caller (matching how `yearLevel` is already trimmed by its own
 * caller before reaching here) — pass "" for a scholar with no school
 * set, never a placeholder string; NO_SCHOOL_FOLDER_NAME is applied here,
 * once, only for the actual Drive folder's display name, so the cache
 * key itself (`school` as stored/queried) always reflects the scholar's
 * real, unmodified data.
 */
export async function ensureSubmissionDriveFolders(
  admin: SupabaseClient,
  parentFolderId: string,
  activityId: string,
  activityName: string,
  yearLevel: string,
  school: string,
  getAccessToken: () => Promise<string>,
): Promise<DriveFolders> {
  const { data: cached, error: cacheReadError } = await admin
    .from("submission_drive_folders")
    .select("activity_folder_id, year_level_folder_id, school_folder_id")
    .eq("activity_id", activityId)
    .eq("year_level", yearLevel)
    .eq("school", school)
    .maybeSingle();
  if (cacheReadError) {
    throwJsonError(cacheReadError.message, 500);
  }
  // A row can exist without a school_folder_id in exactly one case today
  // (a legacy pre-Milestone-1 row) — but those always have school IS
  // NULL, which .eq("school", school) can never match for any `school`
  // value, blank or not. This check is kept anyway as a cheap defensive
  // guard: a "cached but incomplete" row should never be treated as a
  // full cache hit, whatever produced it.
  if (cached && cached.school_folder_id) {
    return {
      activityFolderId: cached.activity_folder_id,
      yearLevelFolderId: cached.year_level_folder_id,
      schoolFolderId: cached.school_folder_id,
      cached: true,
    };
  }

  const accessToken = await getAccessToken();

  // Reuse the activity-level folder from ANY other cache row under the
  // same activity — any year level, any school, including legacy
  // pre-Milestone-1 rows (activity_folder_id has always been not-null,
  // so a legacy row is just as valid a source for this one as a new
  // row) — so a second year level/school uploading to the same activity
  // never creates a second "Activity Name" folder.
  const { data: activitySibling, error: activitySiblingError } = await admin
    .from("submission_drive_folders")
    .select("activity_folder_id")
    .eq("activity_id", activityId)
    .limit(1)
    .maybeSingle();
  if (activitySiblingError) {
    throwJsonError(activitySiblingError.message, 500);
  }

  const activityFolderName = sanitizeDriveFolderName(activityName);
  const activityFolderId = activitySibling?.activity_folder_id
    ?? (await findOrCreateFolder(accessToken, activityFolderName, parentFolderId));

  // Reuse the year-level folder from any OTHER school's cache row under
  // this same (activity, year level) pair — including a legacy row, for
  // the same reason as above (year_level_folder_id has always been
  // not-null too) — every school within one year level shares one Year
  // Level folder; only the School folder beneath it is new per school.
  const { data: yearLevelSibling, error: yearLevelSiblingError } = await admin
    .from("submission_drive_folders")
    .select("year_level_folder_id")
    .eq("activity_id", activityId)
    .eq("year_level", yearLevel)
    .limit(1)
    .maybeSingle();
  if (yearLevelSiblingError) {
    throwJsonError(yearLevelSiblingError.message, 500);
  }

  const yearLevelFolderName = sanitizeDriveFolderName(yearLevel);
  const yearLevelFolderId = yearLevelSibling?.year_level_folder_id
    ?? (await findOrCreateFolder(accessToken, yearLevelFolderName, activityFolderId));

  const schoolFolderName = sanitizeDriveFolderName(school || NO_SCHOOL_FOLDER_NAME);
  const schoolFolderId = await findOrCreateFolder(accessToken, schoolFolderName, yearLevelFolderId);

  const { error: insertError } = await admin.from("submission_drive_folders").insert({
    activity_id: activityId,
    year_level: yearLevel,
    school,
    activity_folder_id: activityFolderId,
    year_level_folder_id: yearLevelFolderId,
    school_folder_id: schoolFolderId,
  });
  if (insertError) {
    // Most likely a concurrent call for the same (activity_id,
    // year_level, school) already inserted first (unique constraint) —
    // read back what won that race instead of failing a request whose
    // Drive folders were, in fact, created/found successfully.
    const { data: raceRow } = await admin
      .from("submission_drive_folders")
      .select("activity_folder_id, year_level_folder_id, school_folder_id")
      .eq("activity_id", activityId)
      .eq("year_level", yearLevel)
      .eq("school", school)
      .maybeSingle();
    if (raceRow && raceRow.school_folder_id) {
      return {
        activityFolderId: raceRow.activity_folder_id,
        yearLevelFolderId: raceRow.year_level_folder_id,
        schoolFolderId: raceRow.school_folder_id,
        cached: true,
      };
    }
    throwJsonError(`Folder ready in Drive but failed to cache it: ${insertError.message}`, 500);
  }

  return { activityFolderId, yearLevelFolderId, schoolFolderId, cached: false };
}
