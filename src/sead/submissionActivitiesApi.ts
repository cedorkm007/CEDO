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

export interface SubmissionUploadField {
  id: string;
  label: string;
  isRequired: boolean;
  maxFiles: number;
  sortOrder: number;
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

function rowToUploadField(row: Record<string, unknown>): SubmissionUploadField {
  return {
    id: String(row.id),
    label: String(row.label ?? ""),
    isRequired: Boolean(row.is_required),
    maxFiles: Number(row.max_files ?? 1),
    sortOrder: Number(row.sort_order ?? 0),
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

// ── Read ──────────────────────────────────────────────────────

export async function fetchSubmissionActivities(): Promise<SubmissionActivity[]> {
  const { data, error } = await supabase
    .from("submission_activities")
    .select("id, name, description, all_year_levels, target_year_levels, created_at, updated_at, submission_upload_fields (id, label, is_required, max_files, sort_order)")
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
  /** Full desired field list, in display order. On create, all get inserted; on update, this fully replaces the activity's existing fields (see setSubmissionUploadFields). */
  uploadFields: { label: string; isRequired: boolean; maxFiles: number }[];
}

async function setSubmissionUploadFields(activityId: string, fields: SubmissionActivityInput["uploadFields"]): Promise<{ ok: boolean; error?: string }> {
  // Simplest correct approach for "add, remove, and reorder": replace the
  // full set every save rather than diffing individual field edits. These
  // rows carry no data beyond their own label/required/max/order (no
  // scholar submissions reference them yet in Part 1 — that only starts
  // in Part 2), so there's nothing meaningful lost by not diffing.
  const { error: deleteError } = await supabase.from("submission_upload_fields").delete().eq("activity_id", activityId);
  if (deleteError) return { ok: false, error: deleteError.message };
  if (fields.length === 0) return { ok: true };
  const { error: insertError } = await supabase.from("submission_upload_fields").insert(
    fields.map((f, index) => ({ activity_id: activityId, label: f.label, is_required: f.isRequired, max_files: f.maxFiles, sort_order: index }))
  );
  return insertError ? { ok: false, error: insertError.message } : { ok: true };
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
