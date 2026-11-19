// ─────────────────────────────────────────────────────────────
// src/lib/bulkDailyRecords.ts
// Consultation Tool > Daily Records > "Bulk Add": reading a spreadsheet of PAST daily records into rows the database can check (counseling_bulk_records,
// supabase_migration_consultation_bulk_records.sql). Plain helpers (no React / Supabase) so tests can run them alone. The database decides whether a row is valid
// (the scholar exists, the status, the visit type, the date, doubles); this file only READS the file: finds the columns, turns every kind of date into YYYY-MM-DD,
// and says what it cannot read.
// ─────────────────────────────────────────────────────────────

/** The columns of the template, in order. Only the Scholar ID and the Date Visited are needed; the others may be left empty. */
export const BULK_TEMPLATE_HEADERS = ["Scholar ID Number", "Date Visited", "Status", "Visit Type", "Failed Subject(s)", "Findings", "Staff Recommendations"] as const;
/** A first example row, clearly marked, that the import ignores. */
export const BULK_TEMPLATE_EXAMPLE = ["EXAMPLE (delete this row)", "2026-09-15", "Regular", "Office", "Calculus 2", "Struggling with the schedule", "Weekly check-in"] as const;
export const BULK_MAX_ROWS = 2000;

/** What is sent to the database for one row (the names the function reads). */
export interface BulkRowInput { id: string; date: string; status: string; visit_type: string; failed: string; findings: string; recommendations: string }
export interface BulkParsedRow {
  /** The row number in the spreadsheet (the header is row 1). */
  rowNumber: number;
  input: BulkRowInput;
  /** What is wrong with the row that can be seen without the database (an unreadable date); null when fine. */
  problem: string | null;
}

const norm = (h: string) => h.trim().toLowerCase().replace(/[\s_]+/g, " ").replace(/[.:()#]/g, "").replace(/s$/, "");
const COLUMN_NAMES: Record<keyof BulkRowInput, string[]> = {
  id: ["scholar id number", "scholar id", "scholar id no", "scholar no", "id number", "id no", "id", "student id", "student no"],
  date: ["date visited", "date", "date of visit", "visit date", "date of consultation", "consultation date"],
  status: ["status", "scholarship status"],
  visit_type: ["visit type", "type of visit", "visit"],
  failed: ["failed subject", "failed subject(s)", "failed subjects", "failed", "subjects failed"],
  findings: ["finding", "findings"],
  recommendations: ["staff recommendation", "staff recommendations", "recommendation", "recommendations"],
};
const normNames = Object.fromEntries(Object.entries(COLUMN_NAMES).map(([k, v]) => [k, v.map(norm)])) as Record<keyof BulkRowInput, string[]>;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const validDay = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate() && y >= 1900 && y <= 2200;
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/**
 * Turns a date written in a spreadsheet into YYYY-MM-DD. Understands: 2026-09-15, 2026/9/15, 9/15/2026 and 15/9/2026 (a number over 12 first is the day; otherwise MONTH first, as in Excel here),
 * "September 15, 2026", "15 Sep 2026", and Excel's own date numbers (46280). Returns null when it cannot tell.
 */
export function parseFlexibleDate(text: string): string | null {
  const t = text.trim().replace(/\s+/g, " ").replace(/,/g, "");
  if (!t) return null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(t);
  if (m) { const y = +m[1], mo = +m[2], d = +m[3]; return validDay(y, mo, d) ? iso(y, mo, d) : null; }
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})$/.exec(t);
  if (m) {
    const a = +m[1], b = +m[2]; let y = +m[3]; if (m[3].length === 2) y += 2000;
    const [mo, d] = a > 12 ? [b, a] : [a, b];
    return validDay(y, mo, d) ? iso(y, mo, d) : null;
  }
  m = /^([A-Za-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)? (\d{4})$/.exec(t);
  if (m) { const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1; return mo && validDay(+m[3], mo, +m[2]) ? iso(+m[3], mo, +m[2]) : null; }
  m = /^(\d{1,2})(?:st|nd|rd|th)? ([A-Za-z]{3,9})\.? (\d{4})$/.exec(t);
  if (m) { const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1; return mo && validDay(+m[3], mo, +m[1]) ? iso(+m[3], mo, +m[1]) : null; }
  if (/^\d{5}(\.\d+)?$/.test(t)) {       // an Excel date number: days since 1899-12-30
    const serial = Math.floor(Number(t));
    if (serial < 20000 || serial > 80000) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  return null;
}

/** A row that is only the example of the template, or has nothing in it, is not a record. */
const isExample = (id: string) => /^example\b/i.test(id.trim());

/**
 * Reads the rows of a spreadsheet (a grid of text; the first non-empty row is the header) into rows to send. Empty rows and the example row are left out.
 * `headerError` is set when the file has no Scholar ID or no Date Visited column.
 */
export function parseDailyRecordGrid(grid: string[][]): { rows: BulkParsedRow[]; headerError?: string; skippedExample: number } {
  const first = grid.findIndex(r => r.some(c => (c ?? "").trim() !== ""));
  if (first < 0) return { rows: [], headerError: "The file is empty.", skippedExample: 0 };
  const headers = grid[first].map(c => norm(c ?? ""));
  const col = (k: keyof BulkRowInput) => headers.findIndex(h => normNames[k].includes(h));
  const idx = { id: col("id"), date: col("date"), status: col("status"), visit_type: col("visit_type"), failed: col("failed"), findings: col("findings"), recommendations: col("recommendations") };
  if (idx.id === -1) return { rows: [], headerError: 'The file needs a "Scholar ID Number" column (the first row must be the column names).', skippedExample: 0 };
  if (idx.date === -1) return { rows: [], headerError: 'The file needs a "Date Visited" column.', skippedExample: 0 };
  const at = (r: string[], i: number) => (i === -1 ? "" : (r[i] ?? "").trim());
  const rows: BulkParsedRow[] = [];
  let skippedExample = 0;
  for (let i = first + 1; i < grid.length; i++) {
    const r = grid[i];
    if (!r.some(c => (c ?? "").trim() !== "")) continue;
    const id = at(r, idx.id);
    if (isExample(id)) { skippedExample++; continue; }
    const dateText = at(r, idx.date);
    const date = dateText ? parseFlexibleDate(dateText) : "";
    rows.push({
      rowNumber: i + 1,
      input: { id, date: date ?? dateText, status: at(r, idx.status), visit_type: at(r, idx.visit_type), failed: at(r, idx.failed), findings: at(r, idx.findings), recommendations: at(r, idx.recommendations) },
      problem: date === null ? `The date "${dateText.slice(0, 30)}" cannot be read. Write it like 2026-09-15 or 09/15/2026.` : null,
    });
  }
  return { rows, skippedExample };
}

/** The answer of the database for one row (counseling_bulk_records). */
export interface BulkRowResult { i: number; ok: boolean; duplicate: boolean; error: string | null; scholarId: string | null; name: string | null; status: string | null; visitType: string | null; date: string | null }

export type BulkRowState = "ready" | "duplicate" | "error";
/** Where a row stands once the database has looked at it (or, before that, what the file alone shows). */
export function rowState(parsed: BulkParsedRow, result: BulkRowResult | undefined): { state: BulkRowState; message: string } {
  if (parsed.problem) return { state: "error", message: parsed.problem };
  if (!result) return { state: "ready", message: "" };
  if (!result.ok) return { state: "error", message: result.error ?? "This row cannot be added." };
  if (result.duplicate) return { state: "duplicate", message: "Already recorded: it will be skipped." };
  return { state: "ready", message: "" };
}

/** The counts for the summary line. */
export function summarize(rows: BulkParsedRow[], results: Map<number, BulkRowResult>): { ready: number; duplicate: number; error: number } {
  const out = { ready: 0, duplicate: 0, error: 0 };
  for (const r of rows) out[rowState(r, results.get(r.rowNumber)).state]++;
  return out;
}
