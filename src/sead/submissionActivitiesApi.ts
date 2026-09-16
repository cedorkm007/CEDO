import { supabase } from "@/lib/supabase";

// ── Types ─────────────────────────────────────────────────────

/**
 * The only file types Submission Activities will eventually accept
 * (upload validation itself is Part 2 — this constant exists now so both
 * this file's future callers and Part 2 read from one shared definition
 * instead of two copies drifting apart). Extensions are for display;
 * accept/validate should check MIME type where possible and fall back to
 * extension only when a browser reports a blank/generic MIME type.
 */
export const SUBMISSION_ALLOWED_FILE_TYPES = [
  { label: "PDF", extensions: [".pdf"], mimeTypes: ["application/pdf"] },
  { label: "Word", extensions: [".doc", ".docx"], mimeTypes: ["application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"] },
  { label: "JPEG", extensions: [".jpg", ".jpeg"], mimeTypes: ["image/jpeg"] },
  { label: "PNG", extensions: [".png"], mimeTypes: ["image/png"] },
  { label: "Excel/CSV", extensions: [".xls", ".xlsx", ".csv"], mimeTypes: ["application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/csv"] },
] as const;

/** The exact set of category labels a field will accept — a subset of SUBMISSION_ALLOWED_FILE_TYPES's labels. */
export type SubmissionFileCategory = typeof SUBMISSION_ALLOWED_FILE_TYPES[number]["label"];

export interface SubmissionUploadField {
  id: string;
  label: string;
  isRequired: boolean;
  maxFiles: number;
  sortOrder: number;
  allowedCategories: SubmissionFileCategory[];
}

export interface SubmissionActivity {
  id: string;
  name: string;
  description: string;
  allYearLevels: boolean;
  targetYearLevels: string[];
  uploadFields: SubmissionUploadField[];
  pubmatPath: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Rules are ANDed: scholars must meet every saved condition to unlock an activity. */
export type SubmissionActivityCondition =
  | { type: "quest_subject"; subjectId: string; subjectName?: string }
  | { type: "formation_activity"; formationActivityId: string; formationActivityName?: string }
  | { type: "sdp_activity"; sdpActivityId: string; sdpActivityName?: string }
  | { type: "course"; course: string }
  | { type: "year_level"; allYearLevels: boolean; yearLevels: string[] };

const ALL_SUBMISSION_CATEGORIES = SUBMISSION_ALLOWED_FILE_TYPES.map(t => t.label);

function rowToUploadField(row: Record<string, unknown>): SubmissionUploadField {
  const categories = Array.isArray(row.allowed_categories) ? (row.allowed_categories as unknown[]).map(String) : [];
  return {
    id: String(row.id),
    label: String(row.label ?? ""),
    isRequired: Boolean(row.is_required),
    maxFiles: Number(row.max_files ?? 1),
    sortOrder: Number(row.sort_order ?? 0),
    // Falls back to "all categories" rather than an empty list — an
    // empty/missing value here should never silently mean "nothing is
    // accepted." The migration backfills this for existing rows anyway;
    // this is a second, independent safety net at the read layer.
    allowedCategories: (categories.length > 0 ? categories : ALL_SUBMISSION_CATEGORIES) as SubmissionFileCategory[],
  };
}

function rowToActivity(row: Record<string, unknown>): SubmissionActivity {
  const fieldRows = (row.submission_upload_fields as Record<string, unknown>[] | null) ?? [];
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    description: String(row.description ?? ""),
    allYearLevels: Boolean(row.all_year_levels),
    targetYearLevels: Array.isArray(row.target_year_levels) ? (row.target_year_levels as unknown[]).map(String) : [],
    uploadFields: fieldRows.map(rowToUploadField).sort((a, b) => a.sortOrder - b.sortOrder),
    pubmatPath: (row.pubmat_path as string | null) ?? null,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

function rowToCondition(row: Record<string, unknown>): SubmissionActivityCondition {
  switch (row.condition_type as string) {
    case "quest_subject": return { type: "quest_subject", subjectId: String(row.subject_id), subjectName: (row.quest_subjects as { name?: string } | null)?.name };
    case "formation_activity": return { type: "formation_activity", formationActivityId: String(row.formation_activity_id), formationActivityName: (row.formation_activities as { name?: string } | null)?.name };
    case "sdp_activity": return { type: "sdp_activity", sdpActivityId: String(row.sdp_activity_id), sdpActivityName: (row.sdp_activities as { name?: string } | null)?.name };
    case "course": return { type: "course", course: String(row.course ?? "") };
    default: return { type: "year_level", allYearLevels: Boolean(row.all_year_levels), yearLevels: (row.target_year_levels as string[] | null) ?? [] };
  }
}

// ── Read ──────────────────────────────────────────────────────

export async function fetchSubmissionActivities(): Promise<SubmissionActivity[]> {
  const { data, error } = await supabase
    .from("submission_activities")
    .select("id, name, description, all_year_levels, target_year_levels, created_at, updated_at, submission_upload_fields (id, label, is_required, max_files, sort_order, allowed_categories)")
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(rowToActivity);
}

// ── Write ─────────────────────────────────────────────────────

export interface SubmissionActivityInput {
  name: string;
  description: string;
  allYearLevels: boolean;
  targetYearLevels: string[];
  /**
   * Full desired field list, in display order. An existing field keeps
   * its `id` so submission_uploads.field_id (Part 2 onward) survives
   * edits/reorders instead of being silently orphaned — see
   * setSubmissionUploadFields below. A field with no `id` is a new one
   * being added. Any existing field whose id isn't present here gets
   * deleted (its past submission_uploads rows survive via ON DELETE SET
   * NULL + their own field_label_snapshot, per
   * supabase_migration_submission_uploads.sql).
   */
  uploadFields: { id?: string; label: string; isRequired: boolean; maxFiles: number; allowedCategories: SubmissionFileCategory[] }[];
}

async function setSubmissionUploadFields(activityId: string, fields: SubmissionActivityInput["uploadFields"]): Promise<{ ok: boolean; error?: string }> {
  // Upsert-and-prune, NOT delete-all-then-insert-all: submission_uploads
  // rows (Part 2 onward) reference a field by id, so blowing away and
  // recreating every field on every save — Part 1's original approach —
  // would silently orphan/misattribute every scholar's existing uploads
  // the next time staff so much as reorders a field. An existing field
  // (identified by a present `id` that's still in `fields`) is updated in
  // place; a field with no `id` is a new insert; any existing field id no
  // longer present in `fields` is deleted.
  const { data: existingRows, error: fetchError } = await supabase
    .from("submission_upload_fields").select("id").eq("activity_id", activityId);
  if (fetchError) return { ok: false, error: fetchError.message };
  const existingIds = new Set((existingRows ?? []).map(r => r.id as string));
  const keepIds = new Set(fields.map(f => f.id).filter((id): id is string => !!id));

  const idsToDelete = [...existingIds].filter(id => !keepIds.has(id));
  if (idsToDelete.length > 0) {
    const { error: deleteError } = await supabase.from("submission_upload_fields").delete().in("id", idsToDelete);
    if (deleteError) return { ok: false, error: deleteError.message };
  }

  for (let index = 0; index < fields.length; index++) {
    const f = fields[index];
    // Never persist an empty category list — that would silently reject
    // every file for this field, which is exactly the "existing activity
    // becomes broken or impossible to submit" outcome the categories
    // feature is required to avoid. Falls back to "all categories" if a
    // caller somehow sends an empty array (the staff UI itself blocks
    // saving with zero categories selected, but this is a second,
    // independent safety net at the API layer).
    const allowedCategories = f.allowedCategories.length > 0 ? f.allowedCategories : ALL_SUBMISSION_CATEGORIES;
    if (f.id && existingIds.has(f.id)) {
      const { error: updateError } = await supabase.from("submission_upload_fields")
        .update({ label: f.label, is_required: f.isRequired, max_files: f.maxFiles, sort_order: index, allowed_categories: allowedCategories })
        .eq("id", f.id);
      if (updateError) return { ok: false, error: updateError.message };
    } else {
      const { error: insertError } = await supabase.from("submission_upload_fields")
        .insert({ activity_id: activityId, label: f.label, is_required: f.isRequired, max_files: f.maxFiles, sort_order: index, allowed_categories: allowedCategories });
      if (insertError) return { ok: false, error: insertError.message };
    }
  }
  return { ok: true };
}

export async function createSubmissionActivity(input: SubmissionActivityInput): Promise<{ ok: boolean; error?: string; id?: string }> {
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("submission_activities")
    .insert({
      name: input.name, description: input.description,
      all_year_levels: input.allYearLevels, target_year_levels: input.allYearLevels ? [] : input.targetYearLevels,
      created_by: auth.user?.id ?? null,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message || "Failed to create activity." };
  const fieldsResult = await setSubmissionUploadFields(data.id, input.uploadFields);
  if (!fieldsResult.ok) return { ok: false, error: `Activity created, but its upload fields failed to save: ${fieldsResult.error}` };
  return { ok: true, id: data.id };
}

export async function updateSubmissionActivity(id: string, input: SubmissionActivityInput): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from("submission_activities")
    .update({
      name: input.name, description: input.description,
      all_year_levels: input.allYearLevels, target_year_levels: input.allYearLevels ? [] : input.targetYearLevels,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  return setSubmissionUploadFields(id, input.uploadFields);
}

export async function deleteSubmissionActivity(id: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("submission_activities").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function fetchSubmissionActivityConditions(activityId: string): Promise<SubmissionActivityCondition[]> {
  const { data, error } = await supabase.from("submission_activity_conditions")
    .select("condition_type, subject_id, formation_activity_id, sdp_activity_id, course, target_year_levels, all_year_levels, quest_subjects ( name ), formation_activities ( name ), sdp_activities ( name )")
    .eq("activity_id", activityId).order("created_at");
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(rowToCondition);
}

/** Replaces all unlock rules in one save. An empty list means no extra unlock requirement. */
export async function setSubmissionActivityConditions(activityId: string, conditions: SubmissionActivityCondition[]): Promise<{ ok: boolean; error?: string }> {
  const { error: removeError } = await supabase.from("submission_activity_conditions").delete().eq("activity_id", activityId);
  if (removeError) return { ok: false, error: removeError.message };
  if (!conditions.length) return { ok: true };
  const rows = conditions.map(condition => {
    const base = { activity_id: activityId, target_year_levels: [] as string[], all_year_levels: false };
    switch (condition.type) {
      case "quest_subject": return { ...base, condition_type: "quest_subject", subject_id: condition.subjectId };
      case "formation_activity": return { ...base, condition_type: "formation_activity", formation_activity_id: condition.formationActivityId };
      case "sdp_activity": return { ...base, condition_type: "sdp_activity", sdp_activity_id: condition.sdpActivityId };
      case "course": return { ...base, condition_type: "course", course: condition.course };
      case "year_level": return { ...base, condition_type: "year_level", all_year_levels: condition.allYearLevels, target_year_levels: condition.yearLevels };
    }
  });
  const { error } = await supabase.from("submission_activity_conditions").insert(rows);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * A scholar's own device/app often names an upload something meaningless to
 * staff for scanning purposes — "inbound7115836571898347721.pdf" (shared via
 * Messenger), "file.pdf_20260914_234254_0000.pdf" (a scanner app), or even a
 * literal "%20"-encoded name. Every staff-facing file list shows this
 * generated label instead; the scholar's own original_file_name is kept only
 * for the actual downloaded file (SubmissionFilePreviewModal's `download`
 * attribute), never discarded from the database.
 */
export function formatSubmissionDisplayName(scholarName: string, fieldLabel: string, originalFileName: string): string {
  const dotIndex = originalFileName.lastIndexOf(".");
  const extension = dotIndex >= 0 ? originalFileName.slice(dotIndex).toLowerCase() : "";
  const scholar = scholarName.trim() || "Unknown Scholar";
  const field = fieldLabel.trim();
  return field ? `${scholar} — ${field}${extension}` : `${scholar}${extension}`;
}

// ── Part 5: staff review ─────────────────────────────────────

/**
 * One uploaded file, for the staff review panel — one activity's
 * submission_uploads joined with the uploading scholar's identity/year
 * level (submission_uploads.scholar_id -> scholars.id, the same FK every
 * scholar-facing RLS policy in this feature already relies on). Direct
 * table read, not an Edge Function: "staff read" RLS on submission_uploads
 * (supabase_migration_submission_uploads.sql) already lets any SEAD staff
 * account read every row, matching fetchSubmissionActivities above.
 */
export interface SubmissionForReview {
  id: string;
  scholarId: string;
  scholarIdNumber: string;
  scholarName: string;
  yearLevel: string;
  fieldId: string;
  fieldLabel: string;
  originalFileName: string;
  displayFileName: string;
  mimeType: string;
  /** Path in the private "submission-uploads" Storage bucket — "" for a row not yet backfilled off Drive (see submissionCompression.ts / the Storage migration). */
  storagePath: string;
  /** https://drive.google.com/file/d/{id}/view — fallback for a row not yet backfilled (storagePath is ""); "" once migrated. */
  driveViewUrl: string;
  /** True once staff deletes the attached file (submission-delete-file) — storagePath/driveViewUrl are both "" at that point too, but this makes the reason explicit rather than leaving the UI to infer it. */
  fileRemoved: boolean;
  status: string;
  staffComment: string;
  createdAt: string;
}

export async function fetchSubmissionsForActivity(activityId: string): Promise<SubmissionForReview[]> {
  // PostgREST caps an unpaginated response at 1,000 rows — an activity like
  // "Signed Contract Upload" already has ~1,487 uploads, so a plain select
  // here was silently dropping its oldest ~487 rows (whichever scholars
  // happened to sort past the cutoff) from both this review panel and the
  // Submission Files browser tab below. Pages through with .range() until a
  // page comes back short, same fix as fetchSubmissionRosterStatus's own
  // earlier run-in with this exact cap.
  const pageSize = 1000;
  const allRows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("submission_uploads")
      .select(
        "id, scholar_id, field_id, field_label_snapshot, original_file_name, mime_type, drive_file_id, storage_path, file_removed_at, status, staff_comment, created_at, " +
        "scholars (scholar_id_number, first_name, last_name, year_level)"
      )
      .eq("activity_id", activityId)
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error || !data) return allRows.length ? mapSubmissionForReview(allRows) : [];
    allRows.push(...(data as unknown as Record<string, unknown>[]));
    if (data.length < pageSize) break;
  }
  return mapSubmissionForReview(allRows);
}

function mapSubmissionForReview(rows: Record<string, unknown>[]): SubmissionForReview[] {
  return rows.map(row => {
    const scholar = (row.scholars as Record<string, unknown> | null) ?? {};
    const driveFileId = String(row.drive_file_id ?? "");
    const storagePath = String(row.storage_path ?? "");
    const scholarName = `${scholar.first_name ?? ""} ${scholar.last_name ?? ""}`.trim();
    const fieldLabel = String(row.field_label_snapshot ?? "");
    const originalFileName = String(row.original_file_name ?? "");
    return {
      id: String(row.id),
      scholarId: String(row.scholar_id ?? ""),
      scholarIdNumber: String(scholar.scholar_id_number ?? ""),
      scholarName,
      yearLevel: String(scholar.year_level ?? ""),
      fieldId: String(row.field_id ?? ""),
      fieldLabel,
      originalFileName,
      displayFileName: formatSubmissionDisplayName(scholarName, fieldLabel, originalFileName),
      mimeType: String(row.mime_type ?? ""),
      storagePath,
      driveViewUrl: !storagePath && driveFileId ? `https://drive.google.com/file/d/${driveFileId}/view` : "",
      fileRemoved: Boolean(row.file_removed_at),
      status: String(row.status ?? "uploaded"),
      staffComment: String(row.staff_comment ?? ""),
      createdAt: String(row.created_at ?? ""),
    };
  });
}

/**
 * Applies one review outcome to every row in uploadIds at once — the
 * review panel's unit of review is "this scholar's whole submission for
 * this activity" (per spec: "mark a scholar submission as ... accepted
 * / needs resubmission"), not one uploaded file at a time. Still backed
 * by the same per-file status/staff_comment columns Part 4 introduced
 * (see supabase_migration_submission_review.sql's header comment) rather
 * than a separate per-scholar review table — this function is simply
 * called with every upload id belonging to one scholar's one activity.
 * reviewed_by is taken from the caller's own session, never passed in.
 */
export async function reviewSubmissionUploads(
  uploadIds: string[], status: "accepted" | "needs_resubmission", staffComment: string,
): Promise<{ ok: boolean; error?: string }> {
  if (uploadIds.length === 0) return { ok: true };
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("submission_uploads")
    .update({
      status, staff_comment: staffComment,
      reviewed_by: auth.user?.id ?? null, reviewed_at: new Date().toISOString(),
    })
    .in("id", uploadIds);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Deletes the attached file for one upload row (clears storage_path/
 * drive_file_id, stamps file_removed_at, removes the object from the
 * "submission-uploads" bucket) — the row itself and its review history
 * (status/staff_comment/reviewed_by/reviewed_at) are left untouched.
 * Routed through an Edge Function (service role) since staff have no
 * client-side delete permission on this Storage bucket — see
 * submission-delete-file/index.ts.
 */
export async function deleteSubmissionUploadFile(uploadId: string): Promise<{ ok: boolean; error?: string }> {
  return invokeEdgeFunction("submission-delete-file", { uploadId });
}

// ── Drive folder reorganization (Milestone 2) ────────────────
// Same shape/error-unwrapping convention as seadApi.ts's invokeEdgeFunction
// and submissionsApi.ts's own local copy — this file didn't need one
// until now (every function above is plain table CRUD), so it gets its
// own copy too rather than importing a non-exported helper from another
// file.
async function invokeEdgeFunction<T = Record<string, unknown>>(
  name: string, body: object
): Promise<{ ok: boolean; error?: string; data?: T }> {
  const { data, error } = await supabase.functions.invoke(name, { body: body as Record<string, unknown> });
  if (error) {
    let message = error.message;
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === "function") {
      try {
        const parsed = await context.clone().json();
        if (parsed?.error) message = parsed.error;
      } catch {
        // Response body wasn't JSON (or was already consumed) — fall back to the generic message.
      }
    }
    return { ok: false, error: message };
  }
  const payload = data as (T & { error?: string }) | null;
  if (payload?.error) return { ok: false, error: payload.error };
  return { ok: true, data: data as T };
}

export interface BackfillFailure {
  uploadId: string;
  fileName: string;
  error: string;
}

interface BackfillBatchResult {
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  done: boolean;
  failures: BackfillFailure[];
}

/**
 * One-time migration off Google Drive: loops calling
 * submission-backfill-drive-files until it reports done, since each call
 * only processes a small batch (compression + Drive download + Storage
 * upload per row is too slow to do unbounded in one request). Safe to
 * re-run/interrupt at any point — every call re-queries for rows still
 * missing storage_path, so nothing is double-counted or skipped.
 */
export async function backfillDriveFilesToStorage(
  onProgress?: (done: number, total: number) => void,
): Promise<{ ok: boolean; error?: string; succeeded?: number; failed?: number; failures?: BackfillFailure[] }> {
  let succeeded = 0;
  let failed = 0;
  const failures: BackfillFailure[] = [];
  for (;;) {
    const result = await invokeEdgeFunction<BackfillBatchResult>("submission-backfill-drive-files", {});
    if (!result.ok || !result.data) return { ok: false, error: result.error || "Failed to migrate files.", succeeded, failed, failures };
    succeeded += result.data.succeeded;
    failed += result.data.failed;
    failures.push(...result.data.failures);
    onProgress?.(succeeded + failed, result.data.total);
    if (result.data.done || result.data.processed === 0) break;
  }
  return { ok: true, succeeded, failed, failures };
}

// ── Submission file browser (Activity -> Year Level -> School) ────────

export interface SubmissionUploadActivityCount { activityId: string; activityName: string; uploadCount: number }
export interface SubmissionUploadGroupCount { label: string; count: number }

export async function fetchSubmissionUploadCountsByActivity(): Promise<SubmissionUploadActivityCount[]> {
  const { data, error } = await supabase.rpc("submission_uploads_by_activity");
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(r => ({
    activityId: String(r.activity_id), activityName: String(r.activity_name), uploadCount: Number(r.upload_count),
  }));
}

export async function fetchSubmissionUploadCountsByYearLevel(activityId: string): Promise<SubmissionUploadGroupCount[]> {
  const { data, error } = await supabase.rpc("submission_uploads_by_year_level", { p_activity_id: activityId });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(r => ({ label: String(r.year_level), count: Number(r.upload_count) }));
}

export async function fetchSubmissionUploadCountsBySchool(activityId: string, yearLevel: string): Promise<SubmissionUploadGroupCount[]> {
  const { data, error } = await supabase.rpc("submission_uploads_by_school", { p_activity_id: activityId, p_year_level: yearLevel });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(r => ({ label: String(r.school), count: Number(r.upload_count) }));
}

export interface SubmissionFileRow {
  id: string;
  originalFileName: string;
  displayFileName: string;
  mimeType: string;
  storagePath: string;
  driveViewUrl: string;
  status: string;
  scholarName: string;
  createdAt: string;
}

/**
 * Leaf level of the file browser — a plain filtered read, not an RPC, same
 * as the Scholarship Program Information drill-down's own leaf level.
 * Fetches the whole activity's uploads and filters year level/school
 * client-side (rather than a fragile OR-across-embedded-table PostgREST
 * filter) so the "No Year Level Set"/"No School Set" sentinels from the
 * count RPCs — meaning null OR blank — are trivial to match exactly the
 * same way those RPCs themselves do.
 */
export async function fetchSubmissionFiles(activityId: string, yearLevel: string, school: string): Promise<SubmissionFileRow[]> {
  // Same 1,000-row PostgREST response cap as fetchSubmissionsForActivity
  // above — without paging, an activity past that many total uploads
  // silently hides its oldest rows from every year-level/school group here,
  // even though the count RPCs above (which run their GROUP BY in the
  // database, not on a capped response) still report them.
  const pageSize = 1000;
  const allRows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("submission_uploads")
      .select("id, original_file_name, field_label_snapshot, mime_type, drive_file_id, storage_path, status, created_at, scholars!inner(first_name, last_name, year_level, school)")
      .eq("activity_id", activityId)
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error || !data) break;
    allRows.push(...(data as unknown as Record<string, unknown>[]));
    if (data.length < pageSize) break;
  }
  const rows = allRows.filter(row => {
    const scholar = (row.scholars as Record<string, unknown> | null) ?? {};
    const rowYearLevel = String(scholar.year_level ?? "").trim() || "No Year Level Set";
    const rowSchool = String(scholar.school ?? "").trim() || "No School Set";
    return rowYearLevel === yearLevel && rowSchool === school;
  });
  return rows.map(row => {
    const scholar = (row.scholars as Record<string, unknown> | null) ?? {};
    const driveFileId = String(row.drive_file_id ?? "");
    const storagePath = String(row.storage_path ?? "");
    const scholarName = `${scholar.first_name ?? ""} ${scholar.last_name ?? ""}`.trim();
    const originalFileName = String(row.original_file_name ?? "");
    return {
      id: String(row.id),
      originalFileName,
      displayFileName: formatSubmissionDisplayName(scholarName, String(row.field_label_snapshot ?? ""), originalFileName),
      mimeType: String(row.mime_type ?? ""),
      storagePath,
      driveViewUrl: !storagePath && driveFileId ? `https://drive.google.com/file/d/${driveFileId}/view` : "",
      status: String(row.status ?? "uploaded"),
      scholarName,
      createdAt: String(row.created_at ?? ""),
    };
  });
}

// ── Submission monitoring roster (Milestone 4) ────────────────
export type SubmissionRosterStatus = "submitted" | "needs_resubmission" | "locked" | "not_submitted";

export interface SubmissionRosterRow {
  scholarId: string;
  scholarIdNumber: string;
  firstName: string;
  lastName: string;
  yearLevel: string;
  school: string;
  status: SubmissionRosterStatus;
}

/**
 * Every scholar the activity's year-level targeting applies to
 * (roster-based, not uploads-based -- a scholar with zero uploads still
 * appears here, unlike fetchSubmissionsForActivity()), each with a
 * computed status. See the RPC's own migration comment
 * (supabase_migration_submission_roster_status_rpc.sql) for the exact
 * status precedence and the Q2/Q3 design decisions this depends on.
 */
export async function fetchSubmissionRosterStatus(activityId: string): Promise<{ ok: boolean; error?: string; rows?: SubmissionRosterRow[] }> {
  // get_submission_roster_status() returns one row per eligible scholar,
  // which can exceed Supabase/PostgREST's default 1,000-row response cap
  // for a broadly-targeted activity (e.g. all_year_levels=true) — this
  // org is already confirmed elsewhere in this project to have more than
  // 1,000 scholars. A single unpaginated call here was silently
  // truncating the roster, producing incomplete submitted/locked/
  // not-submitted/etc. totals for both filtered and unfiltered views
  // (both derive from this same array). Pages through with .range()
  // instead, mirroring fetchSubjectRankings()'s established pattern in
  // seadApi.ts. Requires the v3 migration
  // (supabase_migration_submission_roster_status_rpc_v3.sql), which adds
  // a scholar-id tiebreaker to the RPC's ORDER BY — without a fully
  // deterministic row order, paging with .range() could skip or
  // duplicate a row right at a page boundary.
  //
  // Pages are fetched in parallel batches, not one .range() call at a
  // time: each call re-executes the RPC's entire query — PostgREST only
  // slices the result at the wire level, not inside the query itself —
  // so awaiting one page before requesting the next meant a roster this
  // org's size (~7,000+ scholars ÷ 500/page) paid for ~15 full sequential
  // round trips back-to-back (measured: this RPC alone runs ~500ms
  // server-side, so ~15 of them one after another is most of what made
  // this screen feel like "loading for a significant amount of time").
  // Firing a batch of pages at once collapses that to roughly one round
  // trip's wall-clock time, at the cost of some real database work if the
  // roster turns out smaller than the batch guessed — an acceptable
  // trade for an occasional staff monitoring screen, not a
  // high-frequency endpoint.
  const rows: SubmissionRosterRow[] = [];
  const pageSize = 500;
  const batchSize = 20; // generous headroom over this org's confirmed ~7,000-scholar scale
  let pageIndex = 0;
  outer: while (true) {
    const results = await Promise.all(
      Array.from({ length: batchSize }, (_, i) => {
        const from = (pageIndex + i) * pageSize;
        return supabase.rpc("get_submission_roster_status", { p_activity_id: activityId }).range(from, from + pageSize - 1);
      }),
    );
    for (const { data, error } of results) {
      if (error) return { ok: false, error: error.message };
      if (!data || data.length === 0) break outer;
      rows.push(...(data as Record<string, unknown>[]).map(r => ({
        scholarId: r.scholar_id as string,
        scholarIdNumber: (r.scholar_id_number as string) ?? "",
        firstName: r.first_name as string,
        lastName: r.last_name as string,
        yearLevel: r.year_level as string,
        school: (r.school as string) ?? "",
        status: r.status as SubmissionRosterStatus,
      })));
      if (data.length < pageSize) break outer;
    }
    pageIndex += batchSize;
  }
  return { ok: true, rows };
}
