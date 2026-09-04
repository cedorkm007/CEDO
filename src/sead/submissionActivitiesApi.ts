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
  mimeType: string;
  /** https://drive.google.com/file/d/{id}/view — empty if the row somehow has no Drive file id. */
  driveViewUrl: string;
  status: string;
  staffComment: string;
  createdAt: string;
}

export async function fetchSubmissionsForActivity(activityId: string): Promise<SubmissionForReview[]> {
  const { data, error } = await supabase
    .from("submission_uploads")
    .select(
      "id, scholar_id, field_id, field_label_snapshot, original_file_name, mime_type, drive_file_id, status, staff_comment, created_at, " +
      "scholars (scholar_id_number, first_name, last_name, year_level)"
    )
    .eq("activity_id", activityId)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return (data as unknown as Record<string, unknown>[]).map(row => {
    const scholar = (row.scholars as Record<string, unknown> | null) ?? {};
    const driveFileId = String(row.drive_file_id ?? "");
    return {
      id: String(row.id),
      scholarId: String(row.scholar_id ?? ""),
      scholarIdNumber: String(scholar.scholar_id_number ?? ""),
      scholarName: `${scholar.first_name ?? ""} ${scholar.last_name ?? ""}`.trim(),
      yearLevel: String(scholar.year_level ?? ""),
      fieldId: String(row.field_id ?? ""),
      fieldLabel: String(row.field_label_snapshot ?? ""),
      originalFileName: String(row.original_file_name ?? ""),
      mimeType: String(row.mime_type ?? ""),
      driveViewUrl: driveFileId ? `https://drive.google.com/file/d/${driveFileId}/view` : "",
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

export interface ReorganizeFileResult {
  uploadId: string;
  fileName: string;
  scholarName: string;
  ok: boolean;
  error?: string;
}

export interface ReorganizeActivityResult {
  activityName: string;
  totalFiles: number;
  movedCount: number;
  results: ReorganizeFileResult[];
}

/**
 * Retroactively moves one activity's already-uploaded files from the old
 * two-level Drive structure into the new three-level (+ School) one —
 * Milestone 2's actual deliverable. Scoped to one activity per call by
 * design (see the Edge Function's own header comment for why); calling
 * this again for the same activity is safe (moveFile()'s underlying
 * removeParents is a no-op for a file already moved).
 */
export async function reorganizeActivityDriveFiles(activityId: string): Promise<{ ok: boolean; error?: string; result?: ReorganizeActivityResult }> {
  const result = await invokeEdgeFunction<{ activityName: string; totalFiles: number; movedCount: number; results: ReorganizeFileResult[] }>(
    "submission-reorganize-activity-files", { activityId }
  );
  if (!result.ok || !result.data) return { ok: false, error: result.error || "Failed to reorganize files." };
  return {
    ok: true,
    result: {
      activityName: result.data.activityName,
      totalFiles: result.data.totalFiles,
      movedCount: result.data.movedCount,
      results: result.data.results,
    },
  };
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
