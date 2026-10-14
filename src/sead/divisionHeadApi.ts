// ─────────────────────────────────────────────────────────────
// src/sead/divisionHeadApi.ts
// The Division Head's side of Scholar Renewal: the list of cases, the information behind a renewal-linked referral, and the decisions
// (Approve Probationary / Removed / Reconsidered / send back). Who may do what is decided by the database
// (see supabase_migration_renewal_p5_approvals.sql); these calls just ask.
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";
import type { DivisionHeadCaseType, DivisionHeadDecision } from "@/lib/renewal";

export type Done = { ok: true } | { ok: false; error: string };
type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));
const strOrNull = (v: unknown) => (v == null ? null : String(v));
const num = (v: unknown) => (v == null ? 0 : Number(v));

export type DivisionHeadQueueState = "waiting" | "sent_back" | "decided";
export interface DivisionHeadCase {
  recordId: string; referralId: string; scholarIdNumber: string; scholarName: string; school: string; program: string; yearLevel: string;
  scholarStatus: string; termLabel: string; stage: string; ruleCode: string; caseType: DivisionHeadCaseType; state: DivisionHeadQueueState;
  decision: DivisionHeadDecision | null; decidedAt: string | null; failedCount: number; consultationDoneAt: string | null; noShowCount: number; sentAt: string;
}

export async function fetchDivisionHeadQueue(): Promise<{ ok: true; rows: DivisionHeadCase[] } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("renewal_division_head_queue");
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    rows: ((data ?? []) as Row[]).map(r => ({
      recordId: str(r.record_id), referralId: str(r.referral_id), scholarIdNumber: str(r.scholar_id_number), scholarName: str(r.scholar_name), school: str(r.school),
      program: str(r.program), yearLevel: str(r.year_level), scholarStatus: str(r.scholar_status), termLabel: str(r.term_label), stage: str(r.stage), ruleCode: str(r.rule_code),
      caseType: r.case_type as DivisionHeadCaseType, state: r.state as DivisionHeadQueueState, decision: (r.decision as DivisionHeadDecision | null) ?? null,
      decidedAt: strOrNull(r.decided_at), failedCount: num(r.failed_count), consultationDoneAt: strOrNull(r.consultation_done_at), noShowCount: num(r.no_show_count), sentAt: str(r.sent_at),
    })),
  };
}

export interface RenewalReferralInfo {
  recordId: string; stage: string; termLabel: string; basisLabel: string; caseType: DivisionHeadCaseType;
  ruleCode: string; ruleText: string; options: ("approve_probationary" | "removed" | "reconsidered" | "return")[];
  decided: DivisionHeadDecision | null; decidedAt: string | null; decisionNote: string | null;
  consultationDoneAt: string | null; counselor: string | null; noShowCount: number; evaluatorNote: string | null;
  failedSubjects: { code: string; subject: string; grade: string }[]; incSubjects: { code: string; subject: string }[];
  previousProbation: boolean; sentBackReason: string | null; referralStatus: string; myName: string;
}

/** What the Referral Form screen needs to know about the renewal behind a referral; null when the referral is an ordinary one. */
export async function fetchRenewalReferralInfo(referralId: string): Promise<RenewalReferralInfo | null> {
  const { data, error } = await supabase.rpc("renewal_referral_info", { p_referral_id: referralId });
  if (error || !data) return null;
  const d = data as Row;
  const subjects = (v: unknown) => ((v ?? []) as Row[]).map(s => ({ code: str(s.code), subject: str(s.subject), grade: str(s.grade) }));
  return {
    recordId: str(d.record_id), stage: str(d.stage), termLabel: str(d.term_label), basisLabel: str(d.basis_label), caseType: d.case_type as DivisionHeadCaseType,
    ruleCode: str(d.rule_code), ruleText: str(d.rule_text), options: ((d.options ?? []) as RenewalReferralInfo["options"]),
    decided: (d.decided as DivisionHeadDecision | null) ?? null, decidedAt: strOrNull(d.decided_at), decisionNote: strOrNull(d.decision_note),
    consultationDoneAt: strOrNull(d.consultation_done_at), counselor: strOrNull(d.counselor), noShowCount: num(d.no_show_count), evaluatorNote: strOrNull(d.evaluator_note),
    failedSubjects: subjects(d.failed_subjects), incSubjects: subjects(d.inc_subjects), previousProbation: !!d.previous_probation,
    sentBackReason: strOrNull(d.sent_back_reason), referralStatus: str(d.referral_status), myName: str(d.my_name),
  };
}

export async function decideRenewalCase(args: { recordId: string; decision: "approve_probationary" | "removed" | "reconsidered"; signaturePath: string; signatoryName: string; note: string }): Promise<Done> {
  const { error } = await supabase.rpc("renewal_division_head_decide", {
    p_record_id: args.recordId, p_decision: args.decision, p_signature_path: args.signaturePath, p_signatory_name: args.signatoryName, p_note: args.note,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function returnRenewalCaseToEvaluator(recordId: string, reason: string): Promise<Done> {
  const { error } = await supabase.rpc("renewal_division_head_return", { p_record_id: recordId, p_reason: reason });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** The evaluator sends a 2+ failed case to the Division Head by hand (or again after it was sent back). */
export async function sendToDivisionHead(recordId: string, note: string): Promise<Done> {
  const { error } = await supabase.rpc("renewal_send_to_division_head", { p_record_id: recordId, p_note: note });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** The evaluator confirms a case the Division Head reconsidered. */
export async function confirmReconsideredRenewal(recordId: string, note: string): Promise<Done> {
  const { error } = await supabase.rpc("renewal_confirm_reconsidered", { p_record_id: recordId, p_note: note });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export interface DivisionHeadStatus { sent: boolean; referralId: string | null; status: string | null; sentBackReason: string | null; sentAt: string | null; signatoryName: string | null }

export async function fetchDivisionHeadStatus(recordId: string): Promise<DivisionHeadStatus | null> {
  const { data, error } = await supabase.rpc("renewal_dh_status", { p_record_id: recordId });
  if (error || !data) return null;
  const d = data as Row;
  return { sent: !!d.sent, referralId: strOrNull(d.referral_id), status: strOrNull(d.status), sentBackReason: strOrNull(d.sent_back_reason), sentAt: strOrNull(d.sent_at), signatoryName: strOrNull(d.signatory_name) };
}
