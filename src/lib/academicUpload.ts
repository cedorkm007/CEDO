// ─────────────────────────────────────────────────────────────
// src/lib/academicUpload.ts
// Grades and Academic Management > "Upload by file" (Phase 3): reading a file the way people save it (Excel .xlsx, or CSV with commas or semicolons, with or without a BOM), finding the columns by their names,
// keeping the file's own row numbers, and the words of the review and of the error report. No React / Supabase, so tests can run it alone. The database cleans and matches the Scholar IDs and checks every row.
// ─────────────────────────────────────────────────────────────
export const UPLOAD_MAX_ROWS = 10000;
export const UPLOAD_MAX_MB = 5;
export const UPLOAD_CHUNK = 500;      // rows per call (the database accepts 600)
export const UPLOAD_SQL = "supabase_migration_academic_uploads.sql";
export const UPLOAD_HEADERS = ["Scholar ID", "Full name", "School", "Program", "Year level", "Academic status", "Custom passing GWA (optional)"];
export const UPLOAD_INSTRUCTIONS = [
  "How to fill this in",
  "Change only the “Academic status” column: write Academic, Non-academic or Not set. A scholar whose status you do not change is left alone.",
  "Scholar ID decides who is changed; the name, program and year are only compared with the record (a difference is a warning).",
  "Keep the Scholar ID column as Text so Excel does not change the IDs. Only the first sheet is read.",
  "Custom passing GWA (optional): a number on the school's own scale for ONE scholar, or “none” to take it away; leave it empty to keep it as it is.",
  "Nothing is saved until you have checked the file and pressed “Save”. A row with a problem is skipped and listed in the error report; the rows that are fine are still saved.",
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const NAMES = {
  scholar: ["scholarid", "scholaridnumber", "idnumber", "studentid", "id"], name: ["fullname", "name", "scholarname"], program: ["program", "course", "programcourse"],
  year: ["yearlevel", "year"], status: ["academicstatus", "status", "newstatus", "academic", "newacademicstatus"], custom: ["custompassinggwa", "custompassinggwaoptional", "custom", "passinggwa"],
} as const;

/** A CSV as people save it: a BOM at the start, commas OR semicolons OR tabs, quoted cells. Empty lines are KEPT, so the row numbers are the file's own (line 1 = row 1). */
export function parseDelimited(text: string): string[][] {
  const t = text.replace(/^﻿/, "");
  const first = t.split(/\r?\n/).find(l => l.trim() !== "") ?? "";
  const count = (c: string) => { let n = 0, q = false; for (const ch of first) { if (ch === '"') q = !q; else if (!q && ch === c) n++; } return n; };
  const delim = [",", ";", "\t"].reduce((best, c) => (count(c) > count(best) ? c : best), ",");
  const rows: string[][] = []; let row: string[] = [], field = "", inQ = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inQ) { if (c === '"' && t[i + 1] === '"') { field += '"'; i++; } else if (c === '"') inQ = false; else field += c; }
    else if (c === '"') inQ = true;
    else if (c === delim) { row.push(field); field = ""; }
    else if (c === "\r") { /* \n ends the line */ }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export interface UploadRow { i: number; scholar_id: string; name: string; program: string; status: string; custom: string; raw: string[] }
export interface ParsedUpload { rows: UploadRow[]; headerError: string; headerRow: number; header: string[]; skippedExample: number }

/** The grid of a spreadsheet -> rows to check. The header is the first row (of the first 20) that has a Scholar ID column; columns are found by NAME in any order; the row number of each row is its own row in the file. */
export function parseUploadGrid(grid: string[][]): ParsedUpload {
  const empty = (h: string): ParsedUpload => ({ rows: [], headerError: h, headerRow: 0, header: [], skippedExample: 0 });
  if (!grid.some(r => r.some(c => (c ?? "").trim() !== ""))) return empty("The file is empty.");
  let hr = -1;
  for (let k = 0; k < Math.min(grid.length, 20); k++) if (grid[k].some(c => (NAMES.scholar as readonly string[]).includes(norm(c ?? "")))) { hr = k; break; }
  if (hr < 0) return empty("The file needs a header row with the column “Scholar ID” (in the first 20 rows). It was not found.");
  const head = grid[hr].map(c => norm(c ?? ""));
  const col = (k: keyof typeof NAMES) => head.findIndex(h => (NAMES[k] as readonly string[]).includes(h));
  const ci = { scholar: col("scholar"), name: col("name"), program: col("program"), status: col("status"), custom: col("custom") };
  if (ci.status < 0) return empty("The file needs the column “Academic status”. It was not found.");
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").toString().trim() : "");
  const rows: UploadRow[] = []; let skippedExample = 0;
  for (let n = hr + 1; n < grid.length; n++) {
    const r = grid[n] ?? [];
    const scholar = get(r, ci.scholar), status = get(r, ci.status);
    if (!scholar && !status) continue;      // an empty row, or text beside the table (the instructions)
    if (/^example\b/i.test(scholar)) { skippedExample++; continue; }
    rows.push({ i: n + 1, scholar_id: scholar, name: get(r, ci.name), program: get(r, ci.program), status, custom: get(r, ci.custom), raw: r.map(c => (c ?? "").toString()) });
  }
  return { rows, headerError: "", headerRow: hr + 1, header: grid[hr].map(c => (c ?? "").toString()), skippedExample };
}

/** The same scholar in the file twice (written a little differently): the later rows are refused, the first is used. */
export function findDuplicates(rows: UploadRow[]): Map<number, number> {
  const seen = new Map<string, number>(), dup = new Map<number, number>();
  for (const r of rows) {
    const key = r.scholar_id.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^0+/, "");
    if (!key) continue;
    const at = seen.get(key);
    if (at !== undefined) dup.set(r.i, at); else seen.set(key, r.i);
  }
  return dup;
}

export type UploadState = "valid" | "warning" | "error";
export interface UploadChecked {
  i: number; state: UploadState; action: "set" | "skip" | "none"; messages: string[]; scholarId: string | null; name: string | null; program: string | null;
  currentStatus: string | null; newStatus: string | null; currentCustom: number | null; newCustom: number | null; clearCustom: boolean;
}
export interface UploadTotals { rows: number; valid: number; warning: number; error: number; willSet: number; same: number }
export function uploadTotals(c: UploadChecked[]): UploadTotals {
  return {
    rows: c.length, valid: c.filter(x => x.state === "valid").length, warning: c.filter(x => x.state === "warning").length, error: c.filter(x => x.state === "error").length,
    willSet: c.filter(x => x.action === "set").length, same: c.filter(x => x.state !== "error" && x.action === "skip").length,
  };
}
const n = (v: number) => v.toLocaleString("en-US");
export const statusWord = (s: string | null | undefined) => (s === "non_academic" ? "Non-academic" : s === "academic" ? "Academic" : "Not set");
export function resultText(c: Pick<UploadChecked, "state" | "action" | "newStatus" | "newCustom" | "clearCustom">): string {
  if (c.state === "error") return "Skipped (problem)";
  if (c.action === "set") return `Will be set: ${statusWord(c.newStatus)}${c.newCustom != null ? ` · custom ${c.newCustom.toFixed(2)}` : c.clearCustom ? " · custom taken away" : ""}`;
  return "No change";
}
export function summaryText(set: number, same: number, errors: number): string {
  return `${n(set)} changed, ${n(same)} already had it, ${n(errors)} skipped because of a problem`;
}

/** The error report: the original rows that had a problem, as they were in the file, with their row number and a "Problem" column. */
export function errorReportRows(header: string[], rows: UploadRow[], problems: Map<number, string[]>): string[][] {
  const width = Math.max(header.length, 1);
  const out: string[][] = [["Row", ...Array.from({ length: width }, (_, k) => header[k] ?? ""), "Problem"]];
  for (const r of rows) {
    const p = problems.get(r.i);
    if (!p || p.length === 0) continue;
    out.push([String(r.i), ...Array.from({ length: width }, (_, k) => r.raw[k] ?? ""), p.join(" ")]);
  }
  return out;
}
