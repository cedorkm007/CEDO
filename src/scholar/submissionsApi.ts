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
}

export interface SubmissionActivityForScholar {
  id: string;
  name: string;
  description: string;
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
  const { data, error } = await supabase
    .from("submission_activities")
    .select("id, name, description, submission_upload_fields (id, label, is_required, max_files, sort_order)")
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(row => {
    const fieldRows = (row.submission_upload_fields as Record<string, unknown>[] | null) ?? [];
    const sortedFields = fieldRows
      .map(f => ({
        id: String(f.id),
        label: String(f.label ?? ""),
        isRequired: Boolean(f.is_required),
        maxFiles: Number(f.max_files ?? 1),
        sortOrder: Number(f.sort_order ?? 0),
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
    return {
      id: String(row.id),
      name: String(row.name ?? ""),
      description: String(row.description ?? ""),
      uploadFields: sortedFields.map(({ sortOrder, ...field }) => field),
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
export function isAllowedSubmissionFileType(file: File): boolean {
  const name = file.name.toLowerCase();
  return SUBMISSION_ALLOWED_FILE_TYPES.some(
    t => t.mimeTypes.includes(file.type) || (file.type === "" && t.extensions.some(ext => name.endsWith(ext)))
  );
}

export function submissionAllowedFileTypesLabel(): string {
  return SUBMISSION_ALLOWED_FILE_TYPES.map(t => t.label).join(", ");
}

// ── Part 4: real uploads ─────────────────────────────────────

export interface SubmissionUploadRecord {
  id: string;
  fieldId: string;
  originalFileName: string;
  status: string;
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
    .select("id, field_id, original_file_name, status, created_at")
    .eq("activity_id", activityId)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(row => ({
    id: String(row.id),
    fieldId: String(row.field_id ?? ""),
    originalFileName: String(row.original_file_name ?? ""),
    status: String(row.status ?? "uploaded"),
    createdAt: String(row.created_at ?? ""),
  }));
}
