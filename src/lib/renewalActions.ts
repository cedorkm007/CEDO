// ─────────────────────────────────────────────────────────────
// src/lib/renewalActions.ts
// Scholar Renewal > Scholar List: the "Action needed" and "Renewal status" columns. Plain helpers (no Supabase / React) so tests can run them alone.
// The database says where each scholar stands (renewal_scholar_actions, with the saved check of the list); these functions only say, in words, what is waiting and who may do it.
// Nothing here decides anything: a button only opens the screen where the person with the right role decides, and the database checks the role again.
// ─────────────────────────────────────────────────────────────
import { formatSlotShort, gradesStatusText, referralStatusText, sdpStatusText, STAGE_INFO, type RenewalStage } from "./renewal";

/** The staff who act on a renewal. Each action belongs to exactly one of them. */
export type StaffRole = "evaluator" | "grades_approver" | "sdp_approver" | "documents_approver" | "division_head" | "consultation_staff";
export const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  evaluator: "Scholar Renewal Evaluator", grades_approver: "Grades Approver", sdp_approver: "SDP Reconsideration Approver", documents_approver: "Renewal Documents Approver", division_head: "Division Head", consultation_staff: "Consultation staff",
};
export type ViewerRoles = { evaluator: boolean; gradesApprover: boolean; sdpApprover: boolean; documentsApprover?: boolean; divisionHead: boolean; consultationStaff?: boolean };
export const NO_ROLES: ViewerRoles = { evaluator: false, gradesApprover: false, sdpApprover: false, documentsApprover: false, divisionHead: false };
export const hasRole = (v: ViewerRoles, r: StaffRole): boolean => (r === "evaluator" ? v.evaluator : r === "grades_approver" ? v.gradesApprover : r === "sdp_approver" ? v.sdpApprover : r === "documents_approver" ? !!v.documentsApprover : r === "consultation_staff" ? !!v.consultationStaff : v.divisionHead);

/** What a button does: open the entered grades, the SDP reconsideration request or the Division Head's case of the scholar; start a consultation referral; or open the application. */
export type ActionKey = "approve_grades" | "decide_sdp" | "decide_case" | "refer_consultation" | "refer_booking" | "open_application" | "decide_inc" | "mark_not_required" | "review_documents" | "endorse_status";
export interface NeededAction { key: ActionKey; role: StaffRole; label: string }

/** Where one scholar stands for the term, as renewal_scholar_actions() reports it (null for a scholar it did not report). */
export interface ScholarActionFacts {
  recordId: string | null; stage: string | null; isLate: boolean; appliedAt: string | null; docsToReview: number;
  consultationRequired: boolean; consultationDoneAt: string | null; nextConsultation: string | null;
  /** school (the school uploaded) | approved | pending | returned (the scholar's own entered grades) | none */
  gradesStatus: string; dhReferralId: string | null; dhStatus: string | null; referralStatus: string | null;
}
/** The part of a Scholar List row these helpers read. */
export interface ActionRowInput {
  eligibility: readonly string[]; sdpReconsideration: string | null; sdpApplicable: boolean; sdpComplied: boolean | null; sdpMissing: string | null;
  gradesState: string | null; failed: number; drp: number; inc: number; review: number;
}

const EVALUATOR_STAGE_ACTION: Partial<Record<RenewalStage, string>> = {
  late_pending: "Decide the late application", ready_for_confirmation: "Confirm the renewal", reconsidered: "Confirm the renewal", division_head_approved: "Confirm the renewal",
  ready_to_endorse: "Endorse to the Division Head", endorsed_for_approval: "Approve the endorsement", review_needed: "Review the application", inc_deadline_passed: "Decide on the INC",
};

/** Everything waiting on staff for this scholar, in the order it should be done. Empty = nothing for staff to do (the scholar, the school or the clock moves it). */
export function neededActions(row: ActionRowInput, facts: ScholarActionFacts | null): NeededAction[] {
  if (!facts) return [];
  const out: NeededAction[] = [];
  if (facts.gradesStatus === "pending") out.push({ key: "approve_grades", role: "grades_approver", label: "Approve the entered grades" });
  if (row.sdpReconsideration === "pending") out.push({ key: "decide_sdp", role: "sdp_approver", label: "Decide the SDP reconsideration" });
  if (facts.dhStatus === "forwarded_to_division_head" && facts.dhReferralId) out.push({ key: "decide_case", role: "division_head", label: "Decide the case" });
  if (!facts.recordId) {
    if (row.eligibility.includes("consultation") && !facts.referralStatus) out.push({ key: "refer_consultation", role: "evaluator", label: "Refer for consultation" });
    return out;
  }
  const stage = facts.stage as RenewalStage | null;
  const byStage = stage ? EVALUATOR_STAGE_ACTION[stage] : undefined;
  if (byStage) out.push({ key: stage === "inc_deadline_passed" ? "decide_inc" : "open_application", role: "evaluator", label: byStage });
  if (stage === "needs_consultation_division_head" && facts.dhStatus !== "forwarded_to_division_head") out.push({ key: "open_application", role: "evaluator", label: "Send to the Division Head" });
  if (stage === "ready_for_endorsement") out.push({ key: "endorse_status", role: "consultation_staff", label: "Endorse the new scholarship status" });
  if (facts.docsToReview > 0) out.push({ key: "review_documents", role: "consultation_staff", label: `Review ${facts.docsToReview} document${facts.docsToReview === 1 ? "" : "s"}` });
  return out;
}

/** The words shown to someone who may NOT click: who the action is waiting for. */
export const waitingForText = (a: NeededAction): string => `Waiting for the ${STAFF_ROLE_LABEL[a.role]}`;
/** Only the staff assigned to the action can click it. */
export const canDoAction = (a: NeededAction, v: ViewerRoles): boolean => hasRole(v, a.role);

export type SummaryTone = "good" | "bad" | "warn" | "plain";
const TONE_OF_STAGE: Record<string, SummaryTone> = { success: "good", danger: "bad", warning: "warn", info: "plain", neutral: "plain" };

/** The grades, in one phrase: where they came from, and how they turned out. */
function gradesPhrase(row: ActionRowInput, facts: ScholarActionFacts | null): string {
  const source = facts?.gradesStatus;
  const result = row.gradesState === "ready" ? gradesStatusText({ state: row.gradesState, failed: row.failed + row.drp, inc: row.inc, review: row.review }).text : "";
  const head = source === "school" ? "Grades uploaded by the school" : source === "approved" ? "Entered grades approved" : source === "pending" ? "Entered grades waiting for approval"
    : source === "returned" ? "Entered grades returned to the scholar" : row.gradesState === "review" ? "Grades need review" : row.gradesState === "no_grades" ? "No grades recorded" : "Grades not in yet";
  return result && (source === "school" || source === "approved" || source == null) ? `${head}: ${result}` : head;
}

/** One line for the Renewal status column: how far the renewal is, then the SDP, the grades and the consultation in a few words. */
export function renewalSummary(row: ActionRowInput, facts: ScholarActionFacts | null): { headline: string; tone: SummaryTone; details: string[] } {
  let headline: string, tone: SummaryTone;
  if (!facts) { headline = "—"; tone = "plain"; }
  else if (!facts.recordId) { headline = "Has not applied yet"; tone = "plain"; }
  else {
    const info = STAGE_INFO[facts.stage as RenewalStage];
    headline = facts.stage === "renewed" ? "Renewed" : facts.stage === "removed" ? "Removed" : info ? `Applied: ${info.short}` : "Applied";
    tone = info ? TONE_OF_STAGE[info.tone] ?? "plain" : "plain";
    if (facts.isLate && facts.stage !== "late_pending" && facts.stage !== "late_declined") headline += " (late)";
  }
  const details: string[] = [];
  if (row.sdpApplicable) {
    const s = sdpStatusText({ applicable: row.sdpApplicable, complied: row.sdpComplied, missing: row.sdpMissing });
    const r = row.sdpReconsideration;
    details.push(r === "pending" ? "SDP reconsideration requested" : r === "approved" && row.sdpComplied === true ? "SDP complied by reconsideration" : r === "denied" ? "SDP reconsideration not approved"
      : s.tone === "good" ? "SDP complied" : s.tone === "bad" ? "SDP not complied" : "SDP not checked");
  }
  details.push(gradesPhrase(row, facts));
  if (facts) {
    const referral = referralStatusText(facts.referralStatus);
    if (facts.nextConsultation) details.push(`Consultation ${formatSlotShort(facts.nextConsultation)}`);
    else if (facts.consultationDoneAt) details.push("Consultation done");
    else if (referral) details.push(referral);
    else if (facts.consultationRequired) details.push("Consultation not booked yet");
    else if (!facts.recordId && row.eligibility.includes("consultation")) details.push("Needs a consultation referral");
  }
  return { headline, tone, details };
}

/**
 * "Refer for Consultation" on an APPLICATION of a scholar with an INC, a DRP or a failed subject: the evaluator books the scholar's renewal consultation (day, morning or afternoon, staff) FOR the scholar.
 * Offered while the application is not finished and no consultation is booked. An optional action: it is not part of what neededActions() says is waiting on staff.
 */
export function canReferForConsultation(row: Pick<ActionRowInput, "failed" | "drp" | "inc">, facts: ScholarActionFacts | null): boolean {
  if (!facts || !facts.recordId) return false;
  if (!(row.failed > 0 || row.drp > 0 || row.inc > 0)) return false;
  if (facts.nextConsultation) return false;      // an upcoming consultation is already booked (a consultation that was already done does not stop a new referral)
  return !["renewed", "removed", "late_declined", "late_pending", "returned", "ready_for_endorsement", "endorsed_for_approval"].includes(facts.stage ?? "");
}
export const REFER_BOOKING_ACTION: NeededAction = { key: "refer_booking", role: "evaluator", label: "Refer for Consultation" };
