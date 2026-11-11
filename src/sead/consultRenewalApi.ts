// ─────────────────────────────────────────────────────────────
// src/sead/consultRenewalApi.ts
// The consultation staff's side of a renewal (scholars with a failed subject / DRP): the list of cases, approving or returning the three documents (renewalApi.reviewDocument),
// and endorsing the new scholarship status. Also the evaluator's two answers to an endorsement. Who may do what is decided by the database
// (supabase_migration_renewal_consultation_endorse.sql); these calls just ask.
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";
import type { DocKind } from "@/lib/renewal";

export type Done = { ok: true } | { ok: false; error: string };
type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));
const strOrNull = (v: unknown) => (v == null ? null : String(v));

/** The four statuses the consultation staff may endorse. */
export const ENDORSE_STATUSES = ["Regular", "Probationary", "Reconsidered", "Removed"] as const;
export type EndorseStatus = (typeof ENDORSE_STATUSES)[number];
export const ENDORSE_STATUS_INFO: Record<EndorseStatus, { effect: string; needsReason: boolean }> = {
  Regular: { effect: "The scholar is renewed as a Regular scholar.", needsReason: false },
  Probationary: { effect: "The scholar is renewed and put on Probationary status.", needsReason: true },
  Reconsidered: { effect: "The scholar is renewed with the Reconsidered status (one more chance).", needsReason: true },
  Removed: { effect: "The scholarship ends: the scholar is Removed and the login is switched off.", needsReason: true },
};

export interface ConsultCaseDocument { id: string; kind: DocKind; fileName: string; status: "submitted" | "accepted" | "returned"; comment: string | null; uploadedAt: string; storagePath: string }
export interface ConsultCase {
  recordId: string; scholarIdNumber: string; name: string; school: string; program: string; yearLevel: string; scholarStatus: string; termLabel: string; stage: string;
  ruleCode: string | null; ruleText: string | null; failedSubjects: { code: string; subject: string; grade: string; outcome?: string }[]; incSubjects: { code: string; subject: string; grade: string }[];
  consultationDoneAt: string | null; nextConsultation: { startsAt: string; staff: string } | null;
  requiredDocuments: { kind: DocKind; label: string; satisfied: boolean; approved?: boolean }[]; documents: ConsultCaseDocument[];
  canEndorse: boolean; endorsedStatus: EndorseStatus | null; endorsedAt: string | null; endorsedNote: string | null; endorsedBy: string | null; legacy: boolean;
}

export async function fetchConsultCases(): Promise<{ ok: true; rows: ConsultCase[] } | { ok: false; error: string; missing?: boolean }> {
  const { data, error } = await supabase.rpc("renewal_consult_cases");
  if (error) return { ok: false, error: error.message, missing: /could not find the function|does not exist/i.test(error.message) };
  return {
    ok: true,
    rows: ((data ?? []) as Row[]).map(r => ({
      recordId: str(r.record_id), scholarIdNumber: str(r.scholar_id_number), name: str(r.name), school: str(r.school), program: str(r.program), yearLevel: str(r.year_level),
      scholarStatus: str(r.scholar_status), termLabel: str(r.term_label), stage: str(r.stage), ruleCode: strOrNull(r.rule_code), ruleText: strOrNull(r.rule_text),
      failedSubjects: ((r.failed_subjects ?? []) as Row[]).map(x => ({ code: str(x.code), subject: str(x.subject), grade: str(x.grade), outcome: strOrNull(x.outcome) ?? undefined })),
      incSubjects: ((r.inc_subjects ?? []) as Row[]).map(x => ({ code: str(x.code), subject: str(x.subject), grade: str(x.grade) })),
      consultationDoneAt: strOrNull(r.consultation_done_at),
      nextConsultation: r.next_consultation ? { startsAt: str((r.next_consultation as Row).starts_at), staff: str((r.next_consultation as Row).staff) } : null,
      requiredDocuments: ((r.required_documents ?? []) as Row[]).map(x => ({ kind: x.kind as DocKind, label: str(x.label), satisfied: !!x.satisfied, approved: x.approved == null ? undefined : !!x.approved })),
      documents: ((r.documents ?? []) as Row[]).map(x => ({ id: str(x.id), kind: x.kind as DocKind, fileName: str(x.file_name), status: str(x.status) as ConsultCaseDocument["status"], comment: strOrNull(x.comment), uploadedAt: str(x.uploaded_at), storagePath: str(x.storage_path) })),
      canEndorse: !!r.can_endorse, endorsedStatus: (strOrNull(r.endorsed_status) as EndorseStatus | null), endorsedAt: strOrNull(r.endorsed_at), endorsedNote: strOrNull(r.endorsed_note),
      endorsedBy: strOrNull(r.endorsed_by), legacy: !!r.legacy,
    })),
  };
}

/** The consultation staff endorse the new scholarship status (only after the consultation was attended AND the three documents are approved). */
export async function endorseStatus(recordId: string, status: EndorseStatus, note: string): Promise<Done> {
  const { error } = await supabase.rpc("renewal_endorse_status", { p_record_id: recordId, p_status: status, p_note: note });
  return error ? { ok: false, error: error.message } : { ok: true };
}
/** The Scholar Renewal evaluator approves the endorsement: the scholar is renewed with that status (or removed). */
export async function approveEndorsement(recordId: string, note: string): Promise<Done> {
  const { error } = await supabase.rpc("renewal_approve_endorsement", { p_record_id: recordId, p_note: note });
  return error ? { ok: false, error: error.message } : { ok: true };
}
/** The evaluator sends the endorsement back to the consultation staff with a reason. */
export async function returnEndorsement(recordId: string, reason: string): Promise<Done> {
  const { error } = await supabase.rpc("renewal_return_endorsement", { p_record_id: recordId, p_reason: reason });
  return error ? { ok: false, error: error.message } : { ok: true };
}
