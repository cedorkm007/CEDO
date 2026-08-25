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
  /** Every Quest subject this material has a quest_subject condition on — met or not. Used to tell "this material is unlocked AND actually linked to subject X" apart from "the scholar merely passed subject X" (see QuestsPanel.tsx). Not security-sensitive: subject ids/names are already visible elsewhere in the scholar portal. */
  questSubjectIds: string[];
}

function rowToMaterial(row: Record<string, unknown>): FormMaterial {
  const rawRequirements = row.unmet_requirements;
  const rawSubjectIds = row.quest_subject_ids;
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
    questSubjectIds: Array.isArray(rawSubjectIds) ? rawSubjectIds.map(id => String(id)) : [],
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
  if (error || !data) {
    // Surfaced to the console (not to the scholar — a failed background
    // fetch degrading to "no materials shown" is the right silent
    // fallback for them), matching the same "don't silently swallow the
    // real error" fix already applied to the Submission Activities
    // Google Drive chain. Without this, a real RPC/Postgres error (wrong
    // column, missing function, RLS issue, etc.) was previously
    // indistinguishable from "the scholar genuinely has zero materials."
    if (error) console.error("get_my_form_materials failed:", error);
    return [];
  }
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
  const { data, error } = await supabase.storage.from(FORM_MATERIAL_BUCKET).createSignedUrl(`${materialId}/file.pdf`, 300, { download: true });
  if (error || !data) return null;
  return data.signedUrl;
}

/** A browser-preview URL for an unlocked PDF. Storage RLS enforces the same conditions as downloading. */
export async function fetchFormMaterialPreviewUrl(materialId: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(FORM_MATERIAL_BUCKET).createSignedUrl(`${materialId}/file.pdf`, 300);
  if (error || !data) return null;
  return data.signedUrl;
}

/**
 * Whether at least one material is BOTH unlocked AND actually linked to
 * the given Quest subject via a quest_subject condition — i.e. whether
 * passing this specific subject is genuinely why something became
 * available, not just a coincidence of the scholar passing something.
 * Used to gate QuestsPanel.tsx's "You passed! Check your unlocked Forms"
 * button, which must not appear just because the scholar passed the
 * subject if nothing in Forms Management is actually linked to it.
 */
export function hasUnlockedMaterialForSubject(materials: FormMaterial[], subjectId: string): boolean {
  return materials.some(m => m.isUnlocked && m.questSubjectIds.includes(subjectId));
}

// ── Persistent unlock notifications ──────────────────────────
// Unlike everything above (which only ever reflects a live snapshot),
// these track "has this scholar been told about this unlocked material
// yet" server-side, via scholar_form_unlock_notifications
// (supabase_migration_form_material_unlock_engine.sql, section 7) — so a
// scholar can be notified even when nothing they personally just did
// triggered the unlock (staff created a newly-qualifying material, staff
// loosened/removed a condition, staff changed their year level, or they
// simply logged in later/refreshed).

export interface FormUnlockNotification {
  notificationId: string;
  materialId: string;
  title: string;
  kind: FormMaterialKind;
  createdAt: string;
}

function rowToNotification(row: Record<string, unknown>): FormUnlockNotification {
  return {
    notificationId: String(row.notification_id),
    materialId: String(row.material_id),
    title: String(row.title ?? ""),
    kind: (row.kind as FormMaterialKind) ?? "pdf",
    createdAt: String(row.created_at ?? ""),
  };
}

/**
 * Reconciles the scholar's currently-unlocked materials against their
 * existing notification rows (creating any missing ones server-side),
 * then returns everything still unread — via
 * sync_and_get_my_form_unlock_notifications() (security definer, so this
 * can never create or return a notification for a material the scholar
 * doesn't actually have unlocked; see the migration's own comments for
 * why). Call this on portal load, when the Forms panel opens, after quiz
 * submission, and after successful attendance scanning.
 */
export async function syncAndFetchUnreadFormUnlockNotifications(): Promise<FormUnlockNotification[]> {
  const { data, error } = await supabase.rpc("sync_and_get_my_form_unlock_notifications");
  if (error || !data) {
    // Same fix as fetchFormMaterialsForScholar above, and for the same
    // reason: this specific 400 is exactly what this line was hiding
    // before this fix — the real Postgrest/Postgres error was being
    // discarded, so it never reached the browser console at all, only a
    // generic network-level "400" with no body shown anywhere.
    if (error) console.error("sync_and_get_my_form_unlock_notifications failed:", error);
    return [];
  }
  return (data as Record<string, unknown>[]).map(rowToNotification);
}

/**
 * Marks one or more notifications read/dismissed — call when the scholar
 * clicks either "View in Forms" or "Maybe later" on the popup, never
 * automatically, so a refresh never re-shows something already seen. A
 * plain authenticated UPDATE, not an RPC: the scholar's own RLS policy
 * (scholar_id = auth.uid(), both USING and WITH CHECK) already fully
 * scopes this to the caller's own rows, so no security-definer wrapper is
 * needed here the way the sync/create side needs one.
 */
export async function markFormUnlockNotificationsRead(notificationIds: string[]): Promise<{ ok: boolean; error?: string }> {
  if (notificationIds.length === 0) return { ok: true };
  const { error } = await supabase
    .from("scholar_form_unlock_notifications")
    .update({ read_at: new Date().toISOString() })
    .in("id", notificationIds);
  return error ? { ok: false, error: error.message } : { ok: true };
}
