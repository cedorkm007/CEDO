// ─────────────────────────────────────────────────────────────
// src/lib/removalFormApi.ts
// The Scholarship Grant Termination Acknowledgement Form: made when the Division Head approves a scholar's removal, to be signed by the scholar, the parent or guardian, the Division Head
// and the City Education and Development Officer. The scholar and the consulting staff member the case is assigned to can download it. Who may open it, and what is printed on it, is
// decided by the database (supabase_migration_removal_form.sql); the PDF is made by the "removal-form-issue" edge function. These calls only ask.
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));
const missing = (e: { code?: string; message?: string }) => e.code === "PGRST202" || /could not find the function|does not exist/i.test(e.message ?? "");

export interface RemovalFormItem { referralId: string; issuedOn: string; scholarIdNumber: string; name: string; finalDecisionMade: boolean }

/** The scholar's own forms. Empty (and no error) before the database update has been run. */
export async function fetchMyRemovalForms(): Promise<RemovalFormItem[]> {
  const { data, error } = await supabase.rpc("removal_forms_mine");
  if (error || !Array.isArray(data)) return [];
  return (data as Row[]).map(r => ({ referralId: str(r.referral_id), issuedOn: str(r.issued_on).slice(0, 10), scholarIdNumber: "", name: "", finalDecisionMade: false }));
}

/** The consulting staff member's forms (their own cases only). Empty (and no error) before the database update has been run. */
export async function fetchConsultRemovalForms(): Promise<RemovalFormItem[]> {
  const { data, error } = await supabase.rpc("consult_removal_forms");
  if (error || !Array.isArray(data)) return [];
  return (data as Row[]).map(r => ({ referralId: str(r.referral_id), issuedOn: str(r.issued_on).slice(0, 10), scholarIdNumber: str(r.scholar_id_number), name: str(r.name), finalDecisionMade: !!r.final_decision_made }));
}

/** Asks for the form and saves it as a file on the person's computer. */
export async function downloadRemovalForm(referralId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase.functions.invoke("removal-form-issue", { body: { referralId } });
  if (error) {
    let message = error.message;
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === "function") {
      try { const parsed = await context.clone().json(); if (parsed?.error) message = parsed.error; } catch { /* the body was not JSON: keep the generic message */ }
    }
    return { ok: false, error: message };
  }
  const d = data as { error?: string; fileName?: string; pdfBase64?: string } | null;
  if (d?.error) return { ok: false, error: d.error };
  if (!d?.pdfBase64) return { ok: false, error: "The form could not be made. Please try again." };
  saveBase64Pdf(d.pdfBase64, d.fileName || "Scholarship Termination Form.pdf");
  return { ok: true };
}

/** Turns base64 text into a PDF file download (an invisible link that is pressed). */
export function saveBase64Pdf(base64: string, fileName: string): void {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url; a.download = fileName; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export { missing as removalFormMissing };
