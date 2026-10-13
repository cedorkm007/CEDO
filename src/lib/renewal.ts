// ─────────────────────────────────────────────────────────────
// src/lib/renewal.ts
// Plain helpers shared by the scholar's Renewal tile and the staff "Scholar Renewal" tool: the stages a renewal moves through, how
// each is worded, which documents exist, and a few date helpers. No Supabase / React imports so tests can run it alone.
// The RULES themselves are NOT here — they live in the database (_renewal_evaluate); this file only words the database's answer.
// ─────────────────────────────────────────────────────────────

export const RENEWAL_TERMS = ["1st Semester", "2nd Semester", "Summer"] as const;
export type RenewalTerm = (typeof RENEWAL_TERMS)[number];

/** Every stage a renewal record can be in (must match the check list in supabase_migration_renewal_p2_application.sql). */
export const RENEWAL_STAGES = [
  "submitted", "late_pending", "late_declined", "sdp_on_hold", "waiting_grades", "review_needed", "ready_for_confirmation",
  "ready_to_endorse", "endorsed_division_head", "needs_study_plan_consultation", "needs_consultation_division_head", "needs_inc_letter_consultation",
  "inc_waiting_compliance", "inc_deadline_passed", "summer_requirements",
  "returned", "renewed", "removed", "reconsidered", "not_required",
] as const;
export type RenewalStage = (typeof RENEWAL_STAGES)[number];

export type StageTone = "neutral" | "info" | "warning" | "danger" | "success";

export const STAGE_INFO: Record<RenewalStage, { title: string; tone: StageTone; short: string }> = {
  submitted: { title: "Application submitted", tone: "info", short: "Submitted" },
  late_pending: { title: "Late — needs evaluator acceptance", tone: "warning", short: "Late — needs acceptance" },
  late_declined: { title: "Late application declined", tone: "danger", short: "Late declined" },
  sdp_on_hold: { title: "On hold — SDP not complied", tone: "warning", short: "SDP on hold" },
  waiting_grades: { title: "Waiting for grades", tone: "warning", short: "Waiting for grades" },
  review_needed: { title: "Needs evaluator review", tone: "warning", short: "Needs review" },
  ready_for_confirmation: { title: "Ready for evaluator confirmation", tone: "success", short: "Ready to confirm" },
  ready_to_endorse: { title: "Ready to endorse to the Division Head", tone: "success", short: "Ready to endorse" },
  endorsed_division_head: { title: "Endorsed — waiting for the Division Head", tone: "info", short: "With the Division Head" },
  needs_study_plan_consultation: { title: "Needs study plan and consultation", tone: "info", short: "Study plan + consultation" },
  needs_consultation_division_head: { title: "Needs consultation and Division Head decision", tone: "danger", short: "Consultation + Division Head" },
  needs_inc_letter_consultation: { title: "Needs INC letter and consultation", tone: "info", short: "INC letter + consultation" },
  inc_waiting_compliance: { title: "Temporary probation — waiting for INC compliance", tone: "info", short: "Waiting for INC" },
  inc_deadline_passed: { title: "INC deadline passed — decision needed", tone: "danger", short: "INC deadline passed" },
  summer_requirements: { title: "Summer: prospectus and consultation needed", tone: "info", short: "Summer requirements" },
  returned: { title: "Returned with comments", tone: "warning", short: "Returned" },
  renewed: { title: "Renewed", tone: "success", short: "Renewed" },
  removed: { title: "Removed", tone: "danger", short: "Removed" },
  reconsidered: { title: "Reconsidered", tone: "neutral", short: "Reconsidered" },
  not_required: { title: "Not required this term", tone: "neutral", short: "Not required" },
};

export function stageTitle(stage: string): string {
  return (STAGE_INFO as Record<string, { title: string }>)[stage]?.title ?? stage;
}

/** Stages whose application is still open (the evaluator can return it; the rules may still move it). */
export const ACTIVE_STAGES: readonly RenewalStage[] = [
  "submitted", "sdp_on_hold", "waiting_grades", "review_needed", "ready_for_confirmation", "ready_to_endorse", "needs_study_plan_consultation",
  "needs_consultation_division_head", "needs_inc_letter_consultation", "inc_waiting_compliance", "inc_deadline_passed", "summer_requirements",
];
export const CLOSED_STAGES: readonly RenewalStage[] = ["renewed", "removed", "reconsidered", "late_declined", "not_required"];
export const isActiveStage = (stage: string): boolean => (ACTIVE_STAGES as readonly string[]).includes(stage);
export const isClosedStage = (stage: string): boolean => (CLOSED_STAGES as readonly string[]).includes(stage);

/** The groups the evaluator's board filters by (a stage can sit in one group). */
export const BOARD_GROUPS: { key: string; label: string; stages: readonly RenewalStage[] }[] = [
  { key: "to_confirm", label: "Ready for the evaluator", stages: ["ready_for_confirmation", "ready_to_endorse"] },
  { key: "late", label: "Late — needs acceptance", stages: ["late_pending"] },
  { key: "on_hold", label: "On hold / waiting", stages: ["sdp_on_hold", "waiting_grades", "review_needed"] },
  { key: "consult", label: "Needs documents + consultation", stages: ["needs_study_plan_consultation", "needs_inc_letter_consultation", "summer_requirements", "submitted"] },
  { key: "dh", label: "Division Head decision", stages: ["needs_consultation_division_head", "endorsed_division_head"] },
  { key: "inc", label: "INC", stages: ["inc_waiting_compliance", "inc_deadline_passed"] },
  { key: "returned", label: "Returned", stages: ["returned"] },
  { key: "done", label: "Done", stages: ["renewed", "removed", "reconsidered", "late_declined", "not_required"] },
];

export type DocKind = "study_plan" | "inc_letter" | "prospectus";
export const DOC_LABEL: Record<DocKind, string> = {
  study_plan: "Study plan",
  inc_letter: "INC letter from your dean",
  prospectus: "Prospectus",
};
export const DOC_ACCEPT = ".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp";
export const DOC_MAX_BYTES = 10 * 1024 * 1024;
export const DOC_MAX_PER_KIND = 3;
const DOC_MIMES = [
  "application/pdf", "image/jpeg", "image/png", "image/webp", "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

/** A friendly problem with a file before uploading it, or null when it is fine. Mirrors the database's own checks. */
export function validateRenewalFile(file: { name: string; type: string; size: number }, existingOfKind: number): string | null {
  if (!DOC_MIMES.includes(file.type)) return "Please upload a PDF, Word, JPG, PNG or WebP file.";
  if (file.size > DOC_MAX_BYTES) return "That file is over 10 MB. Please upload a smaller one.";
  if (file.size === 0) return "That file is empty.";
  if (existingOfKind >= DOC_MAX_PER_KIND) return `You can upload at most ${DOC_MAX_PER_KIND} files of this kind. Remove one first.`;
  return null;
}

/** <scholar id>/<record id>/<kind>/<uuid>-<safe file name> — the folder the storage rules and the database guard expect. */
export function renewalDocumentPath(scholarIdNumber: string, recordId: string, kind: DocKind, fileName: string, uniqueId: string): string {
  // Keep a plain extension, make the rest of the name safe (no slashes, no "..", no odd characters).
  const ext = /\.[A-Za-z0-9]{1,5}$/.exec(fileName)?.[0].toLowerCase() ?? "";
  const stem = (ext ? fileName.slice(0, -ext.length) : fileName).normalize("NFKD").replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 70) || "file";
  return `${scholarIdNumber}/${recordId}/${kind}/${uniqueId}-${stem}${ext}`;
}
export const RENEWAL_DOCUMENT_BUCKET = "renewal-documents";

// ── Dates (the office works in Philippine time) ──
const MANILA = "Asia/Manila";
export function manilaToday(now: Date = new Date()): string {
  // Built from parts (not a locale's own format) so it is the same on every device.
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: MANILA, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
/** "Oct 13, 2026" from an ISO date or timestamp. */
export function formatDay(value: string | null | undefined): string {
  if (!value) return "—";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00+08:00`) : new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric", timeZone: MANILA });
}
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-PH", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: MANILA });
}
/** Whole days from today (Philippine time) to an ISO date; negative when it has passed. */
export function daysUntil(isoDate: string | null | undefined, now: Date = new Date()): number | null {
  if (!isoDate) return null;
  const a = Date.parse(`${manilaToday(now)}T00:00:00Z`), b = Date.parse(`${isoDate.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(a) || Number.isNaN(b) ? null : Math.round((b - a) / 86400000);
}
export function daysLeftText(days: number | null): string {
  if (days === null) return "Deadline: to be set at consultation";
  if (days < 0) return `${-days} day${days === -1 ? "" : "s"} past the deadline`;
  if (days === 0) return "Due today";
  return `${days} day${days === 1 ? "" : "s"} left`;
}

export type WindowState = "upcoming" | "open" | "late" | "closed";
export function windowState(opensOn: string, closesOn: string, lateAllowed: boolean, now: Date = new Date()): WindowState {
  const today = manilaToday(now);
  if (today < opensOn) return "upcoming";
  if (today <= closesOn) return "open";
  return lateAllowed ? "late" : "closed";
}

export function termLabelOf(schoolYear: string, term: string): string {
  return `${term === "Summer" ? "Summer" : term} ${schoolYear}`;
}

/** The semester judged for a renewal of (year, term) — mirrors _renewal_basis() in the database; shown to people only. */
export function renewalBasis(schoolYear: string, term: string): { schoolYear: string; term: string } | null {
  const m = /^(\d{4})-(\d{4})$/.exec(schoolYear);
  if (!m) return null;
  if (term === "1st Semester") return { schoolYear: `${Number(m[1]) - 1}-${Number(m[2]) - 1}`, term: "2nd Semester" };
  if (term === "2nd Semester") return { schoolYear, term: "1st Semester" };
  if (term === "Summer") return { schoolYear, term: "2nd Semester" };
  return null;
}

// ── What the database's evaluation looks like (only the parts the screens read) ──
export interface RenewalSubjectFlag { code: string; subject: string; grade: string | null; outcome?: string; state?: string; deadline?: string | null; item_id?: string | null }
export interface RenewalEvaluation {
  basis_school_year?: string; basis_term?: string;
  sdp?: { applicable: boolean; complied: boolean | null; missing: string | null; community_service?: number; community_volunteerism?: number; formation_program?: number };
  grades?: {
    state: "ready" | "waiting" | "no_grades" | "review"; school_submitted: boolean; reason: string;
    counts: { total: number; passed: number; failed: number; drp: number; inc: number; review: number; ungraded: number };
    failed_subjects: RenewalSubjectFlag[]; inc_subjects: RenewalSubjectFlag[]; review_subjects: RenewalSubjectFlag[];
  };
  previous_probation?: boolean; failed_effective?: number; open_inc?: number;
  rule_code?: string | null; rule_text?: string | null; stage?: RenewalStage; reason?: string;
  required_documents?: { kind: DocKind; label: string; satisfied: boolean }[];
  consultation_required?: boolean; consultation_done?: boolean;
  error?: string;
}

/** Plain, encouraging next steps for the scholar, in order. The database decided the case; this only words it. */
export function scholarNextSteps(stage: RenewalStage, ev: RenewalEvaluation | null | undefined, opts: { incDeadlines?: { subject: string; deadline: string | null }[]; evaluatorComment?: string | null } = {}): string[] {
  const steps: string[] = [];
  const missingDocs = (ev?.required_documents ?? []).filter(d => !d.satisfied);
  const upload = () => { for (const d of missingDocs) steps.push(`Upload your ${d.label.toLowerCase().startsWith("inc") ? "INC letter from your dean" : d.label.split(" (")[0].toLowerCase()}.`); };
  switch (stage) {
    case "late_pending": steps.push("Your late application is waiting for the evaluator to accept it. You don't need to do anything yet."); break;
    case "late_declined": steps.push("Your late application was declined. Please contact the CEDO office if you have questions."); break;
    case "sdp_on_hold": steps.push(`Complete your SDP credits: ${ev?.sdp?.missing ?? "some credits are missing"}. We will check again automatically when new credits are recorded.`); break;
    case "waiting_grades": steps.push(ev?.grades?.reason || "We are waiting for your school to submit your grades. We will check again automatically."); break;
    case "review_needed": steps.push("The evaluator is reviewing your case. You don't need to do anything right now."); break;
    case "submitted": steps.push("We are checking your SDP and grades."); break;
    case "ready_for_confirmation": steps.push("Waiting for the evaluator to confirm your renewal."); break;
    case "ready_to_endorse": steps.push("Waiting for the evaluator to review your case and send it to the Division Head for approval."); break;
    case "endorsed_division_head": steps.push("The evaluator sent your case to the Division Head for approval. We will tell you the result."); break;
    case "needs_study_plan_consultation": upload(); steps.push("Book your face-to-face consultation (online booking opens in the next update — for now please visit the CEDO office)."); break;
    case "needs_consultation_division_head": steps.push("A consultation with CEDO is needed, then the Division Head will decide your case. (Online booking opens in the next update — for now please visit the CEDO office.)"); break;
    case "needs_inc_letter_consultation": upload(); steps.push("Visit the CEDO office for your consultation, where staff will set the days you have to complete your INC."); break;
    case "inc_waiting_compliance":
      for (const i of opts.incDeadlines ?? []) steps.push(`Complete your INC in ${i.subject} by ${formatDay(i.deadline)} — ${daysLeftText(daysUntil(i.deadline))}.`);
      if (!(opts.incDeadlines ?? []).length) steps.push("Complete your INC by the deadline that is set at your consultation.");
      upload(); break;
    case "inc_deadline_passed": steps.push("Your INC deadline has passed. The evaluator will decide what happens next."); break;
    case "summer_requirements": upload(); steps.push("Bring the hard copy of your prospectus to your face-to-face consultation."); break;
    case "returned": steps.push(opts.evaluatorComment ? `The evaluator asked: ${opts.evaluatorComment}` : "The evaluator returned your application with comments."); steps.push("Fix what was asked and press “Submit again”."); break;
    case "renewed": steps.push("You are renewed. Your Certificate of Scholarship Renewal will be available here once certificates are switched on."); break;
    case "removed": steps.push("Please contact the CEDO office."); break;
    case "reconsidered": steps.push("Your case is being reconsidered by the Division Head."); break;
    case "not_required": steps.push("You do not need to renew this term."); break;
  }
  return steps;
}
