import { supabase } from "@/lib/supabase";
import { SUBMISSION_ALLOWED_FILE_TYPES } from "@/sead/submissionActivitiesApi";

// Re-exported so scholar-side callers have one place to import from,
// without every caller needing to know this constant actually lives in
// the staff-side module. There's existing precedent in this codebase for
// crossing this same boundary the other direction — SubmissionActivitiesSection.tsx
// (staff) already imports FORMATION_YEAR_LEVELS from the scholar side —
// so sharing this one constant back the other way keeps a single
// definition instead of two copies drifting apart.
export { SUBMISSION_ALLOWED_FILE_TYPES };

export interface SubmissionUploadFieldForScholar {
  id: string;
  label: string;
  isRequired: boolean;
  maxFiles: number;
  allowedCategories: string[];
}

export interface SubmissionActivityForScholar {
  id: string;
  name: string;
  description: string;
  isUnlocked: boolean;
  unmetRequirements: { type: string; label: string }[];
  uploadFields: SubmissionUploadFieldForScholar[];
}

/**
 * Submission Activities applicable to the signed-in scholar, for Calendar
 * and Activities → Activities. No year-level filtering happens here —
 * supabase_migration_submission_activities.sql's RLS policies ("scholar
 * reads own-year-level activities" / "...fields for own-year-level
 * activities") already restrict this to activities that apply to the
 * scholar's own year level, the same way form_materials relies on its own
 * RLS/RPC rather than a client-side filter.
 *
 * Originally Part 2 of the feature (read-only: activities/fields so the
 * scholar can see what's being asked for and pick files locally with
 * client-side validation — see isAllowedSubmissionFileType below). As of
 * Part 4, uploadSubmissionFile and fetchSubmissionUploadsForScholar below
 * are the real persistence path this function's own results feed into.
 */
export async function fetchSubmissionActivitiesForScholar(): Promise<SubmissionActivityForScholar[]> {
  const { data, error } = await supabase.rpc("get_my_submission_activities");
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(row => {
    const fieldRows = (row.upload_fields as Record<string, unknown>[] | null) ?? [];
    const unmetRequirements = (row.unmet_requirements as { type?: unknown; label?: unknown }[] | null) ?? [];
    // NOTE: get_my_submission_activities() (supabase_migration_submission_activity_unlock_conditions.sql)
    // builds each field via jsonb_build_object with camelCase keys
    // ('isRequired', 'maxFiles') — reading snake_case here (is_required,
    // max_files) was a pre-existing bug that silently made every field
    // read as isRequired: false and maxFiles: 1 regardless of the real
    // configured values, since those keys never existed in the response.
    // Fixed as part of adding allowedCategories below, which needed this
    // block touched anyway.
    const sortedFields = fieldRows
      .map(f => {
        const categories = Array.isArray(f.allowedCategories) ? (f.allowedCategories as unknown[]).map(String) : [];
        return {
          id: String(f.id),
          label: String(f.label ?? ""),
          isRequired: Boolean(f.isRequired),
          maxFiles: Number(f.maxFiles ?? 1),
          sortOrder: 0, // the RPC already orders this array server-side (order by u.sort_order inside jsonb_agg) and doesn't include sort_order as its own key — nothing to read here, .sort() below is a harmless no-op preserving that order
          // Same non-empty fallback as the staff-side rowToUploadField —
          // an empty/missing value must never mean "nothing is accepted."
          allowedCategories: categories.length > 0 ? categories : SUBMISSION_ALLOWED_FILE_TYPES.map(t => t.label),
        };
      })
      .sort((a, b) => a.sortOrder - b.sortOrder);
    return {
      id: String(row.id),
      name: String(row.name ?? ""),
      description: String(row.description ?? ""),
      isUnlocked: Boolean(row.is_unlocked),
      unmetRequirements: unmetRequirements.map(requirement => ({ type: String(requirement.type ?? ""), label: String(requirement.label ?? "") })),
      uploadFields: sortedFields.map(({ sortOrder: _sortOrder, ...field }) => field),
    };
  });
}

/**
 * Client-side type check only — mirrors what SUBMISSION_ALLOWED_FILE_TYPES
 * documents as the accepted set. This is a UX convenience (catch an
 * obviously-wrong file before the scholar even tries to submit), not the
 * security boundary — as of Part 4 that's
 * isAllowedSubmissionUpload in supabase/functions/_shared/allowedFileTypes.ts,
 * which submission-upload-file actually gates on server-side regardless
 * of what this function says.
 */
export function isAllowedSubmissionFileType(file: File, allowedCategories?: string[]): boolean {
  const name = file.name.toLowerCase();
  const candidates = allowedCategories && allowedCategories.length > 0
    ? SUBMISSION_ALLOWED_FILE_TYPES.filter(t => allowedCategories.includes(t.label))
    : SUBMISSION_ALLOWED_FILE_TYPES;
  return candidates.some(
    t => (t.mimeTypes as readonly string[]).includes(file.type) || (file.type === "" && t.extensions.some(ext => name.endsWith(ext)))
  );
}

/** Human-readable label for one field's configured categories, e.g. "PDF, JPEG, PNG" — for the scholar-facing file picker hint text. */
export function submissionFieldAllowedTypesLabel(allowedCategories: string[]): string {
  return allowedCategories.length > 0 ? allowedCategories.join(", ") : SUBMISSION_ALLOWED_FILE_TYPES.map(t => t.label).join(", ");
}

export function submissionAllowedFileTypesLabel(): string {
  return SUBMISSION_ALLOWED_FILE_TYPES.map(t => t.label).join(", ");
}

// ── Part 4: real uploads ─────────────────────────────────────

export interface SubmissionUploadRecord {
  id: string;
  fieldId: string;
  originalFileName: string;
  /** 'uploaded' (pending review), 'accepted', or 'needs_resubmission' — see Part 5's supabase_migration_submission_review.sql. */
  status: string;
  /** Set by staff alongside a 'needs_resubmission' status (Part 5) — empty otherwise. */
  staffComment: string;
  createdAt: string;
}

/**
 * Same error-unwrapping convention as seadApi.ts's invokeEdgeFunction —
 * flagged in Part 3's handoff as worth following here too, kept as its
 * own copy rather than importing from src/sead since that module is the
 * staff-side surface and this is scholar-side; the two are already
 * developed independently elsewhere in this codebase (see
 * submissionsApi.ts's own top-of-file comment on SUBMISSION_ALLOWED_FILE_TYPES
 * for the established precedent on which direction constants/helpers do
 * and don't get shared across that boundary).
 */
async function invokeScholarEdgeFunction<T = Record<string, unknown>>(
  name: string, body: FormData | object,
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

/**
 * Uploads one file for one activity/field through the secure
 * submission-upload-file Edge Function (see
 * supabase/functions/submission-upload-file/index.ts). File bytes go as
 * multipart/form-data so the Edge Function can read them via
 * req.formData() and stream them on to Google Drive — no Drive
 * credential is ever present in the browser. Server-side re-validates
 * file type and the field's max-files rule regardless of what the caller
 * already checked client-side.
 */
export async function uploadSubmissionFile(
  activityId: string, fieldId: string, file: File,
): Promise<{
  ok: boolean;
  error?: string;
  upload?: { id: string; originalFileName: string; status: string; createdAt: string };
}> {
  const form = new FormData();
  form.append("activityId", activityId);
  form.append("fieldId", fieldId);
  form.append("file", file, file.name);
  const result = await invokeScholarEdgeFunction<{
    upload?: { id: string; originalFileName: string; status: string; createdAt: string };
  }>("submission-upload-file", form);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, upload: result.data?.upload };
}

/**
 * The scholar's own already-uploaded files for one activity, across all
 * its fields — used so re-opening Calendar and Activities shows real
 * previously-uploaded files instead of resetting to an empty picker on
 * every page load. Reads submission_uploads directly (not an Edge
 * Function): "scholar reads own submissions" RLS
 * (supabase_migration_submission_uploads.sql) already scopes this to the
 * caller's own rows — the same direct-table-read pattern
 * fetchSubmissionActivitiesForScholar above already uses for activities.
 */
export async function fetchSubmissionUploadsForScholar(activityId: string): Promise<SubmissionUploadRecord[]> {
  const { data, error } = await supabase
    .from("submission_uploads")
    .select("id, field_id, original_file_name, status, staff_comment, created_at")
    .eq("activity_id", activityId)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(row => ({
    id: String(row.id),
    fieldId: String(row.field_id ?? ""),
    originalFileName: String(row.original_file_name ?? ""),
    status: String(row.status ?? "uploaded"),
    staffComment: String(row.staff_comment ?? ""),
    createdAt: String(row.created_at ?? ""),
  }));
}

/**
 * Not started / Submitted / Needs Resubmission — the three-state overview
 * the original spec asked SubmissionActivityCard to show (Part 2's own
 * implementation never actually rendered this; Part 5 adds it since it's
 * now driven by real staff review data). "Submitted" covers both a
 * pending-review upload and a staff-accepted one — the per-file badges
 * elsewhere on the card distinguish those two further.
 */
export type SubmissionOverallStatus = "not_started" | "submitted" | "needs_resubmission";

export function overallSubmissionStatus(uploads: SubmissionUploadRecord[]): SubmissionOverallStatus {
  if (uploads.length === 0) return "not_started";
  if (uploads.some(u => u.status === "needs_resubmission")) return "needs_resubmission";
  return "submitted";
}
