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
/** A case as the list shows it: a SUMMARY (the documents are read when the case is opened: see ConsultCaseDocs). */
export interface ConsultCase {
  recordId: string; scholarIdNumber: string; name: string; school: string; program: string; yearLevel: string; scholarStatus: string; schoolYear: string; term: string; termLabel: string; stage: string; group: "ready" | "work" | "sent";
  ruleCode: string | null; ruleText: string | null; failedSubjects: { code: string; subject: string; grade: string; outcome?: string }[]; incSubjects: { code: string; subject: string; grade: string }[];
  consultationDoneAt: string | null; nextConsultation: { startsAt: string; staff: string } | null;
  docsSubmitted: number; docsAccepted: number; docsReturned: number; requiredCount: number;
  canEndorse: boolean; endorsedStatus: EndorseStatus | null; endorsedAt: string | null; endorsedNote: string | null; endorsedBy: string | null; legacy: boolean;
}
/** What a case needs and what was uploaded: read only when the case is opened. */
export interface ConsultCaseDocs { requiredDocuments: { kind: DocKind; label: string; satisfied: boolean; approved?: boolean }[]; documents: ConsultCaseDocument[] }
export type CasesFailed = { ok: false; error: string; missing?: boolean };
const isMissingFn = (e: { code?: string; message?: string }) => e.code === "PGRST202" || /could not find the function|does not exist/i.test(e.message ?? "");

function rowToCase(r: Row): ConsultCase {
  return {
    recordId: str(r.record_id), scholarIdNumber: str(r.scholar_id_number), name: str(r.name), school: str(r.school), program: str(r.program), yearLevel: str(r.year_level),
    scholarStatus: str(r.scholar_status), schoolYear: str(r.school_year), term: str(r.term), termLabel: str(r.term_label), stage: str(r.stage), group: (str(r.grp) || "work") as ConsultCase["group"],
    ruleCode: strOrNull(r.rule_code), ruleText: strOrNull(r.rule_text),
    failedSubjects: ((r.failed_subjects ?? []) as Row[]).map(x => ({ code: str(x.code), subject: str(x.subject), grade: str(x.grade), outcome: strOrNull(x.outcome) ?? undefined })),
    incSubjects: ((r.inc_subjects ?? []) as Row[]).map(x => ({ code: str(x.code), subject: str(x.subject), grade: str(x.grade) })),
    consultationDoneAt: strOrNull(r.consultation_done_at),
    nextConsultation: r.next_consultation ? { startsAt: str((r.next_consultation as Row).starts_at), staff: str((r.next_consultation as Row).staff) } : null,
    docsSubmitted: Number(r.docs_submitted ?? 0), docsAccepted: Number(r.docs_accepted ?? 0), docsReturned: Number(r.docs_returned ?? 0), requiredCount: Number(r.required_count ?? 0),
    canEndorse: !!r.can_endorse, endorsedStatus: (strOrNull(r.endorsed_status) as EndorseStatus | null), endorsedAt: strOrNull(r.endorsed_at), endorsedNote: strOrNull(r.endorsed_note),
    endorsedBy: strOrNull(r.endorsed_by), legacy: !!r.legacy,
  };
}

export interface CasesQuery { schoolYear: string | null; term: string | null; group: string; search: string }
const caseArgs = (q: CasesQuery) => ({ p_school_year: q.schoolYear, p_term: q.term, p_group: q.group || null, p_search: q.search.trim() });

/** ONE PAGE of the open renewal cases with the TRUE total (a summary of each case; the documents come when a case is opened). `missing: true` = the database update has not been run yet. */
export async function fetchConsultCasesPage(q: CasesQuery, page: number, pageSize: number): Promise<{ ok: true; rows: ConsultCase[]; total: number } | CasesFailed> {
  const { data, error } = await supabase.rpc("renewal_consult_cases_page", { ...caseArgs(q), p_limit: pageSize, p_offset: (Math.max(1, page) - 1) * pageSize });
  if (error) return { ok: false, error: error.message, missing: isMissingFn(error) };
  const rows = (data ?? []) as Row[];
  return { ok: true, rows: rows.map(rowToCase), total: rows.length ? Number(rows[0].total_count ?? 0) : 0 };
}
/** Just ONE case (to refresh the case that changed, without reading the list again); null when it is no longer an open case. */
export async function fetchConsultCaseOne(recordId: string): Promise<{ ok: true; row: ConsultCase | null } | CasesFailed> {
  const { data, error } = await supabase.rpc("renewal_consult_cases_page", { p_record_id: recordId, p_limit: 1, p_offset: 0 });
  if (error) return { ok: false, error: error.message, missing: isMissingFn(error) };
  const rows = (data ?? []) as Row[];
  return { ok: true, row: rows.length ? rowToCase(rows[0]) : null };
}
/** The documents of ONE case, read when it is opened. */
export async function fetchConsultCaseDocs(recordId: string): Promise<{ ok: true; docs: ConsultCaseDocs } | CasesFailed> {
  const { data, error } = await supabase.rpc("renewal_consult_case_documents", { p_record_id: recordId });
  if (error) return { ok: false, error: error.message, missing: isMissingFn(error) };
  const d = (data ?? {}) as Row;
  return {
    ok: true,
    docs: {
      requiredDocuments: ((d.required_documents ?? []) as Row[]).map(x => ({ kind: x.kind as DocKind, label: str(x.label), satisfied: !!x.satisfied, approved: x.approved == null ? undefined : !!x.approved })),
      documents: ((d.documents ?? []) as Row[]).map(x => ({ id: str(x.id), kind: x.kind as DocKind, fileName: str(x.file_name), status: str(x.status) as ConsultCaseDocument["status"], comment: strOrNull(x.comment), uploadedAt: str(x.uploaded_at), storagePath: str(x.storage_path) })),
    },
  };
}
export const ALLOW_RESUBMISSION_SQL = "supabase_migration_renewal_allow_resubmission.sql";
/** "Allow resubmission" on an APPROVED document: it counts as not approved and the scholar can upload a new file (the old one is deleted when they do). Consultation staff only. */
export async function allowResubmission(documentId: string): Promise<Done> {
  const { error } = await supabase.rpc("renewal_allow_resubmission", { p_document_id: documentId });
  if (error) return { ok: false, error: isMissingFn(error) ? `This needs the latest database update (${ALLOW_RESUBMISSION_SQL}). Ask the IT admin to run it.` : error.message };
  return { ok: true };
}
/** The terms that have open cases (newest first) and which one is the current term. */
export async function fetchConsultCaseTerms(): Promise<{ ok: true; terms: { schoolYear: string; term: string; label: string; openCount: number; isCurrent: boolean }[] } | CasesFailed> {
  const { data, error } = await supabase.rpc("renewal_consult_case_terms");
  if (error) return { ok: false, error: error.message, missing: isMissingFn(error) };
  return { ok: true, terms: ((data ?? []) as Row[]).map(r => ({ schoolYear: str(r.school_year), term: str(r.term), label: str(r.label), openCount: Number(r.open_count ?? 0), isCurrent: !!r.is_current })) };
}
/** How many cases are in each group (the numbers on the group buttons). */
export async function fetchConsultCaseCounts(q: Omit<CasesQuery, "group">): Promise<{ ok: true; ready: number; work: number; sent: number } | CasesFailed> {
  const { data, error } = await supabase.rpc("renewal_consult_case_counts", { p_school_year: q.schoolYear, p_term: q.term, p_search: q.search.trim() });
  if (error) return { ok: false, error: error.message, missing: isMissingFn(error) };
  const r = ((data ?? []) as Row[])[0] ?? {};
  return { ok: true, ready: Number(r.ready_count ?? 0), work: Number(r.work_count ?? 0), sent: Number(r.sent_count ?? 0) };
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
