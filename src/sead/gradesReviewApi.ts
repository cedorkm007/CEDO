// ─────────────────────────────────────────────────────────────
// src/sead/gradesReviewApi.ts
// What CEDO staff (tag: scholars_grades_monitoring) do about school submissions: see each school's submission state
// next to its completion %, review correction requests, and reopen a submission. The database checks the tag on
// every call (see supabase_migration_submission_audit_documents.sql).
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";
import { toCorrection } from "@/school/submissionApi";
import type { CorrectionRequest, SubmissionState } from "@/school/submissionLogic";
import type { GradingPeriod } from "./scholarsGradesMonitoringApi";

type Done = { ok: true } | { ok: false; error: string };

export interface SubmissionOverviewRow {
  schoolId: string;
  /** null = the school has not submitted this period. */
  status: SubmissionState | null;
  submittedAt: string | null;
  pendingRequests: number;
}

/** Every school's submission state for one period. */
export async function fetchSubmissionOverview(period: GradingPeriod): Promise<{ ok: true; rows: SubmissionOverviewRow[] } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("grades_submission_overview", { p_school_year: period.schoolYear, p_semester: period.semester });
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: (data as Record<string, unknown>[] ?? []).map(r => ({
    schoolId: String(r.school_id), status: (r.status ?? null) as SubmissionState | null,
    submittedAt: r.submitted_at ? String(r.submitted_at) : null, pendingRequests: Number(r.pending_requests ?? 0),
  })) };
}

export interface StaffCorrection extends CorrectionRequest {
  schoolName: string;
  periodLabel: string;
}

/** All correction requests, newest first, with the school's name and the period. */
export async function fetchAllCorrections(): Promise<{ ok: true; rows: StaffCorrection[] } | { ok: false; error: string }> {
  const { data, error } = await supabase.from("grade_correction_requests")
    .select("*, schools(name), academic_periods(school_year, term)").order("requested_at", { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: (data ?? []).map(r => {
    const row = r as Record<string, unknown>;
    const school = row.schools as { name?: string } | null;
    const period = row.academic_periods as { school_year?: string; term?: string } | null;
    return { ...toCorrection(row), schoolName: school?.name ?? "(school)", periodLabel: period ? `${period.school_year} · ${period.term}` : "" };
  }) };
}

export async function reviewCorrection(requestId: string, approve: boolean, note: string): Promise<Done> {
  const { error } = await supabase.rpc("review_grade_correction", { p_request_id: requestId, p_approve: approve, p_note: note.trim() || null });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function reopenSubmission(schoolId: string, periodId: string, note: string): Promise<Done> {
  const { error } = await supabase.rpc("reopen_school_period", { p_school_id: schoolId, p_period_id: periodId, p_note: note.trim() });
  return error ? { ok: false, error: error.message } : { ok: true };
}
