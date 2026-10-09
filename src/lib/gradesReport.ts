// ─────────────────────────────────────────────────────────────
// src/lib/gradesReport.ts
// The numbers behind CEDO's Excel export: completion, submission status and GWA by school, program and period. Pure (no
// Supabase, no React) so it can be tested; src/sead/gradesExport.ts loads the data and writes the file.
//
// Every figure uses the SAME shared rules as the screens: the units-weighted GWA (src/lib/gwa.ts), the strict "complete"
// rule (every declared subject graded), and scholarship standing (src/lib/standing.ts).
// ─────────────────────────────────────────────────────────────
import { gwaDetail, type GradeLike, type LetterGrade } from "./gwa";
import { scholarStanding, STANDING_LABEL, type StandingConfig, type StandingResult } from "./standing";

export interface ReportScholar {
  scholarIdNumber: string;
  name: string;
  schoolId: string;
  schoolName: string;
  program: string;
  yearLevel: string;
}

export interface ReportPeriod { key: string; label: string }

export interface ReportSchoolSetup {
  config: StandingConfig | null;
  letters: LetterGrade[];
}

export interface ReportSubmission {
  status: "submitted" | "reopened" | null;
  submittedAt: string | null;
  pendingRequests: number;
}

export type CompletionStatus = "Not set up" | "Not graded" | "Complete";

export interface ScholarReportRow {
  scholar: ReportScholar;
  period: ReportPeriod;
  subjects: number;
  graded: number;
  completion: CompletionStatus;
  gwa: number | null;
  standing: StandingResult;
}

/** One row per scholar per period: how many subjects, how many graded, the weighted GWA and the standing. */
export function buildScholarRows(
  scholars: ReportScholar[],
  periods: ReportPeriod[],
  gradesFor: (periodKey: string, scholarId: string) => GradeLike[],
  setupFor: (schoolId: string) => ReportSchoolSetup,
): ScholarReportRow[] {
  const rows: ScholarReportRow[] = [];
  for (const period of periods) {
    for (const scholar of scholars) {
      const grades = gradesFor(period.key, scholar.scholarIdNumber);
      const setup = setupFor(scholar.schoolId);
      const subjects = grades.length;
      const graded = grades.filter(g => g.grade.trim() !== "").length;
      const completion: CompletionStatus = subjects === 0 ? "Not set up" : graded < subjects ? "Not graded" : "Complete";
      const gwa = gwaDetail(grades, setup.letters).gwa;
      rows.push({ scholar, period, subjects, graded, completion, gwa, standing: scholarStanding(gwa, setup.config) });
    }
  }
  return rows;
}

export interface GroupRow {
  schoolId: string;
  schoolName: string;
  /** Only for program-level groups. */
  program?: string;
  period: ReportPeriod;
  scholars: number;
  complete: number;
  notGraded: number;
  notSetUp: number;
  percentComplete: number;
  /** Mean of the GWAs of scholars who have one (null when none do). */
  averageGwa: number | null;
  good: number;
  atRisk: number;
  below: number;
  submission: string;
  submittedAt: string | null;
  pendingRequests: number;
}

function summarize(rows: ScholarReportRow[]) {
  let complete = 0, notGraded = 0, notSetUp = 0, good = 0, atRisk = 0, below = 0, gwaSum = 0, gwaN = 0;
  for (const r of rows) {
    if (r.completion === "Complete") complete++; else if (r.completion === "Not graded") notGraded++; else notSetUp++;
    if (r.standing === "good") good++; else if (r.standing === "at_risk") atRisk++; else if (r.standing === "below") below++;
    if (r.gwa !== null) { gwaSum += r.gwa; gwaN++; }
  }
  return {
    scholars: rows.length, complete, notGraded, notSetUp, good, atRisk, below,
    percentComplete: rows.length === 0 ? 0 : Math.round((1000 * complete) / rows.length) / 10,
    averageGwa: gwaN === 0 ? null : gwaSum / gwaN,
  };
}

export function submissionLabel(s: ReportSubmission | undefined): string {
  return s?.status === "submitted" ? "Submitted" : s?.status === "reopened" ? "Reopened by CEDO" : "Not submitted";
}

/** Rows grouped by school (and period), or by school + program (and period). Sorted by school, program, then newest period first as given. */
export function aggregateRows(
  rows: ScholarReportRow[],
  level: "school" | "program",
  submissionFor: (schoolId: string, periodKey: string) => ReportSubmission | undefined,
): GroupRow[] {
  const groups = new Map<string, ScholarReportRow[]>();
  for (const r of rows) {
    const key = level === "school" ? `${r.scholar.schoolId}|${r.period.key}` : `${r.scholar.schoolId}|${r.scholar.program}|${r.period.key}`;
    const list = groups.get(key);
    if (list) list.push(r); else groups.set(key, [r]);
  }
  const out: GroupRow[] = [];
  for (const list of groups.values()) {
    const first = list[0];
    const sub = submissionFor(first.scholar.schoolId, first.period.key);
    out.push({
      schoolId: first.scholar.schoolId, schoolName: first.scholar.schoolName,
      program: level === "program" ? first.scholar.program : undefined,
      period: first.period, ...summarize(list),
      submission: submissionLabel(sub), submittedAt: sub?.submittedAt ?? null, pendingRequests: sub?.pendingRequests ?? 0,
    });
  }
  const periodOrder = new Map<string, number>();
  rows.forEach(r => { if (!periodOrder.has(r.period.key)) periodOrder.set(r.period.key, periodOrder.size); });
  return out.sort((a, b) =>
    a.schoolName.localeCompare(b.schoolName) || (a.program ?? "").localeCompare(b.program ?? "") ||
    (periodOrder.get(a.period.key) ?? 0) - (periodOrder.get(b.period.key) ?? 0));
}

// ── Sheets for the Excel file ───────────────────────────────
export type Cell = string | number | null;
export interface ReportSheet { name: string; headers: string[]; rows: Cell[][] }

const gwaCell = (v: number | null): Cell => (v === null ? null : Math.round(v * 100) / 100);

export function buildReportSheets(rows: ScholarReportRow[], bySchool: GroupRow[], byProgram: GroupRow[], includePeriodColumn: boolean): ReportSheet[] {
  const per = (g: GroupRow): Cell[] => (includePeriodColumn ? [g.period.label] : []);
  const perHead = includePeriodColumn ? ["Period"] : [];
  return [
    {
      name: "By school",
      headers: ["School", ...perHead, "Scholars", "Complete", "Declared, not graded", "Not set up", "% complete", "Submission", "Submitted on", "Open correction requests", "Average GWA", "Good standing", "At risk", "Below requirement"],
      rows: bySchool.map(g => [g.schoolName, ...per(g), g.scholars, g.complete, g.notGraded, g.notSetUp, g.percentComplete, g.submission, g.submittedAt ? g.submittedAt.slice(0, 10) : null, g.pendingRequests, gwaCell(g.averageGwa), g.good, g.atRisk, g.below]),
    },
    {
      name: "By program",
      headers: ["School", "Program", ...perHead, "Scholars", "Complete", "Declared, not graded", "Not set up", "% complete", "Average GWA", "Good standing", "At risk", "Below requirement"],
      rows: byProgram.map(g => [g.schoolName, g.program ?? "", ...per(g), g.scholars, g.complete, g.notGraded, g.notSetUp, g.percentComplete, gwaCell(g.averageGwa), g.good, g.atRisk, g.below]),
    },
    {
      name: "Scholars",
      headers: ["School", "Program", "Year level", "Scholar ID", "Name", ...perHead, "Subjects", "Graded", "Status", "GWA", "Standing"],
      rows: rows.map(r => [r.scholar.schoolName, r.scholar.program, r.scholar.yearLevel, r.scholar.scholarIdNumber, r.scholar.name, ...(includePeriodColumn ? [r.period.label] : []), r.subjects, r.graded, r.completion, gwaCell(r.gwa), STANDING_LABEL[r.standing]]),
    },
  ];
}
