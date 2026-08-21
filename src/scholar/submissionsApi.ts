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
 * This is Part 2 of the feature — it only reads activities/fields so the
 * scholar can see what's being asked for and pick files locally with
 * client-side validation (see isAllowedSubmissionFileType below). There is
 * deliberately no function here to actually persist an upload yet: no
 * file-storage backend (Google Drive) exists until Parts 3-4, so nothing
 * in this part ever writes a real row to submission_uploads — the UI
 * shows a "Google Drive upload will be connected next" message instead of
 * calling a submit function that doesn't exist yet.
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
 * documents as the eventual accepted set. This is a UX convenience (catch
 * an obviously-wrong file before the scholar even tries to submit), not a
 * security boundary — there's no upload endpoint yet for this to gate in
 * Part 2, and whenever Parts 3-4 add one, the real check has to happen
 * server-side regardless of what this function says.
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
