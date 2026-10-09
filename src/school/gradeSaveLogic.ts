// ─────────────────────────────────────────────────────────────
// src/school/gradeSaveLogic.ts
// Pure (no Supabase, no React) rules for the School Portal's manual grade
// entry, kept separate so tests/school-grades/run.mjs can exercise them
// without a browser or a database.
// ─────────────────────────────────────────────────────────────
import { computeGwa, needsUnits, type LetterGrade } from "@/lib/gwa";
import type { SchoolSubjectGrade } from "./types";

export interface PeriodLike {
  schoolYear: string;
  semester: string;
}

/** "1st Semester 2026-2027" — the order used in the save confirmation. */
export function periodLabel(period: PeriodLike): string {
  return [period.semester, period.schoolYear].filter(Boolean).join(" ");
}

/** What the school typed for one row, after trimming. */
export interface EntryRowInput {
  id: string;
  subjectCode: string;
  subject: string;
  grade: string;
  /** What is typed in the Units box ("" = nothing). */
  unitsText?: string;
  /** True when this saved subject already has units stored — they can be changed but not cleared. */
  hadUnits?: boolean;
}

/**
 * Returns a message for the first problem that would otherwise make Save
 * silently drop or mangle a row, or null if the rows are fine. A completely
 * empty row (nothing typed in any box) is not a problem — it is ignored.
 */
export function validateEntryRows(rows: EntryRowInput[]): string | null {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const units = (r.unitsText ?? "").trim();
    const hasAnything = r.subjectCode.trim() || r.subject.trim() || r.grade.trim() || units;
    if (hasAnything && !r.subject.trim()) {
      return `Row ${i + 1} needs a Subject Name before it can be saved.`;
    }
    if (units && !(/^[0-9]+([.][0-9]+)?$/.test(units) && Number(units) > 0)) {
      return `Row ${i + 1}: units must be a positive number (for example 3 or 1.5).`;
    }
    if (!units && r.hadUnits && r.subject.trim()) {
      return `Row ${i + 1}: units can't be cleared once set — enter a number.`;
    }
  }
  return null;
}

/** One row the save step wrote (or tried to write), with the id the database gave back. */
export interface SavedRow {
  id: string;
  subject: string;
  grade: string;
  /** When given, the read-back must show these units / this flag too. */
  units?: number | null;
  excludeFromGwa?: boolean;
}

/**
 * Read-back check: every row we just saved must come back from the database
 * with the same id and the same grade. Returns the subjects that did not —
 * an empty array means the save is confirmed. This is what catches a "0 rows
 * changed but success shown" outcome instead of trusting the write's reply.
 */
export function findUnconfirmed(saved: SavedRow[], fetched: SchoolSubjectGrade[]): string[] {
  const byId = new Map(fetched.map(f => [f.id, f]));
  const missing: string[] = [];
  for (const s of saved) {
    const found = byId.get(s.id);
    const gradeDiffers = !found || found.grade.trim() !== s.grade.trim();
    const unitsDiffers = !!found && s.units != null && found.units !== s.units;
    const excludeDiffers = !!found && s.excludeFromGwa !== undefined && found.excludeFromGwa !== s.excludeFromGwa;
    if (gradeDiffers || unitsDiffers || excludeDiffers) missing.push(s.subject || "(unnamed subject)");
  }
  return missing;
}

/** The confirmation line shown after a verified save. */
export function savedMessage(saved: SavedRow[], removedCount: number, period: PeriodLike): string {
  const label = periodLabel(period);
  const parts: string[] = [];
  if (saved.length === 1) {
    const g = saved[0].grade.trim();
    parts.push(g ? `Saved: ${g} · ${label}` : `Saved: ${saved[0].subject} (no grade yet) · ${label}`);
  } else if (saved.length > 1) {
    parts.push(`Saved ${saved.length} subjects · ${label}`);
  }
  if (removedCount > 0) {
    const removed = `${removedCount} subject${removedCount === 1 ? "" : "s"} removed`;
    parts.push(saved.length === 0 ? `${removed} · ${label}` : removed);
  }
  return parts.join(" · ");
}

export interface ScholarGradeSummary {
  subjects: number;
  graded: number;
  gwa: number | null;
  /** Subjects that count toward the GWA but have no units yet (counted as 1 unit) — the school should fill these in. */
  missingUnits: number;
}

type SummaryRow = Pick<SchoolSubjectGrade, "grade"> & Partial<Pick<SchoolSubjectGrade, "units" | "excludeFromGwa">>;

/** Subjects declared, how many have a grade, the units-weighted GWA (src/lib/gwa.ts, the same calculation staff and scholars see), and how many subjects still need units, for one scholar's rows in one period. */
export function summarizeScholarGrades(rows: SummaryRow[], letterGrades: LetterGrade[]): ScholarGradeSummary {
  return {
    subjects: rows.length,
    graded: rows.filter(r => r.grade.trim() !== "").length,
    gwa: computeGwa(rows, letterGrades),
    missingUnits: rows.filter(r => needsUnits(r)).length,
  };
}

/** Groups one flat list of grade rows by scholar id, so the table can look each scholar up in O(1). */
export function groupByScholar(rows: SchoolSubjectGrade[]): Map<string, SchoolSubjectGrade[]> {
  const map = new Map<string, SchoolSubjectGrade[]>();
  for (const r of rows) {
    const list = map.get(r.scholarIdNumber);
    if (list) list.push(r);
    else map.set(r.scholarIdNumber, [r]);
  }
  return map;
}
