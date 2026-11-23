// ─────────────────────────────────────────────────────────────
// src/lib/sdpCreditedFilters.ts
// SDP Monitoring > an activity > Credited Scholars: the plain rules of the filters, the Export and the Import. The filters that can be combined (the choices, the words of each option, the chips, what is sent to the database),
// the Export (columns, file name, the rows of the file) and the Import (the template, reading a file's rows, the words of the review and of the error report). No React / Supabase, so tests can run it alone.
// The database does the matching, the counting of the options and the checking of every imported row.
// ─────────────────────────────────────────────────────────────
import { normalizeTerm, termLabel } from "./academicPeriods";
import { parseFlexibleDate } from "./bulkDailyRecords";
import { creditSemesterLabel, fullName } from "./sdpCreditedView";

export const FILTERS_SQL = "supabase_migration_sdp_credited_filters_import.sql";

/** What is chosen: within one filter "any of these", different filters "all of them". Dates are "YYYY-MM-DD". */
export interface CreditedFilters {
  year?: string[]; school?: string[]; course?: string[]; barangay?: string[]; cluster?: string[]; status?: string[];
  semester?: string[]; how?: string[]; day?: string[]; reason?: string[]; from?: string; to?: string;
}
export type ListKind = "credited" | "attended" | "eligible";
export type ListDim = "year" | "school" | "course" | "barangay" | "cluster" | "status" | "semester" | "how" | "day" | "reason";
export const LIST_DIMS: ListDim[] = ["year", "school", "course", "barangay", "cluster", "status", "semester", "how", "day", "reason"];

export const DIM_LABELS: Record<ListDim, string> = {
  year: "Year level", school: "School", course: "Program / course", barangay: "Barangay", cluster: "Cluster", status: "Scholarship status",
  semester: "Counts in semester", how: "How credited", day: "Activity day", reason: "Reason not credited",
};
const CHIP_LABELS: Record<ListDim, string> = {
  year: "Year", school: "School", course: "Program", barangay: "Barangay", cluster: "Cluster", status: "Status", semester: "Semester", how: "How", day: "Day", reason: "Reason",
};

/** Which filters apply to a list (in the order they are shown). The activity day only matters for a recurring activity. */
export function dimsFor(kind: ListKind, recurring: boolean): ListDim[] {
  const common: ListDim[] = ["year", "school", "course", "barangay", "cluster", "status"];
  if (kind === "credited") return [...common, "semester", "how", ...(recurring ? ["day" as const] : [])];
  return [...common, "reason"];
}
/** Does a list use the date-range filter? Only the credits have a date credited. */
export const hasDateRange = (kind: ListKind): boolean => kind === "credited";

export const HOW_LABELS: Record<string, string> = { scan: "QR scan", manual: "Added by hand", credit_attended: "“Credit these scholars”", import: "Import", picture: "Picture approved", other: "Other" };
export const howText = (how: string | null | undefined): string => (how ? HOW_LABELS[how] ?? how : "—");
export const REASON_LABELS: Record<string, string> = {
  survey: "Waiting for the survey", banked: "Credit saved for a later semester", missing: "Attended, no credit recorded", no_category: "Activity has no SDP category",
  none: "Did not attend", incomplete: "Scanned once, did not finish",
};
export const NOT_ON_FILE = "(not on file)";

/** The words of one option of a filter, for the list of options and the chips. */
export function optionLabel(dim: ListDim, value: string, activityDayLabel?: (v: string) => string): string {
  if (value === "(none)") return NOT_ON_FILE;
  if (dim === "how") return howText(value);
  if (dim === "reason") return REASON_LABELS[value] ?? value;
  if (dim === "semester") { if (value === "none") return "No semester"; const i = value.indexOf("|"); return i > 0 ? creditSemesterLabel(value.slice(0, i), value.slice(i + 1)) : value; }
  if (dim === "day") return activityDayLabel ? activityDayLabel(value) : value;
  return value;
}

const clean = (a: string[] | undefined) => (Array.isArray(a) ? a.filter(x => typeof x === "string" && x !== "") : []);
const okDay = (d: string | undefined) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : "");

/** Only the filters that apply to this list and have a choice, in the shape the database is asked. */
export function toFilterParam(f: CreditedFilters, kind: ListKind, recurring: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const d of dimsFor(kind, recurring)) { const v = clean(f[d]); if (v.length) out[d] = v; }
  if (hasDateRange(kind)) { const a = okDay(f.from), b = okDay(f.to); if (a) out.from = a; if (b) out.to = b; }
  return out;
}
export const filterCount = (f: CreditedFilters, kind: ListKind, recurring: boolean): number => Object.keys(toFilterParam(f, kind, recurring)).length;
export const isFiltered = (f: CreditedFilters, kind: ListKind, recurring: boolean): boolean => filterCount(f, kind, recurring) > 0;

export function toggleChoice(f: CreditedFilters, dim: ListDim, value: string): CreditedFilters {
  const cur = clean(f[dim]);
  const next = cur.includes(value) ? cur.filter(x => x !== value) : [...cur, value];
  return { ...f, [dim]: next };
}
export const clearDim = (f: CreditedFilters, dim: ListDim | "dates"): CreditedFilters => (dim === "dates" ? { ...f, from: "", to: "" } : { ...f, [dim]: [] });

export interface FilterChip { key: string; dim: ListDim | "dates"; text: string }
/** The removable chips under the search ("Year: 1st Year, 2nd Year ×"), one per filter that has a choice. */
export function filterChips(f: CreditedFilters, kind: ListKind, recurring: boolean, dayLabel?: (v: string) => string, dateText: (d: string) => string = d => d): FilterChip[] {
  const chips: FilterChip[] = [];
  for (const d of dimsFor(kind, recurring)) {
    const v = clean(f[d]);
    if (v.length) chips.push({ key: d, dim: d, text: `${CHIP_LABELS[d]}: ${v.map(x => optionLabel(d, x, dayLabel)).join(", ")}` });
  }
  if (hasDateRange(kind)) {
    const a = okDay(f.from), b = okDay(f.to);
    if (a || b) chips.push({ key: "dates", dim: "dates", text: a && b ? `Date credited: ${dateText(a)} – ${dateText(b)}` : a ? `Date credited: from ${dateText(a)}` : `Date credited: until ${dateText(b)}` });
  }
  return chips;
}

/** The kind of list the filters are asked for. */
export const listKind = (side: "credited" | "not_credited", notFilter: "attended" | "eligible"): ListKind => (side === "credited" ? "credited" : notFilter);

/** A facet answer: for each filter, its options with how many scholars each matches. Options that match nobody stay in the list (greyed), except those that no scholar has at all. */
export interface FacetOption { v: string; n: number }
export type Facets = Partial<Record<ListDim, FacetOption[]>> & { total?: { rows: number; scholars: number } };

/** The options to show for a filter: the answer, plus the ones already chosen (shown even when nobody matches, so they can be unticked), each with its number; options with 0 are greyed by the screen. */
export function optionsToShow(dim: ListDim, facets: Facets | null, chosen: string[]): FacetOption[] {
  const list = (facets?.[dim] ?? []) as FacetOption[];
  const seen = new Set(list.map(o => o.v));
  const extra = chosen.filter(v => !seen.has(v)).map(v => ({ v, n: 0 }));
  const all = [...list, ...extra];
  const rank = (o: FacetOption) => (o.v === "(none)" ? 1 : 0);
  return all.sort((a, b) => rank(a) - rank(b) || (dim === "year" ? yearOrder(a.v) - yearOrder(b.v) : 0) || b.n - a.n || a.v.localeCompare(b.v));
}
const yearOrder = (v: string): number => { const m = /^(\d)/.exec(v); return m ? Number(m[1]) : 99; };

// ── the Export ──
export const EXPORT_PAGE = 500;
export type ExportFormat = "xlsx" | "csv";
export const safeFileName = (s: string): string => (s || "Activity").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, " ").trim().split(" ").filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join("").slice(0, 40) || "Activity";
const SIDE_FILE: Record<ListKind, string> = { credited: "Credited", attended: "NotCredited_Attended", eligible: "NotCredited_Eligible" };
/** "Iskolar360_PaglawigIsda_Credited_2026-11-23.xlsx": the activity, the list and the day it was exported. */
export const exportFileName = (activityName: string, kind: ListKind, day: string, format: ExportFormat): string => `${safeFileName(activityName)}_${SIDE_FILE[kind]}_${day}.${format}`;

export const CREDITED_EXPORT_HEADERS = ["Scholar ID", "Scholar name", "Year level", "School", "Program", "Barangay", "Cluster", "Activity", "Category", "Sub-category", "Date credited", "Semester", "Credits", "How credited", "Credited by"];
export const NOT_CREDITED_EXPORT_HEADERS = ["Scholar ID", "Scholar name", "Year level", "School", "Program", "Barangay", "Cluster", "Scholarship status", "Activity", "Category", "Sub-category", "Reason not credited"];

export interface ExportCreditRow {
  scholarIdNumber: string; firstName: string; lastName: string; yearLevel: string; school: string; course: string; barangay: string; cluster: string;
  attendedDate: string; schoolYear: string | null; semester: string | null; how: string; creditedBy: string; sessionName: string;
}
export interface ExportNotCreditedRow { scholarIdNumber: string; firstName: string; lastName: string; yearLevel: string; school: string; course: string; barangay: string; cluster: string; status: string; reasonCode: string }
export interface ExportActivity { name: string; categoryLabel: string; subCategoryLabel: string; credits: number }

export function creditedExportRow(r: ExportCreditRow, a: ExportActivity): (string | number)[] {
  return [
    r.scholarIdNumber, fullName(r.firstName, r.lastName), r.yearLevel, r.school, r.course, r.barangay, r.cluster, r.sessionName ? `${a.name} – ${r.sessionName}` : a.name, a.categoryLabel, a.subCategoryLabel,
    r.attendedDate, r.schoolYear && r.semester ? creditSemesterLabel(r.schoolYear, r.semester) : "No semester", a.credits, howText(r.how), r.creditedBy,
  ];
}
export function notCreditedExportRow(r: ExportNotCreditedRow, a: ExportActivity): string[] {
  return [r.scholarIdNumber, fullName(r.firstName, r.lastName), r.yearLevel, r.school, r.course, r.barangay, r.cluster, r.status, a.name, a.categoryLabel, a.subCategoryLabel, REASON_LABELS[r.reasonCode] ?? r.reasonCode];
}

/** A text file (CSV) for Excel: quoted when needed, with a mark at the start so accented names (Ñ) open right. */
export function toCsv(rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => { const s = v == null ? "" : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return "﻿" + rows.map(r => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

// ── the Import ──
export const IMPORT_MAX_ROWS = 2000;
export const IMPORT_MAX_MB = 5;
export const IMPORT_SAVE_CHUNK = 500;
export const IMPORT_HEADERS = ["Scholar ID", "Date credited", "Semester", "Credits", "Day sub-name", "Note"];
export const IMPORT_EXAMPLE = ["EXAMPLE-0001 (delete this row)", "2026-11-23", "2026-2027 · 1st Semester", "1", "", "Optional note; not saved"];
export const IMPORT_INSTRUCTIONS = [
  "How to fill this in",
  "Scholar ID: required. Scholars are found by Scholar ID only, never by name.",
  "Date credited: required, e.g. 2026-11-23 or Nov 23, 2026.",
  "Semester: leave empty to use the semester chosen at “Counts in”. Otherwise write it like 2026-2027 · 1st Semester.",
  "Credits: optional. The activity decides how many credits it gives; the number here is ignored.",
  "Day sub-name: only for a recurring activity with several sessions on one date; write the session's name.",
  "Note: optional, for your own use. It is not saved.",
  "Nothing is saved until you have checked the file and pressed “Save valid rows”.",
];

export interface ImportRow { i: number; scholar_id: string; date: string | null; date_text: string; school_year: string; semester: string; day_sub: string; credits: string; note: string }
export interface ParsedImport { rows: ImportRow[]; headerError: string; skippedExample: number }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const COLUMN_NAMES: Record<string, string[]> = {
  scholar: ["scholarid", "scholaridnumber", "idnumber", "id"], date: ["datecredited", "date", "dateofcredit"], semester: ["semester", "countsin", "term"],
  credits: ["credits", "credit"], day: ["daysubname", "daysub", "session", "sessionname", "subname"], note: ["note", "notes", "remarks"],
};

/** A semester typed in the file: "2026-2027 · 1st Semester", "2026-2027 1st sem", "1st Semester" (the school year then comes from "Counts in"). Anything else is sent as written so the database says "Semester not found". */
export function parseSemesterCell(text: string, defaultSchoolYear: string | null): { schoolYear: string; semester: string } {
  const t = text.trim();
  if (!t) return { schoolYear: "", semester: "" };
  const m = /(\d{4})\s*[-–/]\s*(\d{4})/.exec(t);
  const rest = t.replace(/(\d{4})\s*[-–/]\s*(\d{4})/, " ").replace(/[|·,;]/g, " ").replace(/\s+/g, " ").trim();
  const sy = m ? `${m[1]}-${m[2]}` : defaultSchoolYear ?? "";
  const term = normalizeTerm(rest);
  if (!term) return { schoolYear: sy || "?", semester: rest || t };
  return { schoolYear: sy || "?", semester: term };
}

/** Turns the grid of a spreadsheet into rows to check. The first non-empty row is the header; empty rows, the example row and rows outside the table are left out. */
export function parseImportGrid(grid: string[][], defaultSchoolYear: string | null): ParsedImport {
  const start = grid.findIndex(r => r.some(c => (c ?? "").trim() !== ""));
  if (start < 0) return { rows: [], headerError: "The file is empty.", skippedExample: 0 };
  const head = grid[start].map(c => norm(c ?? ""));
  const col = (k: keyof typeof COLUMN_NAMES) => head.findIndex(h => COLUMN_NAMES[k].includes(h));
  const ci = { scholar: col("scholar"), date: col("date"), semester: col("semester"), credits: col("credits"), day: col("day"), note: col("note") };
  if (ci.scholar < 0 || ci.date < 0) return { rows: [], headerError: `The first row must have the columns “Scholar ID” and “Date credited”${ci.scholar < 0 && ci.date < 0 ? " (neither was found)" : ci.scholar < 0 ? " (“Scholar ID” was not found)" : " (“Date credited” was not found)"}. Download the template to see them.`, skippedExample: 0 };
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").toString().trim() : "");
  const rows: ImportRow[] = []; let skippedExample = 0;
  for (let n = start + 1; n < grid.length; n++) {
    const r = grid[n];
    const scholar = get(r, ci.scholar), dateText = get(r, ci.date), sem = get(r, ci.semester);
    if (!scholar && !dateText && !sem) continue;      // empty row, or text outside the table (the instructions beside it)
    if (/^example\b/i.test(scholar)) { skippedExample++; continue; }
    const s = parseSemesterCell(sem, defaultSchoolYear);
    rows.push({ i: n + 1, scholar_id: scholar, date: dateText ? parseFlexibleDate(dateText) : null, date_text: dateText, school_year: s.schoolYear, semester: s.semester, day_sub: get(r, ci.day), credits: get(r, ci.credits), note: get(r, ci.note) });
  }
  return { rows, headerError: "", skippedExample };
}

export type ImportState = "valid" | "warning" | "error";
export interface ImportChecked { i: number; state: ImportState; willCredit: boolean; skip: boolean; messages: string[]; scholarId: string | null; name: string | null; date: string | null; schoolYear: string | null; semester: string | null }
export interface ImportTotals { valid: number; warning: number; error: number; willCredit: number; skipped: number }
export const importTotals = (rows: ImportChecked[]): ImportTotals => ({
  valid: rows.filter(r => r.state === "valid").length, warning: rows.filter(r => r.state === "warning").length, error: rows.filter(r => r.state === "error").length,
  willCredit: rows.filter(r => r.willCredit).length, skipped: rows.filter(r => r.skip && r.state !== "error").length,
});
export const STATE_LABEL: Record<ImportState, string> = { valid: "Valid", warning: "Warning", error: "Error" };
/** What the review says about a row that will be credited / skipped / refused. */
export function importOutcomeText(r: ImportChecked): string { return r.state === "error" ? "Will not be credited" : r.skip ? "Skipped" : "Will be credited"; }

export const IMPORT_REPORT_HEADERS = ["Row in your file", "Scholar ID", "Date credited (as written)", "Result", "Reason"];
/** The error report: the rows that were not credited (refused or skipped) with their row number in the file and the reason. */
export function importReportRows(file: ImportRow[], results: { i: number; outcome: string; message: string | null }[], checked: ImportChecked[]): string[][] {
  const byI = new Map(file.map(r => [r.i, r]));
  const out: string[][] = [];
  const seen = new Set<number>();
  for (const r of results) {
    if (r.outcome === "credited") continue;
    const row = byI.get(r.i); seen.add(r.i);
    out.push([String(r.i), row?.scholar_id ?? "", row?.date_text ?? "", r.outcome === "skipped" ? "Skipped" : "Not credited", r.message ?? ""]);
  }
  for (const c of checked) {      // rows the check already refused and that were never sent for saving
    if (seen.has(c.i) || c.willCredit) continue;
    const row = byI.get(c.i);
    out.push([String(c.i), row?.scholar_id ?? "", row?.date_text ?? "", c.state === "error" ? "Not credited" : "Skipped", c.messages.join(" ")]);
  }
  return out.sort((a, b) => Number(a[0]) - Number(b[0]));
}

/** "45 credited, 3 skipped, 2 errors". */
export function importSummaryText(credited: number, skipped: number, errors: number): string {
  return `${credited.toLocaleString("en-US")} credited, ${skipped.toLocaleString("en-US")} skipped, ${errors.toLocaleString("en-US")} error${errors === 1 ? "" : "s"}`;
}
export const termWords = termLabel;
