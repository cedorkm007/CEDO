import { supabase } from "@/lib/supabase";

// ── Types ─────────────────────────────────────────────────────

export type FormMaterialKind = "pdf" | "flipbook";

/** A single unlock rule. A material with an empty conditions array is unlocked for everyone. */
export type FormMaterialCondition =
  | { type: "quest_subject"; subjectId: string; subjectName?: string }
  | { type: "formation_activity"; formationActivityId: string; formationActivityName?: string }
  | { type: "sdp_activity"; sdpActivityId: string; sdpActivityName?: string }
  | { type: "year_level"; allYearLevels: boolean; yearLevels: string[] }
  | { type: "course"; course: string };

export interface FormMaterial {
  id: string;
  title: string;
  kind: FormMaterialKind;
  /** Flipbooks only — the external link to open. Always "" for PDFs; the file lives in storage instead. */
  url: string;
  description: string;
  /** Original filename of the uploaded PDF, for display. Always "" for flipbooks or a pdf with no file yet. */
  fileName: string;
  conditions: FormMaterialCondition[];
  createdAt: string;
  updatedAt: string;
}

// ── Row mapping ───────────────────────────────────────────────

function rowToCondition(row: Record<string, unknown>): FormMaterialCondition {
  switch (row.condition_type as string) {
    case "quest_subject":
      return { type: "quest_subject", subjectId: String(row.subject_id), subjectName: (row.quest_subjects as { name?: string } | null)?.name };
    case "formation_activity":
      return { type: "formation_activity", formationActivityId: String(row.formation_activity_id), formationActivityName: (row.formation_activities as { name?: string } | null)?.name };
    case "sdp_activity":
      return { type: "sdp_activity", sdpActivityId: String(row.sdp_activity_id), sdpActivityName: (row.sdp_activities as { name?: string } | null)?.name };
    case "course":
      return { type: "course", course: String(row.course ?? "") };
    default:
      return { type: "year_level", allYearLevels: Boolean(row.all_year_levels), yearLevels: (row.target_year_levels as string[] | null) ?? [] };
  }
}

function rowToMaterial(row: Record<string, unknown>): FormMaterial {
  const conditionRows = (row.form_material_conditions as Record<string, unknown>[] | null) ?? [];
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    kind: (row.kind as FormMaterialKind) ?? "pdf",
    url: String(row.url ?? ""),
    description: String(row.description ?? ""),
    fileName: String(row.file_name ?? ""),
    conditions: conditionRows.map(rowToCondition),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

// ── Read ──────────────────────────────────────────────────────

/** All materials with their conditions, for the staff Forms Management list. Requires the forms_management tag. */
export async function fetchFormMaterials(): Promise<FormMaterial[]> {
  const { data, error } = await supabase
    .from("form_materials")
    .select(`
      id, title, kind, url, description, file_name, created_at, updated_at,
      form_material_conditions (
        condition_type, subject_id, formation_activity_id, sdp_activity_id, target_year_levels, all_year_levels, course,
        quest_subjects ( name ),
        formation_activities ( name ),
        sdp_activities ( name )
      )
    `)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data.map(rowToMaterial);
}

// ── Write ─────────────────────────────────────────────────────

/**
 * Creates a material's metadata row. For kind "pdf", pass url: "" and
 * upload the file afterward with uploadFormMaterialFile(id, file) — the
 * row needs to exist first since the storage path is keyed by material id
 * (mirrors createSubject + uploadSubjectCertificate in seadApi.ts). For
 * kind "flipbook", url is the external link and there's nothing to upload.
 */
export async function createFormMaterial(
  title: string, kind: FormMaterialKind, url: string, description: string
): Promise<{ ok: boolean; error?: string; id?: string }> {
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("form_materials")
    .insert({ title, kind, url, description, created_by: auth.user?.id ?? null })
    .select("id")
    .single();
  return error || !data ? { ok: false, error: error?.message || "Failed to create material." } : { ok: true, id: data.id };
}

export async function updateFormMaterial(
  id: string, fields: { title: string; kind: FormMaterialKind; url: string; description: string }
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from("form_materials")
    .update({ title: fields.title, kind: fields.kind, url: fields.url, description: fields.description, updated_at: new Date().toISOString() })
    .eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function deleteFormMaterial(id: string): Promise<{ ok: boolean; error?: string }> {
  // Best-effort — the PDF may not exist (flipbook, or a pdf material with
  // no file uploaded yet); ignore the error and delete the row regardless.
  await supabase.storage.from(FORM_MATERIAL_BUCKET).remove([`${id}/file.pdf`]);
  const { error } = await supabase.from("form_materials").delete().eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

// ── PDF file storage ─────────────────────────────────────────

const FORM_MATERIAL_BUCKET = "form-materials";

/** Uploads (or replaces) a "pdf"-kind material's file. Path is deterministic — {materialId}/file.pdf — so re-uploading overwrites the previous file. */
export async function uploadFormMaterialFile(materialId: string, file: File): Promise<{ ok: boolean; error?: string }> {
  if (file.type !== "application/pdf") return { ok: false, error: "Only PDF files are supported." };
  const path = `${materialId}/file.pdf`;
  const { error: uploadError } = await supabase.storage.from(FORM_MATERIAL_BUCKET).upload(path, file, { contentType: "application/pdf", upsert: true });
  if (uploadError) return { ok: false, error: uploadError.message };

  const { error: updateError } = await supabase.from("form_materials")
    .update({ file_name: file.name, updated_at: new Date().toISOString() }).eq("id", materialId);
  if (updateError) return { ok: false, error: updateError.message };
  return { ok: true };
}

export async function removeFormMaterialFile(materialId: string): Promise<{ ok: boolean; error?: string }> {
  const { error: removeError } = await supabase.storage.from(FORM_MATERIAL_BUCKET).remove([`${materialId}/file.pdf`]);
  if (removeError) return { ok: false, error: removeError.message };
  const { error: updateError } = await supabase.from("form_materials")
    .update({ file_name: "", updated_at: new Date().toISOString() }).eq("id", materialId);
  if (updateError) return { ok: false, error: updateError.message };
  return { ok: true };
}

/** Staff-side preview link for a "pdf"-kind material's file. */
export async function fetchFormMaterialPreviewUrl(materialId: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(FORM_MATERIAL_BUCKET).createSignedUrl(`${materialId}/file.pdf`, 300);
  if (error || !data) return null;
  return data.signedUrl;
}

/**
 * Replaces ALL of a material's conditions with the given set in one call —
 * covers add/edit/replace/clear (an empty array clears every condition,
 * unlocking the material for everyone). Simpler and less error-prone for
 * callers than separate add/remove-one-condition functions, since the
 * staff editor always works with "the current full set of conditions"
 * as a single form.
 */
export async function setFormMaterialConditions(
  materialId: string, conditions: FormMaterialCondition[]
): Promise<{ ok: boolean; error?: string }> {
  const { error: deleteError } = await supabase.from("form_material_conditions").delete().eq("material_id", materialId);
  if (deleteError) return { ok: false, error: deleteError.message };
  if (conditions.length === 0) return { ok: true };

  const rows = conditions.map(c => {
    switch (c.type) {
      case "quest_subject":
        return { material_id: materialId, condition_type: "quest_subject", subject_id: c.subjectId };
      case "formation_activity":
        return { material_id: materialId, condition_type: "formation_activity", formation_activity_id: c.formationActivityId };
      case "sdp_activity":
        return { material_id: materialId, condition_type: "sdp_activity", sdp_activity_id: c.sdpActivityId };
      case "course":
        return { material_id: materialId, condition_type: "course", course: c.course };
      case "year_level":
        return { material_id: materialId, condition_type: "year_level", all_year_levels: c.allYearLevels, target_year_levels: c.yearLevels };
    }
  });
  const { error: insertError } = await supabase.from("form_material_conditions").insert(rows);
  return insertError ? { ok: false, error: insertError.message } : { ok: true };
}
