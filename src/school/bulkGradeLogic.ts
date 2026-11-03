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
  periodKey, periodTitle, normalizeTerm, statusLabel, termLabel,
  type PeriodRef, type PeriodStatus,
} from "@/lib/academicPeriods";
import { classifyGrade, reservedMark } from "@/lib/subjectOutcome";
import { looksLikePromoReport, readPromoReport, type PromoEntry } from "./promoReport";
import type { GradingConfig, LetterGrade, SchoolScholarRow, SchoolSubjectGrade } from "./types";

/** `remarks` is optional: a file without that column still uploads, and leaves every stored remark as it is. */
export const TEMPLATE_HEADERS = ["school_year", "semester", "scholar_id", "scholar_name", "subject_code", "subject_name", "units", "grade", "remarks"] as const;

export const MAX_REMARKS_LENGTH = 200;

const HEADER_ALIASES = {
  schoolYear: ["school_year", "school year", "schoolyear", "sy"],
  semester: ["semester", "term"],
  scholarId: ["scholar_id", "scholar id", "scholar id number", "scholar_id_number", "scholarid"],
  scholarName: ["scholar_name", "scholar name", "name"],
  subjectCode: ["subject_code", "subject code", "code"],
  subjectName: ["subject_name", "subject name", "subject"],
  units: ["units", "unit"],
  grade: ["grade"],
  remarks: ["remarks", "remark", "tag", "tags"],
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
      rows.push([period.schoolYear, term, s.scholarIdNumber, name, "", "", "", "", ""]);
    } else {
      for (const g of subjects) rows.push([period.schoolYear, term, s.scholarIdNumber, name, g.subjectCode, g.subject, g.units ?? "", g.grade, g.remarks ?? ""]);
    }
  }
  return { headers: [...TEMPLATE_HEADERS], rows };
}

// ── Grade validation (mirrors _school_grade_error in the Phase 3 migration) ──
/** null when the grade is fine; blank is always fine ("declared, not graded yet"). */
export function validateGradeValue(grade: string, config: GradingConfig, letters: LetterGrade[]): string | null {
  const g = grade.trim();
  if (!g) return null;
  // INC and DRP are reserved marks every school may enter (mirrors _school_grade_error in the Phase 1 renewal migration).
  if (reservedMark(g)) return null;
  const range = `${config.scaleMin} to ${config.scaleMax}`;
  if (/^\d+(\.\d+)?$/.test(g)) {
    const n = Number(g);
    if (n >= config.scaleMin && n <= config.scaleMax) return null;
    return `Grade ${g} is outside your grading scale (${range}).`;
  }
  if (letters.some(l => (config.usesLetterGrades || l.outcome) && l.letter.trim().toLowerCase() === g.toLowerCase())) return null;
  if (/^\d+,\d+$/.test(g)) return `Grade "${g}" uses a comma — write it with a decimal point (for example ${g.replace(",", ".")}).`;
  return `Grade "${g}" is not on your grading scale (${range})${config.usesLetterGrades ? " or in your letter-grade table" : ""}${letters.some(l => l.outcome) ? " or in your list of other marks" : ""}.`;
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
  /** Only set when the file has a remarks column; null leaves the stored remark as it is. */
  remarks: string | null;
}

export interface PreviewRow {
  rowNumber: number;
  status: RowStatus;
  action: RowAction;
  /** Why it is an error, or what the school should know about a warning. */
  messages: string[];
  scholarId: string;
  scholarName: string;
  /** The school's own number for the scholar, when the file is the promotional report. */
  studentNo?: string;
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

/** A Student No. the system does not know yet, matched to a scholar of the school by name. Saved only after the school confirms it. */
export interface ProposedLink { scholarIdNumber: string; studentNo: string; scholarName: string }

export interface ParseResult {
  /** Set when the WHOLE file is rejected (nothing to preview). */
  fileError?: string;
  headers: string[];
  rows: PreviewRow[];
  /** Rows with a scholar but nothing typed in code / subject / units / grade — the template's placeholder rows. They are ignored, not errors. */
  ignoredBlank: number;
  /** Student Nos. to link to scholars (the promotional report only); the school confirms them before the grades are saved. */
  links: ProposedLink[];
  /** csv = the earlier CSV layout; promo = the promotional report / enrollment list. */
  format: "csv" | "promo";
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

/** One row of an upload in the shape the checks work on, whichever file layout it came from. */
interface InputRow {
  rowNumber: number;
  scholarId: string;
  scholarName: string;
  /** The school's own number for the scholar (the promotional report), when the file has one. */
  studentNo?: string;
  code: string;
  subject: string;
  unitsText: string;
  grade: string;
  remarksText: string;
  raw: string[];
  /** Problems found before the grade checks (a Student No. that is nobody's) and notes (a Student No. that will be linked to a scholar). */
  preErrors?: string[];
  preWarnings?: string[];
}
/** none = the file has no remarks column (stored remarks stay); set = the file's remark is saved, blank clears it; setIfFilled = a filled remark is saved, a blank one leaves the stored remark (and the remark is compared with the grade). */
type RemarkMode = "none" | "set" | "setIfFilled";

/** The word the promotional report uses for each result, to compare with the REMARKS column. */
const REMARK_WORDS: Record<string, string[]> = {
  passed: ["PASSED", "PASS"], failed: ["FAILED", "FAIL"], drp: ["DROPPED", "DRP", "DROP"], inc: ["INCOMPLETE", "INC"],
};
const REMARK_RESULT_TEXT: Record<string, string> = { passed: "a pass", failed: "a fail", drp: "dropped (DRP)", inc: "incomplete (INC)" };

/** A warning when the REMARKS word (PASSED, FAILED, DROPPED, INCOMPLETE) says something other than the grade does. Other remarks (NSTP, Cross-enrolled …) are just information. */
function remarkDisagreesWithGrade(remark: string, grade: string, config: GradingConfig, letters: LetterGrade[]): string | null {
  const word = remark.trim().toUpperCase();
  if (!word || !grade.trim()) return null;
  const said = Object.keys(REMARK_WORDS).find(k => REMARK_WORDS[k].includes(word));
  if (!said) return null;
  const outcome = classifyGrade(grade, config, letters);
  if (!(outcome in REMARK_WORDS)) return null;      // ungraded, needs review, no passing mark set: nothing to compare with
  if (outcome === said) return null;
  return `The remark says ${remark.trim()}, but the grade ${grade.trim()} is ${REMARK_RESULT_TEXT[outcome]} on your grading scale. Check the grade or the remark.`;
}

function checkRows(inputs: InputRow[], ctx: UploadContext, headers: string[], ignoredBlank: number, remarkMode: RemarkMode, format: ParseResult["format"]): ParseResult {
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
  for (const inp of inputs) {
    if (!inp.scholarId || !inp.subject) continue;
    const key = dupKey(inp.scholarId, inp.code, inp.subject);
    const list = groups.get(key);
    if (list) list.push(inp.rowNumber); else groups.set(key, [inp.rowNumber]);
  }

  const term = normalizeTerm(ctx.period.semester) ?? ctx.period.semester;
  const rows: PreviewRow[] = inputs.map(inp => {
    const { rowNumber, scholarId, scholarName, code, subject, unitsText, grade, remarksText, raw } = inp;
    const errors: string[] = [...(inp.preErrors ?? [])];
    const warnings: string[] = [...(inp.preWarnings ?? [])];

    const scholar = scholarId ? scholarById.get(scholarId) : undefined;
    if (!inp.preErrors?.length) {
      if (!scholarId) errors.push("Scholar ID is required.");
      else if (!scholar) errors.push(`Scholar ID ${scholarId} is not one of your school's scholars.`);
    }
    if (!subject) errors.push("Subject name is required.");

    let units: number | null = null;
    if (unitsText) {
      if (/^\d+(\.\d+)?$/.test(unitsText) && Number(unitsText) > 0) units = Number(unitsText);
      else errors.push(`Units "${unitsText}" must be a positive number.`);
    }

    const gradeError = validateGradeValue(grade, ctx.config!, ctx.letters);
    if (gradeError) errors.push(gradeError);
    if (remarksText.length > MAX_REMARKS_LENGTH) errors.push(`Remarks are too long (${remarksText.length} characters; the limit is ${MAX_REMARKS_LENGTH}).`);
    if (remarkMode === "setIfFilled" && !gradeError) {
      const disagree = remarkDisagreesWithGrade(remarksText, grade, ctx.config!, ctx.letters);
      if (disagree) warnings.push(disagree);
    }

    if (scholarId && subject) {
      const others = (groups.get(dupKey(scholarId, code, subject)) ?? []).filter(n => n !== rowNumber);
      if (others.length > 0) errors.push(`Duplicate: the same scholar and subject also appear in row${others.length === 1 ? "" : "s"} ${others.join(", ")}. Keep only one.`);
    }

    if (scholar && scholarName && nameLooksDifferent(scholarName, scholar)) {
      warnings.push(`Name in the file (${scholarName}) does not look like the scholar with ${inp.studentNo !== undefined ? `Student No. ${inp.studentNo}` : `ID ${scholarId}`} (${scholarDisplayName(scholar)}). Rows are matched by ${inp.studentNo !== undefined ? "Student No." : "ID"} — check it is right.`);
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
      const sameRemarks = remarkMode === "none" || (remarkMode === "setIfFilled" && remarksText === "") || remarksText === (existing.remarks ?? "").trim();
      if (sameCode && subject === existing.subject && effectiveGrade.trim() === existing.grade.trim() && sameUnits && sameRemarks) action = "unchanged";
    }

    const status: RowStatus = errors.length > 0 ? "error" : warnings.length > 0 ? "warning" : "valid";
    const payload: PayloadRow | null = status === "error" ? null : {
      id: existing?.id ?? null, scholarIdNumber: scholarId, schoolYear: ctx.period.schoolYear.trim(), semester: term,
      subjectCode: code, subject, grade: effectiveGrade.trim(), units, remarks: remarkMode === "none" ? null : remarkMode === "setIfFilled" ? (remarksText || null) : remarksText,
    };
    return {
      rowNumber, status, action, messages: errors.length > 0 ? errors : warnings,
      scholarId, scholarName, studentNo: inp.studentNo, subjectCode: code, subject, units: unitsText, grade, raw, payload,
    };
  });

  return { headers, rows, ignoredBlank, links: [], format };
}

/** The checks every upload starts with. */
function startChecks(ctx: UploadContext): string | null {
  const title = periodTitle(ctx.period);
  if (ctx.periodStatus !== "open") {
    return ctx.periodStatus
      ? `${title} is ${statusLabel(ctx.periodStatus)} — schools can only upload grades into an Open period.`
      : `${title} has not been set up by CEDO yet, so grades cannot be uploaded for it.`;
  }
  if (!ctx.config) return "Set up your grading scale in the Grading System tab before uploading grades.";
  return null;
}
const failResult = (fileError: string): ParseResult => ({ fileError, headers: [], rows: [], ignoredBlank: 0, links: [], format: "csv" });

/** A CSV in the earlier layout (school_year, semester, scholar_id, scholar_name, subject_code, subject_name, units, grade, remarks), already split into cells. */
export function parseGradeGrid(raw: string[][], ctx: UploadContext): ParseResult {
  const fail = failResult;
  const title = periodTitle(ctx.period);
  const early = startChecks(ctx);
  if (early) return fail(early);

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
    remarks: findColumn(headers, [...HEADER_ALIASES.remarks]),
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
  const filled = entries.filter(({ r }) => cell(r, idx.subjectCode) || cell(r, idx.subjectName) || cell(r, idx.units) || cell(r, idx.grade) || (idx.remarks !== -1 && cell(r, idx.remarks)));
  const ignoredBlank = entries.length - filled.length;
  if (filled.length === 0) return fail("Nothing is filled in yet — type subjects and grades into the template (the rows for scholars with no subjects are placeholders), then upload it again.");

  const inputs: InputRow[] = filled.map(({ r, rowNumber }) => ({
    rowNumber, scholarId: cell(r, idx.scholarId), scholarName: cell(r, idx.scholarName), code: cell(r, idx.subjectCode), subject: cell(r, idx.subjectName),
    unitsText: cell(r, idx.units), grade: cell(r, idx.grade), remarksText: idx.remarks === -1 ? "" : cell(r, idx.remarks), raw: r,
  }));
  return checkRows(inputs, ctx, headerCells, ignoredBlank, idx.remarks === -1 ? "none" : "set", "csv");
}

export function parseGradeUpload(text: string, ctx: UploadContext): ParseResult {
  return parseGradeGrid(parseCsv(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text), ctx);
}

// ── The school's promotional report / enrollment list ────────
/** Names compared without capitals, accents or punctuation: "DE LA CRUZ" and "De la Cruz" are the same. */
const nameKey = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9ñ]+/g, " ").trim();
/** A Student No. compared without capitals or spaces. */
export const studentNoKey = (s: string) => s.toLowerCase().replace(/\s+/g, "");
const initialOf = (s: string) => nameKey(s).charAt(0);

/** True when a scholar on record is the person named on the sheet: the same last and first name, and the same first letter of the middle name when both have one. */
function sameName(e: { last: string; first: string; middle: string }, s: SchoolScholarRow): boolean {
  if (!e.last.trim() || !e.first.trim()) return false;
  if (nameKey(e.last) !== nameKey(s.lastName) || nameKey(e.first) !== nameKey(s.firstName)) return false;
  return !e.middle.trim() || !s.middleName.trim() || initialOf(e.middle) === initialOf(s.middleName);
}

/**
 * A promotional report / enrollment list (the grid read from the Excel sheet or from a CSV saved from it).
 * The period comes from the top of the sheet. Each student is found by STUDENT NO.; a Student No. the system does not know yet is matched to a scholar
 * of the school by name (exactly one without a School ID), and shown as a link the school must confirm before anything is saved.
 */
export function parsePromoUpload(grid: string[][], ctx: UploadContext): ParseResult {
  const early = startChecks(ctx);
  if (early) return { ...failResult(early), format: "promo" };
  const fail = (msg: string): ParseResult => ({ ...failResult(msg), format: "promo" });
  const title = periodTitle(ctx.period);

  const sheet = readPromoReport(grid);
  if ("error" in sheet) return fail(sheet.error);
  if (!sheet.schoolYear || !sheet.semester) {
    return fail(`The sheet does not say its school year and semester at the top (for example "SY ${ctx.period.schoolYear}" and "FIRST SEMESTER"). Nothing was checked. Download a fresh template for ${title}.`);
  }
  if (periodKey(sheet.schoolYear, sheet.semester) !== periodKey(ctx.period.schoolYear, ctx.period.semester)) {
    return fail(`This file does not match the period you chose (${title}). It says SY ${sheet.schoolYear} · ${sheet.semester}. Nothing was checked. Choose the right period, or download a fresh template.`);
  }
  if (sheet.entries.length === 0) return fail("Nothing is filled in yet — type the students' subjects and grades into the template, then upload it again.");

  // who is each student?
  const byNo = new Map<string, SchoolScholarRow>();
  for (const s of ctx.scholars) if (s.schoolStudentNo.trim()) byNo.set(studentNoKey(s.schoolStudentNo), s);
  const claimed = new Set<string>();          // scholars already taken by a link proposed in this file
  type Who = { scholarId: string; error?: string; warning?: string };
  const resolved = new Map<string, Who>();
  const links: ProposedLink[] = [];
  const whoIs = (e: PromoEntry): Who => {
    const display = [e.last, e.first, e.middle].map(x => x.trim()).filter(Boolean).join(", ").replace(/, ([^,]*), /, ", $1 ");
    const key = e.studentNo.trim() ? `no:${studentNoKey(e.studentNo)}` : `blank:${nameKey(`${e.last} ${e.first}`)}:${e.rowNumber}`;
    const known = resolved.get(key);
    if (known) return known;
    let who: Who;
    if (!e.studentNo.trim()) {
      who = { scholarId: "", error: "STUDENT NO. is required — type the student's number from your school." };
    } else {
      const hit = byNo.get(studentNoKey(e.studentNo));
      if (hit) who = { scholarId: hit.scholarIdNumber };
      else {
        const sameNamed = ctx.scholars.filter(s => sameName(e, s));
        const free = sameNamed.filter(s => !s.schoolStudentNo.trim() && !claimed.has(s.scholarIdNumber));
        if (free.length === 1) {
          const s = free[0];
          claimed.add(s.scholarIdNumber);
          links.push({ scholarIdNumber: s.scholarIdNumber, studentNo: e.studentNo.trim(), scholarName: scholarDisplayName(s) });
          who = { scholarId: s.scholarIdNumber, warning: `New: Student No. ${e.studentNo.trim()} will be linked to ${scholarDisplayName(s)} (${s.scholarIdNumber}). Please confirm the link below.` };
        } else if (free.length > 1) {
          who = { scholarId: "", error: `Student No. ${e.studentNo.trim()} is not linked to a scholar yet, and ${display || "this name"} fits more than one scholar of your school without a School ID. Type the School ID in the Scholars list, then upload again.` };
        } else if (sameNamed.some(s => s.schoolStudentNo.trim())) {
          const other = sameNamed.find(s => s.schoolStudentNo.trim())!;
          who = { scholarId: "", error: `${scholarDisplayName(other)} already has the School ID ${other.schoolStudentNo} in the system, not ${e.studentNo.trim()}. If ${e.studentNo.trim()} is right, change it in the Scholars list, then upload again.` };
        } else {
          who = { scholarId: "", error: `Student No. ${e.studentNo.trim()} is not linked to one of your scholars yet, and ${display || "the name"} does not match any scholar of your school without a School ID. Type the School ID in the Scholars list, then upload again.` };
        }
      }
    }
    resolved.set(key, who);
    return who;
  };

  const inputs: InputRow[] = sheet.entries.map(e => {
    const who = whoIs(e);
    return {
      rowNumber: e.rowNumber, scholarId: who.scholarId, studentNo: e.studentNo, code: e.code, subject: e.description, unitsText: e.units, grade: e.grade, remarksText: e.remarks, raw: e.cells,
      scholarName: [`${e.last},`, e.first, e.middle, e.ext].map(x => x.trim()).filter(x => x && x !== ",").join(" "),
      preErrors: who.error ? [who.error] : undefined, preWarnings: who.warning ? [who.warning] : undefined,
    };
  });
  const result = checkRows(inputs, ctx, sheet.headers, sheet.ignoredBlank, "setIfFilled", "promo");
  // a link is only worth confirming when at least one of the student's rows can be saved
  result.links = links.filter(l => result.rows.some(r => r.payload?.scholarIdNumber === l.scholarIdNumber));
  return result;
}

/** Whichever layout the file is in: the promotional report, or the earlier CSV. */
export function parseUploadedGrid(grid: string[][], ctx: UploadContext): ParseResult {
  return looksLikePromoReport(grid) ? parsePromoUpload(grid, ctx) : parseGradeGrid(grid, ctx);
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

/** The error report for either layout. For the promotional report it starts with the school year and semester, so the corrected file can be uploaded again as it is. */
export function buildUploadErrorReport(parsed: ParseResult, period: PeriodRef, outcomes: SaveOutcome[]): string | null {
  const csv = buildErrorReport(parsed.headers, parsed.rows, outcomes);
  if (!csv || parsed.format !== "promo") return csv;
  const term = normalizeTerm(period.semester);
  const quote = (t: string) => `"${t.replace(/"/g, '""')}"`;
  return `${quote(`SY ${period.schoolYear}`)}\r\n${quote((term ? termLabel(term) : period.semester).toUpperCase())}\r\n\r\n${csv}`;
}
