// ─────────────────────────────────────────────────────────────
// src/sead/enteredGradesApi.ts
// The staff side of grades the scholars enter during renewal (Scholar Renewal > Entered grades) and of the temporary grading setup of a school
// (Scholars' Grades Monitoring > Grading setup). Who may do what is decided by the database; the Grades Approver (a tag it.admin1 gives) approves, the evaluator can read.
// See supabase_migration_entered_grades_c_functions.sql. `missing: true` = that database update has not been run yet.
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";
import { RENEWAL_DOCUMENT_BUCKET, type SelfGradeDifference, type SelfGradeLine } from "@/lib/renewal";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));
const strOrNull = (v: unknown) => (v == null ? null : String(v));
const num = (v: unknown) => (v == null ? 0 : Number(v));
const isMissing = (e: { code?: string; message?: string }) => e.code === "PGRST202" || /could not find the function|does not exist/i.test(e.message ?? "");
type Failed = { ok: false; error: string; missing: boolean };
const failed = (e: { code?: string; message?: string }): Failed => ({ ok: false, error: e.message ?? "Something went wrong.", missing: isMissing(e) });

export const ENTERED_GRADES_PAGE_SIZE = 20;
export type EnteredGradesFilter = "pending" | "approved" | "returned" | "all";
export type EnteredGradesStatus = "pending" | "approved" | "returned";

export interface EnteredGradesRow {
  id: string; recordId: string; scholarIdNumber: string; name: string; school: string; program: string; yearLevel: string;
  schoolYear: string; term: string; basisSchoolYear: string; basisTerm: string; version: number; status: EnteredGradesStatus;
  submittedAt: string; decidedAt: string | null; decidedByLabel: string | null; decisionNote: string;
  lines: SelfGradeLine[]; files: { name: string; path: string; mime: string }[]; differences: SelfGradeDifference[] | null; officialCheckedAt: string | null;
  schoolSubmitted: boolean; gradingReady: boolean; previousCount: number; canDecide: boolean;
}

export async function fetchEnteredGrades(filter: EnteredGradesFilter, query: string, page: number): Promise<{ ok: true; rows: EnteredGradesRow[]; total: number } | Failed> {
  const { data, error } = await supabase.rpc("renewal_self_grades_list", { p_status: filter, p_query: query.trim() || null, p_limit: ENTERED_GRADES_PAGE_SIZE, p_offset: (page - 1) * ENTERED_GRADES_PAGE_SIZE });
  if (error) return failed(error);
  const list = (data ?? []) as Row[];
  return {
    ok: true, total: list.length ? num(list[0].total_rows) : 0,
    rows: list.map(r => ({
      id: str(r.id), recordId: str(r.record_id), scholarIdNumber: str(r.scholar_id_number), name: str(r.name), school: str(r.school), program: str(r.program), yearLevel: str(r.year_level),
      schoolYear: str(r.school_year), term: str(r.term), basisSchoolYear: str(r.basis_school_year), basisTerm: str(r.basis_term), version: num(r.version), status: str(r.status) as EnteredGradesStatus,
      submittedAt: str(r.submitted_at), decidedAt: strOrNull(r.decided_at), decidedByLabel: strOrNull(r.decided_by_label), decisionNote: str(r.decision_note),
      lines: ((r.lines ?? []) as Row[]).map(l => ({ code: str(l.code), subject: str(l.subject), units: num(l.units), grade: str(l.grade) })),
      files: ((r.files ?? []) as Row[]).map(f => ({ name: str(f.name), path: str(f.path), mime: str(f.mime) })),
      differences: (r.differences ?? null) as SelfGradeDifference[] | null, officialCheckedAt: strOrNull(r.official_checked_at),
      schoolSubmitted: !!r.school_submitted, gradingReady: !!r.grading_ready, previousCount: num(r.previous_count), canDecide: !!r.can_decide,
    })),
  };
}

export interface EnteredGradesCounts { pending: number; approved: number; returned: number; differing: number; canDecide: boolean }
export async function fetchEnteredGradesCounts(): Promise<{ ok: true; counts: EnteredGradesCounts } | Failed> {
  const { data, error } = await supabase.rpc("renewal_self_grades_counts");
  if (error) return failed(error);
  const r = (((data ?? []) as Row[])[0] ?? {}) as Row;
  return { ok: true, counts: { pending: num(r.pending), approved: num(r.approved), returned: num(r.returned), differing: num(r.differing), canDecide: !!r.can_decide } };
}

/** Approve or return. Returning needs a reason. Result: "approved", "approved_needs_setup" (approved, but the school's grading system has no passing mark yet) or "returned". */
export async function decideEnteredGrades(id: string, approve: boolean, note: string): Promise<{ ok: true; result: string } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("renewal_self_grades_decide", { p_submission_id: id, p_approve: approve, p_note: note });
  return error ? { ok: false, error: error.message } : { ok: true, result: str(data) };
}

/** A short-lived link to an image (the Grades Approver and renewal staff may open the scholars' images). */
export async function getEnteredGradeImageUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(RENEWAL_DOCUMENT_BUCKET).createSignedUrl(path, 300);
  return error || !data ? null : data.signedUrl;
}

// ── the temporary grading setup of a school ──────────────────────────────
export type MarkOutcome = "passed" | "failed" | "incomplete" | "review";
export const MARK_OUTCOME_LABEL: Record<MarkOutcome, string> = { passed: "Passed", failed: "Failed", incomplete: "Incomplete (like INC)", review: "Needs the evaluator's review" };
export interface GradingSetupSchool { schoolId: string; name: string; scholars: number; hasSetup: boolean; passingMark: number | null; setByStaff: boolean; letters: number; marks: number }
export interface GradingSetup {
  school: string;
  config: { scaleMin: number; scaleMax: number; direction: "lower_is_better" | "higher_is_better"; usesLetterGrades: boolean; passingMark: number | null; setByStaff: boolean; staffNote: string; staffSetAt: string | null } | null;
  letters: { letter: string; numericValue: string }[];
  marks: { mark: string; meaning: string; outcome: MarkOutcome }[];
}

export async function fetchGradingSetupSchools(): Promise<{ ok: true; schools: GradingSetupSchool[] } | Failed> {
  const { data, error } = await supabase.rpc("grading_setup_schools");
  if (error) return failed(error);
  return { ok: true, schools: ((data ?? []) as Row[]).map(r => ({ schoolId: str(r.school_id), name: str(r.name), scholars: num(r.scholars), hasSetup: !!r.has_setup, passingMark: r.passing_mark == null ? null : Number(r.passing_mark), setByStaff: !!r.set_by_staff, letters: num(r.letters), marks: num(r.marks) })) };
}

export async function fetchGradingSetup(schoolId: string): Promise<{ ok: true; setup: GradingSetup } | Failed> {
  const { data, error } = await supabase.rpc("grading_setup_get", { p_school_id: schoolId });
  if (error || !data) return error ? failed(error) : { ok: false, error: "Couldn't load the setup.", missing: false };
  const d = data as Row; const c = d.config as Row | null;
  return {
    ok: true,
    setup: {
      school: str(d.school),
      config: c ? { scaleMin: num(c.scale_min), scaleMax: num(c.scale_max), direction: str(c.direction) as "lower_is_better" | "higher_is_better", usesLetterGrades: !!c.uses_letter_grades, passingMark: c.passing_mark == null ? null : Number(c.passing_mark), setByStaff: !!c.set_by_staff, staffNote: str(c.staff_note), staffSetAt: strOrNull(c.staff_set_at) } : null,
      letters: ((d.letters ?? []) as Row[]).map(l => ({ letter: str(l.letter), numericValue: l.numeric_value == null ? "" : String(l.numeric_value) })),
      marks: ((d.marks ?? []) as Row[]).map(m => ({ mark: str(m.mark), meaning: str(m.meaning), outcome: str(m.outcome) as MarkOutcome })),
    },
  };
}

export async function saveGradingSetup(schoolId: string, setup: { scaleMin: string; scaleMax: string; direction: "lower_is_better" | "higher_is_better"; passingMark: string; usesLetterGrades: boolean; letters: { letter: string; numericValue: string }[]; marks: { mark: string; meaning: string; outcome: MarkOutcome }[]; note: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.rpc("grading_setup_save", {
    p_school_id: schoolId,
    p_config: { scale_min: setup.scaleMin.trim(), scale_max: setup.scaleMax.trim(), passing_mark: setup.passingMark.trim(), direction: setup.direction, uses_letter_grades: setup.usesLetterGrades },
    p_letters: setup.letters.filter(l => l.letter.trim()).map(l => ({ letter: l.letter.trim(), numeric_value: l.numericValue.trim() || null })),
    p_marks: setup.marks.filter(m => m.mark.trim()).map(m => ({ mark: m.mark.trim(), meaning: m.meaning.trim(), outcome: m.outcome })),
    p_note: setup.note,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}
