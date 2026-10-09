// ─────────────────────────────────────────────────────────────
// src/school/bulkGradeLogic.ts
// Pure rules for the School Portal's bulk grade upload (no Supabase, no React), kept
// separate so tests/school-grades/run.mjs can exercise them directly.
//
// Flow: choose period -> download template -> upload -> VALIDATE EVERY ROW AND PREVIEW
// (nothing is saved yet) -> "Save valid rows" -> summary + error report.
// ─────────────────────────────────────────────────────────────
import { parseCsv, toCsv, normalizeHeader, findColumn, cell } from "@/sead/csvUtils";
import {
  periodKey, periodTitle, normalizeTerm, statusLabel,
  type PeriodRef, type PeriodStatus,
} from "@/lib/academicPeriods";
import type { GradingConfig, LetterGrade, SchoolScholarRow, SchoolSubjectGrade } from "./types";

export const TEMPLATE_HEADERS = ["school_year", "semester", "scholar_id", "scholar_name", "subject_code", "subject_name", "units", "grade"] as const;

const HEADER_ALIASES = {
  schoolYear: ["school_year", "school year", "schoolyear", "sy"],
  semester: ["semester", "term"],
  scholarId: ["scholar_id", "scholar id", "scholar id number", "scholar_id_number", "scholarid"],
  scholarName: ["scholar_name", "scholar name", "name"],
  subjectCode: ["subject_code", "subject code", "code"],
  subjectName: ["subject_name", "subject name", "subject"],
  units: ["units", "unit"],
  grade: ["grade"],
} as const;

export function scholarDisplayName(s: Pick<SchoolScholarRow, "lastName" | "firstName" | "middleName">): string {
  const mi = s.middleName.trim() ? `${s.middleName.trim()[0]}.` : "";
  return `${s.lastName}, ${[s.firstName, mi].filter(Boolean).join(" ")}`;
}

// ── Template ─────────────────────────────────────────────────
/**
 * One row per declared subject for every scholar of the school, in the chosen period, so the
 * school only has to type grades. A scholar with no subjects yet gets one row with blank subject
 * columns (to be filled in). Scholars are listed by name; matching on upload is by Scholar ID.
 */
export function buildTemplate(scholars: SchoolScholarRow[], existing: SchoolSubjectGrade[], period: PeriodRef): { headers: string[]; rows: (string | number)[][] } {
  const term = normalizeTerm(period.semester) ?? period.semester;
  const byScholar = new Map<string, SchoolSubjectGrade[]>();
  for (const g of existing) {
    const list = byScholar.get(g.scholarIdNumber);
    if (list) list.push(g); else byScholar.set(g.scholarIdNumber, [g]);
  }
  const sorted = [...scholars].sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
  const rows: (string | number)[][] = [];
  for (const s of sorted) {
    const subjects = byScholar.get(s.scholarIdNumber) ?? [];
    const name = scholarDisplayName(s);
    if (subjects.length === 0) {
      rows.push([period.schoolYear, term, s.scholarIdNumber, name, "", "", "", ""]);
    } else {
      for (const g of subjects) rows.push([period.schoolYear, term, s.scholarIdNumber, name, g.subjectCode, g.subject, g.units ?? "", g.grade]);
    }
  }
  return { headers: [...TEMPLATE_HEADERS], rows };
}

// ── Grade validation (mirrors _school_grade_error in the Phase 3 migration) ──
/** null when the grade is fine; blank is always fine ("declared, not graded yet"). */
export function validateGradeValue(grade: string, config: GradingConfig, letters: LetterGrade[]): string | null {
  const g = grade.trim();
  if (!g) return null;
  const range = `${config.scaleMin} to ${config.scaleMax}`;
  if (/^\d+(\.\d+)?$/.test(g)) {
    const n = Number(g);
    if (n >= config.scaleMin && n <= config.scaleMax) return null;
    return `Grade ${g} is outside your grading scale (${range}).`;
  }
  if (config.usesLetterGrades && letters.some(l => l.letter.trim().toLowerCase() === g.toLowerCase())) return null;
  if (/^\d+,\d+$/.test(g)) return `Grade "${g}" uses a comma — write it with a decimal point (for example ${g.replace(",", ".")}).`;
  return `Grade "${g}" is not on your grading scale (${range})${config.usesLetterGrades ? " or in your letter-grade table" : ""}.`;
}

// ── Parsing + validation ─────────────────────────────────────
export type RowStatus = "valid" | "warning" | "error";
export type RowAction = "add" | "update" | "unchanged";

export interface PayloadRow {
  id: string | null;
  scholarIdNumber: string;
  schoolYear: string;
  semester: string;
  subjectCode: string;
  subject: string;
  grade: string;
  units: number | null;
}

export interface PreviewRow {
  rowNumber: number;
  status: RowStatus;
  action: RowAction;
  /** Why it is an error, or what the school should know about a warning. */
  messages: string[];
  scholarId: string;
  scholarName: string;
  subjectCode: string;
  subject: string;
  units: string;
  grade: string;
  /** The cells exactly as they were in the file (for the error report). */
  raw: string[];
  /** What would be sent to the database; null for error rows. */
  payload: PayloadRow | null;
}

export interface UploadContext {
  period: PeriodRef;
  periodStatus: PeriodStatus | null;
  scholars: SchoolScholarRow[];
  /** Subject rows already saved for this school's scholars in this period. */
  existing: SchoolSubjectGrade[];
  config: GradingConfig | null;
  letters: LetterGrade[];
}

export interface ParseResult {
  /** Set when the WHOLE file is rejected (nothing to preview). */
  fileError?: string;
  headers: string[];
  rows: PreviewRow[];
  /** Rows with a scholar but nothing typed in code / subject / units / grade — the template's placeholder rows. They are ignored, not errors. */
  ignoredBlank: number;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

function nameTokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9ñ]+/).filter(t => t.length > 1);
}

/** True when the name typed in the file shares no word with the scholar on record — a hint the ID is wrong. */
function nameLooksDifferent(fileName: string, scholar: SchoolScholarRow): boolean {
  const typed = nameTokens(fileName);
  if (typed.length === 0) return false;
  const known = new Set([...nameTokens(scholar.firstName), ...nameTokens(scholar.lastName), ...nameTokens(scholar.middleName)]);
  return !typed.some(t => known.has(t));
}

export function parseGradeUpload(text: string, ctx: UploadContext): ParseResult {
  const fail = (fileError: string): ParseResult => ({ fileError, headers: [], rows: [], ignoredBlank: 0 });
  const title = periodTitle(ctx.period);

  if (ctx.periodStatus !== "open") {
    return fail(ctx.periodStatus
      ? `${title} is ${statusLabel(ctx.periodStatus)} — schools can only upload grades into an Open period.`
      : `${title} has not been set up by CEDO yet, so grades cannot be uploaded for it.`);
  }
  if (!ctx.config) return fail("Set up your grading scale in the Grading System tab before uploading grades.");

  const raw = parseCsv(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  if (raw.length === 0) return fail("The file is empty.");

  const headerCells = raw[0].map(h => h.trim());
  const headers = raw[0].map(normalizeHeader);
  const idx = {
    schoolYear: findColumn(headers, [...HEADER_ALIASES.schoolYear]),
    semester: findColumn(headers, [...HEADER_ALIASES.semester]),
    scholarId: findColumn(headers, [...HEADER_ALIASES.scholarId]),
    scholarName: findColumn(headers, [...HEADER_ALIASES.scholarName]),
    subjectCode: findColumn(headers, [...HEADER_ALIASES.subjectCode]),
    subjectName: findColumn(headers, [...HEADER_ALIASES.subjectName]),
    units: findColumn(headers, [...HEADER_ALIASES.units]),
    grade: findColumn(headers, [...HEADER_ALIASES.grade]),
  };
  const missing = ([["school_year", idx.schoolYear], ["semester", idx.semester], ["scholar_id", idx.scholarId], ["subject_name", idx.subjectName]] as const)
    .filter(([, i]) => i === -1).map(([name]) => name);
  if (missing.length > 0) return fail(`The file is missing required column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}. Download the template to get the right columns.`);

  const dataRows = raw.slice(1);
  if (dataRows.length === 0) return fail("The file has headers but no data rows.");

  // 1. The whole file must be for the period that was chosen.
  const wantedKey = periodKey(ctx.period.schoolYear, ctx.period.semester);
  const wrong: { rowNumber: number; year: string; term: string }[] = [];
  dataRows.forEach((r, i) => {
    const year = cell(r, idx.schoolYear);
    const term = cell(r, idx.semester);
    if (periodKey(year, term) !== wantedKey) wrong.push({ rowNumber: i + 2, year, term });
  });
  if (wrong.length > 0) {
    const first = wrong[0];
    const found = first.year || first.term ? `${first.year || "(blank)"} · ${first.term || "(blank)"}` : "no period";
    return fail(`This file does not match the period you chose (${title}). Row ${first.rowNumber} says ${found}${wrong.length > 1 ? `, and ${wrong.length - 1} other row${wrong.length === 2 ? "" : "s"} do not match either` : ""}. Nothing was checked. Choose the right period, or download a fresh template.`);
  }

  // Template placeholder rows (a scholar with no subjects yet, nothing typed) are skipped, not reported as errors.
  const entries = dataRows.map((r, i) => ({ r, rowNumber: i + 2 }));
  const filled = entries.filter(({ r }) => cell(r, idx.subjectCode) || cell(r, idx.subjectName) || cell(r, idx.units) || cell(r, idx.grade));
  const ignoredBlank = entries.length - filled.length;
  if (filled.length === 0) return fail("Nothing is filled in yet — type subjects and grades into the template (the rows for scholars with no subjects are placeholders), then upload it again.");

  // 2. Per-row checks.
  const scholarById = new Map(ctx.scholars.map(s => [s.scholarIdNumber, s]));
  const existingByScholar = new Map<string, SchoolSubjectGrade[]>();
  for (const g of ctx.existing) {
    const list = existingByScholar.get(g.scholarIdNumber);
    if (list) list.push(g); else existingByScholar.set(g.scholarIdNumber, [g]);
  }
  const findExisting = (scholarId: string, code: string, name: string): SchoolSubjectGrade | null => {
    const list = existingByScholar.get(scholarId) ?? [];
    if (code) {
      const byCode = list.find(g => norm(g.subjectCode) === norm(code));
      if (byCode) return byCode;
      return list.find(g => !g.subjectCode.trim() && norm(g.subject) === norm(name)) ?? null;
    }
    return list.find(g => norm(g.subject) === norm(name)) ?? null;
  };
  const dupKey = (scholarId: string, code: string, name: string) => `${scholarId}|${code ? `c:${norm(code)}` : `n:${norm(name)}`}`;

  const groups = new Map<string, number[]>();
  for (const { r, rowNumber } of filled) {
    const subject = cell(r, idx.subjectName);
    const scholarId = cell(r, idx.scholarId);
    if (!scholarId || !subject) continue;
    const key = dupKey(scholarId, cell(r, idx.subjectCode), subject);
    const list = groups.get(key);
    if (list) list.push(rowNumber); else groups.set(key, [rowNumber]);
  }

  const term = normalizeTerm(ctx.period.semester) ?? ctx.period.semester;
  const rows: PreviewRow[] = filled.map(({ r, rowNumber }) => {
    const scholarId = cell(r, idx.scholarId);
    const scholarName = cell(r, idx.scholarName);
    const code = cell(r, idx.subjectCode);
    const subject = cell(r, idx.subjectName);
    const unitsText = cell(r, idx.units);
    const grade = cell(r, idx.grade);
    const errors: string[] = [];
    const warnings: string[] = [];

    const scholar = scholarId ? scholarById.get(scholarId) : undefined;
    if (!scholarId) errors.push("Scholar ID is required.");
    else if (!scholar) errors.push(`Scholar ID ${scholarId} is not one of your school's scholars.`);
    if (!subject) errors.push("Subject name is required.");

    let units: number | null = null;
    if (unitsText) {
      if (/^\d+(\.\d+)?$/.test(unitsText) && Number(unitsText) > 0) units = Number(unitsText);
      else errors.push(`Units "${unitsText}" must be a positive number.`);
    }

    const gradeError = validateGradeValue(grade, ctx.config!, ctx.letters);
    if (gradeError) errors.push(gradeError);

    if (scholarId && subject) {
      const others = (groups.get(dupKey(scholarId, code, subject)) ?? []).filter(n => n !== rowNumber);
      if (others.length > 0) errors.push(`Duplicate: the same scholar and subject also appear in row${others.length === 1 ? "" : "s"} ${others.join(", ")}. Keep only one.`);
    }

    if (scholar && scholarName && nameLooksDifferent(scholarName, scholar)) {
      warnings.push(`Name in the file (${scholarName}) does not look like the scholar with ID ${scholarId} (${scholarDisplayName(scholar)}). Rows are matched by ID — check the ID is right.`);
    }

    const existing = scholar && subject ? findExisting(scholarId, code, subject) : null;
    let action: RowAction = "add";
    let effectiveGrade = grade;
    if (existing) {
      action = "update";
      if (!grade && existing.grade.trim()) {
        effectiveGrade = existing.grade;
        warnings.push(`Grade left blank — the existing grade (${existing.grade}) is kept.`);
      } else if (grade && existing.grade.trim() && grade !== existing.grade.trim()) {
        warnings.push(`Will overwrite the existing grade ${existing.grade} with ${grade}.`);
      }
      if (subject !== existing.subject) warnings.push(`Subject name will change from "${existing.subject}" to "${subject}".`);
      const sameCode = code === existing.subjectCode.trim() || (!code && !existing.subjectCode.trim());
      const sameUnits = units === null || units === existing.units;
      if (sameCode && subject === existing.subject && effectiveGrade.trim() === existing.grade.trim() && sameUnits) action = "unchanged";
    }

    const status: RowStatus = errors.length > 0 ? "error" : warnings.length > 0 ? "warning" : "valid";
    const payload: PayloadRow | null = status === "error" ? null : {
      id: existing?.id ?? null, scholarIdNumber: scholarId, schoolYear: ctx.period.schoolYear.trim(), semester: term,
      subjectCode: code, subject, grade: effectiveGrade.trim(), units,
    };
    return {
      rowNumber, status, action, messages: errors.length > 0 ? errors : warnings,
      scholarId, scholarName, subjectCode: code, subject, units: unitsText, grade, raw: r, payload,
    };
  });

  return { headers: headerCells, rows, ignoredBlank };
}

// ── Preview counts, save payload, summary, error report ──────
export interface PreviewCounts {
  valid: number;
  warning: number;
  error: number;
  unchanged: number;
  /** Rows that will actually be sent (valid + warning, minus unchanged). */
  toSave: number;
}

export function countRows(rows: PreviewRow[]): PreviewCounts {
  const c: PreviewCounts = { valid: 0, warning: 0, error: 0, unchanged: 0, toSave: 0 };
  for (const r of rows) {
    if (r.status === "error") { c.error++; continue; }
    if (r.action === "unchanged") { c.unchanged++; continue; }
    if (r.status === "warning") c.warning++; else c.valid++;
    c.toSave++;
  }
  return c;
}

/** Only rows without errors, and only ones that would actually change something. */
export function rowsToSave(rows: PreviewRow[]): PreviewRow[] {
  return rows.filter(r => r.status !== "error" && r.action !== "unchanged" && r.payload);
}

export interface SaveOutcome {
  /** The preview row that was sent. */
  row: PreviewRow;
  ok: boolean;
  error: string | null;
}

export function summaryText(saved: number, skipped: number, unchanged: number): string {
  const parts = [`${saved} saved`, `${skipped} skipped`];
  if (unchanged > 0) parts.push(`${unchanged} unchanged`);
  return parts.join(", ");
}

/** Everything that was NOT saved — validation errors and rows the database refused — as a CSV the school can fix and upload again. Null when nothing needs fixing. */
export function buildErrorReport(headers: string[], rows: PreviewRow[], outcomes: SaveOutcome[]): string | null {
  const problems: { rowNumber: number; reason: string; raw: string[] }[] = [];
  for (const r of rows) if (r.status === "error") problems.push({ rowNumber: r.rowNumber, reason: r.messages.join(" "), raw: r.raw });
  for (const o of outcomes) if (!o.ok) problems.push({ rowNumber: o.row.rowNumber, reason: `Not saved: ${o.error ?? "unknown error"}`, raw: o.row.raw });
  if (problems.length === 0) return null;
  problems.sort((a, b) => a.rowNumber - b.rowNumber);
  const width = headers.length;
  return toCsv(
    ["row_number", "problem", ...headers],
    problems.map(p => [p.rowNumber, p.reason, ...Array.from({ length: width }, (_, i) => p.raw[i] ?? "")]),
  );
}
