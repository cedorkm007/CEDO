/**
 * Turns the raw rows from get_my_survey_export_page into a table (one row per
 * response, one column per question VERSION) and into CSV text. Pure functions
 * -- no DOM, no network -- so they can be tested directly.
 *
 * Question versions: a question that was reworded after people had answered it
 * exports as separate columns ("Q3 (v1). old wording", "Q3 (v2). new wording"),
 * and each response only has a value in the version it answered. A question that
 * was removed from the survey keeps its column, tagged "[removed]".
 */

export interface ExportQuestion {
  questionId: string;
  questionKey: string;
  version: number;
  archived: boolean;
  type: string;
  text: string;
  orderIndex: number;
}

export interface ExportResponse {
  id: string;
  submittedAt: string;
  consentGiven: boolean;
  /** question id -> answer text (choice answers already turned into option labels). */
  answers: Record<string, string>;
}

export interface ExportData {
  title: string;
  consentEnabled: boolean;
  questions: ExportQuestion[];
  responses: ExportResponse[];
}

export type Cell = string | number | null;

export interface ColumnInfo {
  header: string;
  question: string;
  type: string;
  version: number;
  status: "current" | "replaced" | "removed";
  answered: number;
}

export interface ExportTable {
  headers: string[];
  rows: Cell[][];
  /** One entry per QUESTION column (not the leading Response # / Submitted at / Consent columns). */
  columns: ColumnInfo[];
}

const NUMERIC_TYPES = new Set(["linear_scale", "rating"]);

function pad(n: number): string { return String(n).padStart(2, "0"); }

/** Local time as "YYYY-MM-DD HH:mm:ss" -- what a person reading the sheet expects. */
export function formatLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function oneLine(text: string, max = 200): string {
  const flat = text.replace(/\s+/g, " ").trim() || "Untitled question";
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function buildExportTable(data: ExportData): ExportTable {
  // Group versions of the same question, keeping survey order (by each group's newest version).
  const byKey = new Map<string, ExportQuestion[]>();
  for (const q of data.questions) {
    const list = byKey.get(q.questionKey) ?? [];
    list.push(q);
    byKey.set(q.questionKey, list);
  }
  const position = new Map(data.questions.map((q, i) => [q.questionId, i]));
  const groups = [...byKey.values()]
    .map(list => [...list].sort((a, b) => a.version - b.version))
    .sort((a, b) => (position.get(a[a.length - 1].questionId) ?? 0) - (position.get(b[b.length - 1].questionId) ?? 0));

  const columns: { q: ExportQuestion; info: ColumnInfo }[] = [];
  groups.forEach((versions, gi) => {
    const n = gi + 1;
    const removed = versions.every(v => v.archived);
    versions.forEach((q, vi) => {
      const isLast = vi === versions.length - 1;
      const label = versions.length > 1 ? `Q${n} (v${q.version})` : `Q${n}`;
      const header = `${label}. ${oneLine(q.text)}${removed && isLast ? " [removed]" : ""}`;
      const answered = data.responses.reduce((s, r) => s + (r.answers[q.questionId] !== undefined ? 1 : 0), 0);
      columns.push({
        q,
        info: {
          header, question: q.text, type: q.type, version: q.version, answered,
          status: removed && isLast ? "removed" : isLast ? "current" : "replaced",
        },
      });
    });
  });

  const headers = ["Response #", "Submitted at", ...(data.consentEnabled ? ["Consent given"] : []), ...columns.map(c => c.info.header)];
  const rows: Cell[][] = data.responses.map((r, i) => [
    i + 1,
    formatLocal(r.submittedAt),
    ...(data.consentEnabled ? [r.consentGiven ? "Yes" : "No"] : []),
    ...columns.map(({ q }): Cell => {
      const raw = r.answers[q.questionId];
      if (raw === undefined || raw === null) return null;
      if (NUMERIC_TYPES.has(q.type)) { const n = Number(raw); return Number.isFinite(n) ? n : raw; }
      return raw;
    }),
  ]);
  return { headers, rows, columns: columns.map(c => c.info) };
}

// ── CSV ─────────────────────────────────────────────────────

/**
 * Anonymous respondents type the free text in a survey, and a spreadsheet
 * treats a cell that starts with = + - @ (or a tab / carriage return) as a
 * FORMULA when a CSV is opened -- "CSV injection". So such text gets a leading
 * apostrophe, which stops it being evaluated. Plain numbers like -5 or +639171234567 are left alone.
 */
export function safeForSpreadsheet(value: string): string {
  if (/^[=+\-@\t\r]/.test(value) && !/^[+-]?\d+(\.\d+)?$/.test(value)) return `'${value}`;
  return value;
}

function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsvText(table: ExportTable): string {
  const line = (cells: Cell[]) =>
    cells.map(c => (c === null ? "" : typeof c === "number" ? String(c) : csvEscape(safeForSpreadsheet(c)))).join(",");
  return [line(table.headers), ...table.rows.map(line)].join("\r\n");
}

/** A safe file name from the survey title: "Teacher Survey 2026!" -> "Teacher-Survey-2026". */
export function exportFileBase(title: string, today = new Date()): string {
  const slug = title.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "survey";
  return `${slug}-responses-${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
}
