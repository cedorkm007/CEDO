import { supabase } from "@/lib/supabase";

export type FormMaterialKind = "pdf" | "flipbook";

export interface UnmetRequirement {
  type: string;
  label: string;
}

export interface FormMaterial {
  id: string;
  title: string;
  kind: FormMaterialKind;
  /** Flipbooks only — the external link to open. "" for PDFs, or when this material is locked for the current scholar (the server blanks it either way — see fetchFormMaterialsForScholar). */
  url: string;
  description: string;
  /** "" if a "pdf" material has no file uploaded yet, or when this material is locked for the current scholar. */
  fileName: string;
  /** Whether the signed-in scholar currently meets every unlock condition on this material. A material outside the scholar's year level isn't returned at all, so this only ever reflects the non-year_level conditions. */
  isUnlocked: boolean;
  /** Which specific conditions are still unmet, for display to the scholar — always empty when isUnlocked is true. */
  unmetRequirements: UnmetRequirement[];
}

function rowToMaterial(row: Record<string, unknown>): FormMaterial {
  const rawRequirements = row.unmet_requirements;
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    kind: (row.kind as FormMaterialKind) ?? "pdf",
    url: String(row.url ?? ""),
    description: String(row.description ?? ""),
    fileName: String(row.file_name ?? ""),
    isUnlocked: Boolean(row.is_unlocked),
    unmetRequirements: Array.isArray(rawRequirements)
      ? (rawRequirements as { type?: unknown; label?: unknown }[]).map(r => ({ type: String(r.type ?? ""), label: String(r.label ?? "") }))
      : [],
  };
}

/**
 * Materials for the scholar's own Forms and Services panel, via the
 * get_my_form_materials() RPC (supabase_migration_form_material_unlock_
 * engine.sql) rather than a raw table select. The RPC does two things a
 * plain select can't:
 *   1. It evaluates each material's unlock conditions server-side and
 *      returns is_unlocked plus exactly which requirements are still
 *      unmet, so a scholar can see WHY something is locked instead of it
 *      just being absent.
 *   2. It filters to materials applicable to the scholar's own year level,
 *      and blanks url/file_name for anything still locked — a locked
 *      material's actual link never reaches the client in the normal case.
 * That said, this RPC's output is a convenience/UX layer, not the real
 * security boundary for the PDF's bytes — see fetchFormMaterialDownloadUrl
 * below for the enforcement that actually matters.
 */
export async function fetchFormMaterialsForScholar(): Promise<FormMaterial[]> {
  const { data, error } = await supabase.rpc("get_my_form_materials");
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(rowToMaterial);
}

const FORM_MATERIAL_BUCKET = "form-materials";

/**
 * Signed download link for a "pdf"-kind material. This only ever succeeds
 * for a material the storage bucket's "scholar downloads unlocked form
 * material" policy (supabase_migration_form_material_unlock_engine.sql)
 * actually grants — i.e. is_form_material_unlocked() evaluates true for
 * the calling scholar — regardless of what fetchFormMaterialsForScholar()
 * returned. The file's bytes are gated independently of the metadata row,
 * the same way subject certificates already are
 * (supabase_migration_subject_passing_rate.sql) — so even if a caller
 * somehow had a stale/locked material's id, this call would still fail
 * for it.
 */
export async function fetchFormMaterialDownloadUrl(materialId: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(FORM_MATERIAL_BUCKET).createSignedUrl(`${materialId}/file.pdf`, 300);
  if (error || !data) return null;
  return data.signedUrl;
}
