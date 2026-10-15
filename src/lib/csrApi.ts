// ─────────────────────────────────────────────────────────────
// src/lib/csrApi.ts
// The Certificate of Scholarship Renewal (CSR), for the scholar and for the staff screens.
// Who may have a certificate, and when, is decided by the database (supabase_migration_renewal_p8_csr.sql); the PDF itself is made by the
// "csr-issue" edge function. These calls only ask.
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));
const strOrNull = (v: unknown) => (v == null ? null : String(v));

export interface CsrCopy { csrNumber: string; version: number; issuedAt: string | null; replaced: boolean; reason: string; by: string }
export interface CsrInfo {
  /** Has the office switched certificates on? */
  enabled: boolean;
  /** Is this renewal confirmed (stage Renewed) and the scholar not Removed? */
  eligible: boolean;
  copies: CsrCopy[];
}

/** What the screen needs to know about a renewal's certificate. Null when it can't be read (or Phase 8 isn't installed yet). */
export async function fetchCsrInfo(recordId: string): Promise<CsrInfo | null> {
  const { data, error } = await supabase.rpc("csr_for_record", { p_record_id: recordId });
  if (error || !data) return null;
  const d = data as Row;
  return {
    enabled: !!d.enabled, eligible: !!d.eligible,
    copies: ((d.copies ?? []) as Row[]).map(c => ({ csrNumber: str(c.csr_number), version: Number(c.version ?? 1), issuedAt: strOrNull(c.issued_at), replaced: !!c.replaced, reason: str(c.reason), by: str(c.by) })),
  };
}

export type CsrIssued = { ok: true; url: string; csrNumber: string; version: number; fileName: string } | { ok: false; error: string };

/** Asks for the certificate (made once, then the same stored file every time). A reason makes a corrected copy (evaluator only). */
export async function requestCsr(recordId: string, reason?: string): Promise<CsrIssued> {
  const { data, error } = await supabase.functions.invoke("csr-issue", { body: { recordId, ...(reason ? { reason } : {}) } });
  if (error) {
    let message = error.message;
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === "function") {
      try { const parsed = await context.clone().json(); if (parsed?.error) message = parsed.error; } catch { /* body wasn't JSON — keep the generic message */ }
    }
    return { ok: false, error: message };
  }
  const d = data as { error?: string; url?: string; csrNumber?: string; version?: number; fileName?: string } | null;
  if (d?.error) return { ok: false, error: d.error };
  if (!d?.url) return { ok: false, error: "The certificate could not be made. Please try again." };
  return { ok: true, url: d.url, csrNumber: str(d.csrNumber), version: Number(d.version ?? 1), fileName: str(d.fileName) };
}

/** Opens the finished file. A link with the "download" header saves it under its tidy name. */
export function openCsrDownload(url: string, fileName: string): void {
  const a = document.createElement("a");
  a.href = url; a.download = fileName; a.rel = "noopener"; a.target = "_blank";
  document.body.appendChild(a); a.click(); a.remove();
}

// ── Settings (evaluator and IT admin) ──
export type SignaturePictureKey = "officer" | "mayor" | "mayorMark";
export interface CsrSettings {
  enabled: boolean; officerName: string; officerTitle: string; mayorName: string; mayorTitle: string; place: string;
  officerSignaturePath: string | null; mayorSignaturePath: string | null; mayorMarkPath: string | null; updatedAt: string | null; updatedBy: string | null;
}

export async function fetchCsrSettings(): Promise<{ ok: true; settings: CsrSettings } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("csr_settings_get");
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't load the certificate settings." };
  const d = data as Row;
  return {
    ok: true,
    settings: {
      enabled: !!d.enabled, officerName: str(d.officer_name), officerTitle: str(d.officer_title), mayorName: str(d.mayor_name), mayorTitle: str(d.mayor_title), place: str(d.place),
      officerSignaturePath: strOrNull(d.officer_signature_path), mayorSignaturePath: strOrNull(d.mayor_signature_path), mayorMarkPath: strOrNull(d.mayor_mark_path),
      updatedAt: strOrNull(d.updated_at), updatedBy: strOrNull(d.updated_by),
    },
  };
}

/** A picture path of undefined keeps what is stored; null removes it (the office's sample picture is used again). */
export interface CsrSettingsInput {
  enabled: boolean; officerName: string; officerTitle: string; mayorName: string; mayorTitle: string; place: string;
  officerSignaturePath?: string | null; mayorSignaturePath?: string | null; mayorMarkPath?: string | null;
}
const pictureArg = (v: string | null | undefined) => (v === undefined ? null : v === null ? "" : v);

export async function saveCsrSettings(input: CsrSettingsInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.rpc("csr_settings_save", {
    p_enabled: input.enabled, p_officer_name: input.officerName, p_officer_title: input.officerTitle, p_mayor_name: input.mayorName, p_mayor_title: input.mayorTitle, p_place: input.place,
    p_officer_signature_path: pictureArg(input.officerSignaturePath), p_mayor_signature_path: pictureArg(input.mayorSignaturePath), p_mayor_mark_path: pictureArg(input.mayorMarkPath),
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

const ASSETS_BUCKET = "csr-assets";

/** Uploads a signature picture (a PNG, with a transparent background) and returns its stored path. */
export async function uploadCsrPicture(key: SignaturePictureKey, png: Blob): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const path = `${key}-${Date.now()}.png`;
  const { error } = await supabase.storage.from(ASSETS_BUCKET).upload(path, png, { contentType: "image/png", upsert: false });
  return error ? { ok: false, error: error.message } : { ok: true, path };
}

/** A short-lived link to show a stored signature picture in the settings preview. */
export async function csrPictureUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(ASSETS_BUCKET).createSignedUrl(path, 300);
  return error || !data ? null : data.signedUrl;
}

/** Removes picture files that are no longer used (best effort). */
export async function removeCsrPictures(paths: string[]): Promise<void> {
  const list = paths.filter(Boolean);
  if (list.length) await supabase.storage.from(ASSETS_BUCKET).remove(list);
}
