import { supabase } from "@/lib/supabase";

export type FormMaterialKind = "pdf" | "flipbook";

export interface FormMaterial {
  id: string;
  title: string;
  kind: FormMaterialKind;
  /** Flipbooks only — the external link to open. "" for PDFs. */
  url: string;
  description: string;
  /** "" if a "pdf" material has no file uploaded yet. */
  fileName: string;
}

function rowToMaterial(row: Record<string, unknown>): FormMaterial {
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    kind: (row.kind as FormMaterialKind) ?? "pdf",
    url: String(row.url ?? ""),
    description: String(row.description ?? ""),
    fileName: String(row.file_name ?? ""),
  };
}

/**
 * Materials for the scholar's own Forms and Services panel. No client-side
 * filtering needed here — form_materials' RLS (see
 * supabase_migration_form_materials_pdf_upload.sql +
 * supabase_migration_form_materials_scholar_rls_fix.sql) already restricts
 * a scholar's SELECT to materials with zero unlock conditions, so whatever
 * comes back is exactly what should be shown.
 */
export async function fetchFormMaterialsForScholar(): Promise<FormMaterial[]> {
  const { data, error } = await supabase
    .from("form_materials")
    .select("id, title, kind, url, description, file_name")
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data.map(rowToMaterial);
}

const FORM_MATERIAL_BUCKET = "form-materials";

/**
 * Signed download link for a "pdf"-kind material. Storage's own RLS
 * ("scholar downloads unconditioned pdf material" policy) scopes this to
 * the same unconditioned materials the scholar can already see via
 * fetchFormMaterialsForScholar() — a conditioned material's file simply
 * won't sign for a scholar caller.
 */
export async function fetchFormMaterialDownloadUrl(materialId: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(FORM_MATERIAL_BUCKET).createSignedUrl(`${materialId}/file.pdf`, 300);
  if (error || !data) return null;
  return data.signedUrl;
}
