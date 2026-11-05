// ─────────────────────────────────────────────────────────────
// src/school/promoReport.ts
// The School Portal's grade template is the schools' own "PROMOTIONAL REPORT / ENROLLMENT LIST" (an Excel sheet):
//   rows 1-11  the title, "SY 2022-2023", "FIRST SEMESTER", the school's name and the signature lines
//   a heading row with PROGRAM NAME, PROGRAM MAJOR, STUDENT NO., YEAR LEVEL, LAST NAME, FIRST NAME, MIDDLE NAME, EXT. NAME, SEX, NATIONALITY, COURSE CODE, COURSE DESCRIPTION, NO. OF UNITS, GRADES, REMARKS
//   one block of rows per student: the student's details on the first row only, then one row per subject
//   a "SUMMARY OF STUDENTS PER PROGRAM" at the bottom
// This file reads that sheet (from an .xlsx or a CSV saved from it) and builds it (pre-filled with a school's scholars, or blank). No Supabase / React.
// The checks on the rows (the grade scale, duplicates, the period) are in bulkGradeLogic.ts.
// ─────────────────────────────────────────────────────────────
import { normalizeTerm, termLabel, type PeriodRef } from "@/lib/academicPeriods";
import type { XlsxCell, XlsxSheet } from "@/lib/xlsxLite";
import type { SchoolScholarRow, SchoolSubjectGrade } from "./types";

export const PROMO_COLUMNS = [
  "PROGRAM NAME", "PROGRAM MAJOR", "STUDENT NO.", "YEAR LEVEL", "LAST NAME", "FIRST NAME", "MIDDLE NAME", "EXT. NAME", "SEX", "NATIONALITY",
  "COURSE CODE", "COURSE DESCRIPTION", "NO. OF UNITS", "GRADES", "REMARKS",
] as const;

type Field = "program" | "major" | "studentNo" | "yearLevel" | "last" | "first" | "middle" | "ext" | "sex" | "nationality" | "code" | "description" | "units" | "grade" | "remarks";
const FIELD_ORDER: Field[] = ["program", "major", "studentNo", "yearLevel", "last", "first", "middle", "ext", "sex", "nationality", "code", "description", "units", "grade", "remarks"];
/** Spellings of each heading, after the text is made lower case with punctuation turned into single spaces. */
const ALIASES: Record<Field, string[]> = {
  program: ["program name", "program", "course program"],
  major: ["program major", "major"],
  studentNo: ["student no", "student number", "student id", "student id no", "school id", "school id no", "school id number"],
  yearLevel: ["year level", "year"],
  last: ["last name", "surname", "family name"],
  first: ["first name", "given name"],
  middle: ["middle name"],
  ext: ["ext name", "extension name", "name extension", "suffix"],
  sex: ["sex", "gender"],
  nationality: ["nationality", "citizenship"],
  code: ["course code", "subject code", "code"],
  description: ["course description", "subject description", "subject name", "subject", "course title", "description"],
  units: ["no of units", "number of units", "units", "unit"],
  grade: ["grades", "grade", "final grade"],
  remarks: ["remarks", "remark"],
};

const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9ñ]+/g, " ").trim();

export interface PromoEntry {
  /** The row in the sheet (counting from 1), so a message points at what the school sees in Excel. */
  rowNumber: number;
  program: string; major: string; studentNo: string; yearLevel: string;
  last: string; first: string; middle: string; ext: string;
  code: string; description: string; units: string; grade: string; remarks: string;
  /** This row's cells in the order of PROMO_COLUMNS, with the student's details filled in on every row (for the error report). */
  cells: string[];
}

/** One student as the sheet lists them (the row that carries the student's details), whether or not the student has a subject on the sheet. */
export interface PromoStudent {
  rowNumber: number;
  studentNo: string; last: string; first: string; middle: string; ext: string; program: string; yearLevel: string;
}

export interface PromoSheet {
  /** The heading cells as written in the file. */
  headers: string[];
  /** "2022-2023" (or null when the sheet does not say). */
  schoolYear: string | null;
  /** "1st Semester" (or null). */
  semester: string | null;
  schoolName: string;
  entries: PromoEntry[];
  /** Every student on the sheet, in order (used to link School IDs when the sheet has no grades). A student listed on several rows appears once. */
  students: PromoStudent[];
  /** Students with no subject on the sheet (nothing to save) and empty rows that were skipped. */
  ignoredBlank: number;
}

/** True when a table looks like the promotional report: a heading row with STUDENT NO. and GRADES in the first 60 rows. */
export function looksLikePromoReport(grid: string[][]): boolean {
  return findHeaderRow(grid) !== null;
}

function findHeaderRow(grid: string[][]): { row: number; at: Record<Field, number> } | null {
  for (let r = 0; r < Math.min(grid.length, 60); r++) {
    const cells = (grid[r] ?? []).map(plain);
    const at = {} as Record<Field, number>;
    for (const f of FIELD_ORDER) at[f] = cells.findIndex(c => c !== "" && ALIASES[f].includes(c));
    if (at.studentNo !== -1 && at.grade !== -1 && (at.description !== -1 || at.code !== -1)) return { row: r, at };
  }
  return null;
}

/** Reads the sheet. `{ error }` when the heading row cannot be found; otherwise the period, the school's name and every subject row with its student. */
export function readPromoReport(grid: string[][]): PromoSheet | { error: string } {
  const header = findHeaderRow(grid);
  if (!header) return { error: "Could not find the heading row (STUDENT NO., COURSE CODE, COURSE DESCRIPTION, GRADES …). Please use the Promotional Report / Enrollment List template." };
  const { at } = header;

  // the title block above the headings: the school year, the semester and the school's name
  let schoolYear: string | null = null, semester: string | null = null, schoolName = "";
  for (let r = 0; r < header.row; r++) {
    const cells = (grid[r] ?? []).map(c => (c ?? "").trim());
    for (let c = 0; c < cells.length; c++) {
      const text = cells[c];
      if (!text) continue;
      if (!schoolYear) {
        const y = /(\d{4})\s*[-–—/]\s*(\d{4})/.exec(text);
        if (y && Number(y[2]) === Number(y[1]) + 1) schoolYear = `${y[1]}-${y[2]}`;
      }
      if (!semester) {
        const s = /\b(1st|first|2nd|second)\s*sem(?:ester)?\b|\bsummer\b|\bmid[ -]?year\b/i.exec(text);
        if (s) semester = normalizeTerm(s[0]);
      }
      if (!schoolName && /^school name\s*:?/i.test(text)) {
        const inline = text.replace(/^school name\s*:?/i, "").trim();
        schoolName = inline || cells.slice(c + 1).find(x => x !== "") || "";
      }
    }
  }

  const entries: PromoEntry[] = [];
  const students: PromoStudent[] = [];
  const seenStudents = new Set<string>();
  let ignoredBlank = 0;
  let carry = { program: "", major: "", studentNo: "", yearLevel: "", last: "", first: "", middle: "", ext: "", sex: "", nationality: "" };
  for (let r = header.row + 1; r < grid.length; r++) {
    const row = (grid[r] ?? []).map(c => (c ?? "").trim());
    if (row.every(c => c === "")) continue;
    if (row.some(c => /^summary of students/i.test(c))) break;       // the summary at the bottom is not data
    const get = (f: Field) => (at[f] === -1 ? "" : row[at[f]] ?? "");
    const startsStudent = get("studentNo") !== "" || get("last") !== "" || get("first") !== "";
    if (startsStudent) {
      carry = {
        program: get("program"), major: get("major"), studentNo: get("studentNo"), yearLevel: get("yearLevel"),
        last: get("last"), first: get("first"), middle: get("middle"), ext: get("ext"), sex: get("sex"), nationality: get("nationality"),
      };
      const who = `${plain(carry.studentNo)}|${plain(carry.last)}|${plain(carry.first)}|${plain(carry.middle)}`;
      if (!seenStudents.has(who)) {
        seenStudents.add(who);
        students.push({ rowNumber: r + 1, studentNo: carry.studentNo, last: carry.last, first: carry.first, middle: carry.middle, ext: carry.ext, program: carry.program, yearLevel: carry.yearLevel });
      }
    }
    const code = get("code"), description = get("description"), units = get("units"), grade = get("grade"), remarks = get("remarks");
    if (!code && !description && !units && !grade && !remarks) { ignoredBlank++; continue; }      // a student with no subject yet
    const cells = [carry.program, carry.major, carry.studentNo, carry.yearLevel, carry.last, carry.first, carry.middle, carry.ext, carry.sex, carry.nationality, code, description, units, grade, remarks];
    entries.push({ rowNumber: r + 1, ...carry, code, description, units, grade, remarks, cells });
  }
  return { headers: PROMO_COLUMNS.map((h, i) => (grid[header.row]?.[at[FIELD_ORDER[i]]] ?? h).trim() || h), schoolYear, semester, schoolName, entries, students, ignoredBlank };
}

// ── Building the template ────────────────────────────────────
const COLUMN_WIDTHS = [30, 18, 16, 10, 18, 18, 16, 10, 8, 13, 14, 36, 10, 9, 16];
const LAST_COLUMN = "O";

/**
 * The template as a sheet. `blank` leaves the student rows empty (the school types its students); otherwise there is one block per scholar with the
 * STUDENT NO. the school gave (empty until it is known), the year level and name, and one row per subject already declared, with its grade and remark.
 */
export function buildPromoTemplate(opts: { schoolName: string; period: PeriodRef; scholars: SchoolScholarRow[]; existing: SchoolSubjectGrade[]; blank: boolean; percentageEntry?: boolean }): XlsxSheet {
  const { schoolName, period, blank } = opts;
  const term = normalizeTerm(period.semester);
  const termText = (term ? termLabel(term) : period.semester).toUpperCase();
  const scholars = blank ? [] : [...opts.scholars].sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
  const rows: (XlsxCell | string | number | null)[][] = [];
  const merges: string[] = [];
  const pad = (cells: (XlsxCell | string | null)[]): (XlsxCell | string | null)[] => [...cells, ...Array(Math.max(0, PROMO_COLUMNS.length - cells.length)).fill(null)];
  const put = (rowIndex: number, col: number, cell: XlsxCell | string) => { while (rows.length <= rowIndex) rows.push(pad([])); rows[rowIndex][col] = cell; };

  put(0, 0, { value: "PROMOTIONAL REPORT / ENROLLMENT LIST", style: "title" }); merges.push(`A1:${LAST_COLUMN}1`);
  put(1, 0, { value: `SY ${period.schoolYear}`, style: "title" }); merges.push(`A2:${LAST_COLUMN}2`);
  put(2, 0, { value: termText, style: "title" }); merges.push(`A3:${LAST_COLUMN}3`);
  put(4, 0, { value: "SCHOOL INSTITUTIONAL CODE:", style: "bold" });
  put(4, 11, { value: blank ? "TOTAL NO. OF STUDENTS: _________" : `TOTAL NO. OF STUDENTS: ${scholars.length}`, style: "bold" }); merges.push(`L5:${LAST_COLUMN}5`);
  put(5, 0, { value: "SCHOOL NAME:", style: "bold" });
  put(5, 1, { value: schoolName, style: "normal" }); merges.push("B6:J6");
  put(5, 11, "(signature)"); merges.push("L6:N6");
  put(6, 0, { value: "ADDRESS:", style: "bold" });
  put(6, 11, "PREPARED BY: ____________________, Registrar's Staff"); merges.push(`L7:${LAST_COLUMN}7`);
  put(7, 11, "(signature)"); merges.push("L8:N8");
  put(8, 11, "APPROVED BY: ______________________, School Registrar");
  const HEADING_ROW = 11;      // sheet row 12, like the school's own template
  PROMO_COLUMNS.forEach((h, c) => put(HEADING_ROW, c, { value: h, style: "header" }));

  const box = (v: string | number | null): XlsxCell => ({ value: v, style: "box" });
  let r = HEADING_ROW + 1;
  const programCounts = new Map<string, number>();
  if (blank) {
    for (let i = 0; i < 25; i++) { PROMO_COLUMNS.forEach((_, c) => put(r, c, box(null))); r++; }
  } else {
    const byScholar = new Map<string, SchoolSubjectGrade[]>();
    for (const g of opts.existing) { const l = byScholar.get(g.scholarIdNumber); if (l) l.push(g); else byScholar.set(g.scholarIdNumber, [g]); }
    for (const s of scholars) {
      programCounts.set(s.course || "(no program)", (programCounts.get(s.course || "(no program)") ?? 0) + 1);
      const subjects = byScholar.get(s.scholarIdNumber) ?? [];
      const list = subjects.length ? subjects : [null];
      list.forEach((g, i) => {
        const first = i === 0;
        const cells: (string | number | null)[] = [
          first ? s.course : null, null, first ? s.schoolStudentNo || null : null, first ? s.yearLevel : null, first ? s.lastName : null, first ? s.firstName : null, first ? s.middleName || null : null, null, null, null,
          g?.subjectCode || null, g?.subject || null, g?.units ?? null, (opts.percentageEntry && g?.percentage != null ? g.percentage : g?.grade) || null, g?.remarks || null,
        ];
        cells.forEach((v, c) => put(r, c, box(v)));
        r++;
      });
    }
  }
  r += 1;
  put(r, 0, { value: "SUMMARY OF STUDENTS PER PROGRAM:", style: "bold" }); r++;
  for (const [program, n] of [...programCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) { put(r, 1, program); put(r, 2, String(n)); r++; }
  return { name: "Sheet1", rows: rows.map(row => row.length ? row : pad([])), merges, widths: COLUMN_WIDTHS };
}

export function promoTemplateFileName(period: PeriodRef, blank: boolean): string {
  const term = (normalizeTerm(period.semester) ?? period.semester).toLowerCase().replace(/\s+/g, "-");
  return `promo-report_${period.schoolYear}_${term}_${blank ? "blank" : "prefilled"}.xlsx`;
}
