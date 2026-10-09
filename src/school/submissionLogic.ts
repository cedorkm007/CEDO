// ─────────────────────────────────────────────────────────────
// src/school/submissionLogic.ts
// Pure rules for submitting a period and for correction requests (no Supabase, no React), so
// tests/school-grades/run.mjs can exercise them. The database enforces the same rules (see
// supabase_migration_submission_audit_documents.sql); these make the screens say so up front.
// ─────────────────────────────────────────────────────────────
import { validateGradeValue } from "./bulkGradeLogic";
import { periodProgressLabel, type PortalCounts } from "./portalLogic";
import type { GradingConfig, LetterGrade } from "./types";

export type SubmissionState = "submitted" | "reopened";

export interface Submission {
  id: string;
  periodId: string;
  status: SubmissionState;
  submittedAt: string | null;
  scholarsTotal: number | null;
  submitCount: number;
  reopenedAt: string | null;
  reopenNote: string | null;
}

export type CorrectionStatus = "pending" | "approved" | "rejected" | "applied" | "cancelled";

export interface CorrectionRequest {
  id: string;
  schoolId: string;
  periodId: string;
  gradeId: string | null;
  scholarIdNumber: string;
  subjectCode: string;
  subject: string;
  currentGrade: string | null;
  proposedGrade: string | null;
  reason: string;
  status: CorrectionStatus;
  requestedAt: string;
  reviewedByLabel: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  appliedAt: string | null;
}

export const CORRECTION_STATUS_LABEL: Record<CorrectionStatus, string> = {
  pending: "Waiting for CEDO",
  approved: "Approved — ready to change",
  rejected: "Rejected",
  applied: "Done",
  cancelled: "Cancelled",
};

export const MIN_REASON_LENGTH = 5;

/** A submitted period is locked; a reopened one is open for changes again. */
export function isLocked(submission: Pick<Submission, "status"> | null | undefined): boolean {
  return submission?.status === "submitted";
}

/** The status shown in the period bar: Submitted once submitted, otherwise how far along the school is. */
export function periodStatusLabel(submission: Pick<Submission, "status"> | null | undefined, counts: PortalCounts): string {
  if (isLocked(submission)) return "Submitted";
  const progress = periodProgressLabel(counts);
  return submission?.status === "reopened" && progress !== "Ready to submit" ? "Reopened by CEDO" : progress;
}

/** The first problem with a correction request, or null when it can be sent. A proposed grade is optional but, if given, must be on the school's scale. */
export function validateCorrectionRequest(reason: string, proposedGrade: string, config: GradingConfig | null, letters: LetterGrade[]): string | null {
  if (reason.trim().length < MIN_REASON_LENGTH) return `Please give a reason for the correction (at least ${MIN_REASON_LENGTH} characters).`;
  if (proposedGrade.trim() && config) return validateGradeValue(proposedGrade, config, letters);
  return null;
}

export interface GradeLockInfo {
  /** The period is submitted and still locked. */
  locked: boolean;
  /** Grade ids whose correction CEDO approved — editable once. */
  approvedGradeIds: ReadonlySet<string>;
  /** Grade ids with a correction request waiting for CEDO. */
  pendingGradeIds: ReadonlySet<string>;
}

export const NOT_LOCKED: GradeLockInfo = { locked: false, approvedGradeIds: new Set(), pendingGradeIds: new Set() };

export function buildLockInfo(submission: Pick<Submission, "status"> | null, corrections: Pick<CorrectionRequest, "gradeId" | "status" | "periodId">[], periodId: string | null): GradeLockInfo {
  const forPeriod = corrections.filter(c => !!c.gradeId && (periodId === null || c.periodId === periodId));
  return {
    locked: isLocked(submission),
    approvedGradeIds: new Set(forPeriod.filter(c => c.status === "approved").map(c => c.gradeId!)),
    pendingGradeIds: new Set(forPeriod.filter(c => c.status === "pending").map(c => c.gradeId!)),
  };
}

/** Whether one saved subject row can be edited right now. Rows not yet saved (new) are never locked; locked rows open only with an approved correction. */
export function canEditRow(row: { id: string; isNew?: boolean }, lock: GradeLockInfo): boolean {
  if (!lock.locked) return true;
  if (row.isNew) return false;
  return lock.approvedGradeIds.has(row.id);
}

/** Open requests (pending or approved) in the school's list — for the tab badge. */
export function openRequestCount(corrections: Pick<CorrectionRequest, "status">[]): number {
  return corrections.filter(c => c.status === "pending" || c.status === "approved").length;
}

export interface SubmitReadiness {
  ok: boolean;
  /** Why the Submit button is disabled (or null when it is enabled). */
  reason: string | null;
}

/** Everything that must be true before the Submit button is enabled in the screen. */
export function submitReadiness(args: {
  counts: PortalCounts; editable: boolean; gradingReady: boolean; locked: boolean; hasPeriod: boolean;
}): SubmitReadiness {
  if (args.locked) return { ok: false, reason: "These grades have already been submitted." };
  if (!args.hasPeriod) return { ok: false, reason: "Choose a grading period first." };
  if (!args.gradingReady) return { ok: false, reason: "Set up your grading scale first." };
  if (!args.editable) return { ok: false, reason: "Only an Open period can be submitted." };
  if (args.counts.total === 0) return { ok: false, reason: "There are no scholars to submit grades for." };
  if (args.counts.complete < args.counts.total) {
    const left = args.counts.total - args.counts.complete;
    return { ok: false, reason: `${left} scholar${left === 1 ? " is" : "s are"} not complete yet.` };
  }
  return { ok: true, reason: null };
}
