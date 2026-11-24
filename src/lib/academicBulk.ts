// ─────────────────────────────────────────────────────────────
// src/lib/academicBulk.ts
// Scholar Management Tools > Scholars > Grades and Academic Management: the plain rules of the bulk setting of a scholar's OWN academic status from a file: the template, reading the rows of a file, and the words of the
// review. No React / Supabase, so tests can run it alone. The database matches the scholars (by Scholar ID only), checks every row again when it is saved and sets or takes away the own status.
// ─────────────────────────────────────────────────────────────
export const ACADEMIC_BULK_SQL = "supabase_migration_academic_scholar_overrides.sql";
export const ACADEMIC_BULK_MAX_ROWS = 3000;
export const ACADEMIC_BULK_MAX_MB = 5;
export const ACADEMIC_BULK_SAVE_CHUNK = 500;
export const ACADEMIC_BULK_HEADERS = ["Scholar ID", "Full name", "School", "Program", "Academic status"];
export const ACADEMIC_BULK_EXAMPLE = ["EXAMPLE-0001 (delete this row)", "Juan D. Cruz", "Name of the school", "BS Nursing", "Non-academic"];
export const ACADEMIC_BULK_INSTRUCTIONS = [
  "How to fill this in",
  "Scholar ID: required. Scholars are found by Scholar ID only, never by name.",
  "Full name, School, Program: for you and for checking. If one is different from the record you get a warning (the row is still used).",
  "Academic status: write Academic or Non-academic. This is the scholar's status; the renewal uses it.",
  "Writing the status the scholar already has changes nothing.",
  "Nothing is saved until you have checked the file and pressed “Save”.",
];
export type AcademicBulkAction = "set" | "reset" | "skip" | "none";
export type AcademicBulkState = "valid" | "warning" | "error";

export interface AcademicBulkRow { i: number; scholar_id: string; name: string; school: string; program: string; status: string }
export interface ParsedAcademicBulk { rows: AcademicBulkRow[]; headerError: string; skippedExample: number }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const NAMES: Record<string, string[]> = {
  scholar: ["scholarid", "scholaridnumber", "idnumber", "id"], name: ["fullname", "name", "scholarname"], school: ["school", "schoolname"], program: ["program", "course", "programcourse"],
  status: ["academicstatus", "status", "academic", "academicnonacademic"],
};

/** Turns the grid of a spreadsheet into rows to check. The first non-empty row is the header; empty rows, the example row and rows outside the table are left out. */
export function parseAcademicBulkGrid(grid: string[][]): ParsedAcademicBulk {
  const start = grid.findIndex(r => r.some(c => (c ?? "").trim() !== ""));
  if (start < 0) return { rows: [], headerError: "The file is empty.", skippedExample: 0 };
  const head = grid[start].map(c => norm(c ?? ""));
  const col = (k: keyof typeof NAMES) => head.findIndex(h => NAMES[k].includes(h));
  const ci = { scholar: col("scholar"), name: col("name"), school: col("school"), program: col("program"), status: col("status") };
  if (ci.scholar < 0 || ci.status < 0) return { rows: [], headerError: `The first row must have the columns “Scholar ID” and “Academic status”${ci.scholar < 0 && ci.status < 0 ? " (neither was found)" : ci.scholar < 0 ? " (“Scholar ID” was not found)" : " (“Academic status” was not found)"}. Download the template to see them.`, skippedExample: 0 };
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").toString().trim() : "");
  const rows: AcademicBulkRow[] = []; let skippedExample = 0;
  for (let n = start + 1; n < grid.length; n++) {
    const r = grid[n];
    const scholar = get(r, ci.scholar), status = get(r, ci.status);
    if (!scholar && !status) continue;      // empty row, or text outside the table (the instructions beside it)
    if (/^example\b/i.test(scholar)) { skippedExample++; continue; }
    rows.push({ i: n + 1, scholar_id: scholar, name: get(r, ci.name), school: get(r, ci.school), program: get(r, ci.program), status });
  }
  return { rows, headerError: "", skippedExample };
}

export interface AcademicBulkChecked {
  i: number; state: AcademicBulkState; action: AcademicBulkAction; messages: string[]; scholarId: string | null; name: string | null; school: string | null; program: string | null;
  programStatus: string | null; currentStatus: string | null; newStatus: string | null;
}
export const statusLabel = (s: string | null | undefined): string => (s === "non_academic" ? "Non-academic" : s === "academic" ? "Academic" : "—");
/** What will happen to a row when it is saved. */
export function actionText(r: Pick<AcademicBulkChecked, "action" | "state" | "newStatus">): string {
  if (r.state === "error") return "Will not be changed";
  if (r.action === "set") return `Own status: ${statusLabel(r.newStatus)}`;
  if (r.action === "reset") return "Own status taken away (follows the program)";
  return "No change";
}
export const STATE_LABEL: Record<AcademicBulkState, string> = { valid: "Valid", warning: "Warning", error: "Error" };
export interface AcademicBulkTotals { valid: number; warning: number; error: number; willSet: number; willReset: number; noChange: number }
export const academicBulkTotals = (rows: AcademicBulkChecked[]): AcademicBulkTotals => ({
  valid: rows.filter(r => r.state === "valid").length, warning: rows.filter(r => r.state === "warning").length, error: rows.filter(r => r.state === "error").length,
  willSet: rows.filter(r => r.action === "set").length, willReset: rows.filter(r => r.action === "reset").length, noChange: rows.filter(r => r.state !== "error" && r.action === "skip").length,
});
export const ACADEMIC_REPORT_HEADERS = ["Row in your file", "Scholar ID", "Result", "Reason"];
export function academicSummaryText(set: number, reset: number, skipped: number, errors: number): string {
  return `${set.toLocaleString("en-US")} set, ${reset.toLocaleString("en-US")} taken away, ${skipped.toLocaleString("en-US")} unchanged, ${errors.toLocaleString("en-US")} error${errors === 1 ? "" : "s"}`;
}
