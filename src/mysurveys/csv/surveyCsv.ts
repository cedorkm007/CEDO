import {
  QUESTION_TYPES, isChoiceType, newId, newQuestion,
  type QuestionItem, type QuestionType, type SectionItem, type SurveyItem,
} from "../surveyTypes";
import { decodeCsvBytes, parseCsv } from "./csvText";

/**
 * The CSV template for "Create from Template (CSV)": what the template file
 * contains, and how an uploaded file is validated and turned into a survey.
 *
 * Everything here is pure (no DOM, no network) so it can be tested directly.
 * Problems are reported by SPREADSHEET ROW NUMBER (row 1 is the header row), so
 * what the message says matches what the person sees in Excel / Google Sheets.
 * Every row is validated before anything is created; if there is any error the
 * caller creates nothing.
 */

export const CSV_COLUMNS = [
  "section", "question_text", "question_type", "required", "options", "help_text",
  "scale_min", "scale_max", "scale_min_label", "scale_max_label",
] as const;
type Column = (typeof CSV_COLUMNS)[number];

const REQUIRED_COLUMNS: Column[] = ["question_text", "question_type"];

const MAX_FILE_BYTES = 1_000_000;
const MAX_ITEMS = 500; // same limit the server enforces (questions + sections)
const MAX_ERRORS_SHOWN = 200;

export const TEMPLATE_FILE_NAME = "my-surveys-template.csv";

// ── The template file ───────────────────────────────────────

const EXAMPLE_ROWS: string[][] = [
  ["Section 1", "What is your school?", "short_answer", "yes", "", "", "", "", "", ""],
  ["Section 1", "How satisfied are you?", "linear_scale", "yes", "", "", "1", "5", "Very poor", "Excellent"],
  ["Section 1", "Any comments or suggestions?", "paragraph", "no", "", "Optional - write as much as you like", "", "", "", ""],
  ["Section 2", "Which subjects do you teach?", "checkboxes", "no", "Math|Science|English", "", "", "", "", ""],
  ["Section 2", "What is your highest educational attainment?", "multiple_choice", "yes", "Bachelor's degree|Master's degree|Doctorate", "Choose one, then press Next", "", "", "", ""],
  ["Section 2", "Which barangay do you work in?", "dropdown", "yes", "Poblacion|San Isidro|Other", "", "", "", "", ""],
  ["Section 3", "How would you rate the training?", "rating", "no", "", "", "", "5", "", ""],
  ["Section 3", "When did you attend the training?", "date", "no", "", "", "", "", "", ""],
  ["Section 3", "What time did the session start?", "time", "no", "", "", "", "", "", ""],
];

const INSTRUCTIONS: string[] = [
  "HOW TO USE THIS TEMPLATE (rows that start with # are ignored)",
  "1. Keep row 1 (the column names). Replace the example rows above with your own questions - one question per row.",
  "2. section: groups questions. Each time the section name changes, a new section starts. Leave it blank to stay in the same section as the row above (or for no sections at all).",
  "3. question_type must be one of: short_answer, paragraph, multiple_choice, checkboxes, dropdown, linear_scale, rating, date, time.",
  "4. required: yes or no (blank means no).",
  "5. options: only for multiple_choice, checkboxes and dropdown. Separate the choices with | (at least 2), for example Math|Science|English.",
  "6. help_text: an optional hint shown under the question.",
  "7. scale_min / scale_max / scale_min_label / scale_max_label: only for linear_scale (starts at 0 or 1, ends at 2 to 10). For rating, scale_max is the number of stars (3 to 10, default 5).",
  "8. Save as CSV (UTF-8) and upload it under My Surveys > Create from Template (CSV). Nothing is created unless every row passes the checks.",
];

function csvCellOut(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** The template as CSV text: header row, one example per question type, then # instructions. */
export function buildTemplateCsv(): string {
  const lines: string[] = [CSV_COLUMNS.join(",")];
  for (const row of EXAMPLE_ROWS) lines.push(row.map(csvCellOut).join(","));
  lines.push("");
  for (const text of INSTRUCTIONS) lines.push(csvCellOut(`# ${text}`));
  return lines.join("\r\n");
}

// ── Reading an uploaded file ────────────────────────────────

export interface CsvIssue {
  /** Spreadsheet row number (header = 1). 0 = about the file as a whole. */
  row: number;
  message: string;
}

export interface CsvImportDoc {
  title: string;
  description: string;
  consentEnabled: boolean;
  consentText: string;
  items: SurveyItem[];
}

export type CsvParseResult =
  | { ok: true; doc: CsvImportDoc; questionCount: number; sectionCount: number; warnings: CsvIssue[]; notices: string[] }
  | { ok: false; errors: CsvIssue[]; totalErrors: number; warnings: CsvIssue[]; notices: string[] };

function clean(value: string | undefined): string {
  return (value ?? "").normalize("NFC").replace(/[\u00a0\u200b]/g, " ").trim();
}

const HEADER_ALIASES: Record<string, Column> = {
  question: "question_text",
  type: "question_type",
  "required?": "required",
};

function normalizeHeader(raw: string): string {
  const h = clean(raw).replace(/^\ufeff/, "").toLowerCase()
    .replace(/\(.*?\)/g, "")      // "required (yes/no)" -> "required"
    .trim()
    .replace(/[\s-]+/g, "_");
  return h;
}
function columnFor(raw: string): Column | null {
  const h = normalizeHeader(raw);
  if ((CSV_COLUMNS as readonly string[]).includes(h)) return h as Column;
  return HEADER_ALIASES[h] ?? null;
}

const isBlankRow = (r: string[]) => r.every(c => clean(c) === "");
/** "# some note" in the first cell, nothing else in the row (Excel pads comment rows with empty cells). */
const isCommentRow = (r: string[]) => clean(r[0]).startsWith("#") && r.slice(1).every(c => clean(c) === "");

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

const TYPE_ALIASES: Record<string, QuestionType> = { checkbox: "checkboxes", check_boxes: "checkboxes" };

function normalizeType(raw: string): { type: QuestionType | null; shown: string; suggestion: QuestionType | null } {
  const shown = clean(raw);
  const key = shown.toLowerCase().replace(/[\s-]+/g, "_");
  if ((QUESTION_TYPES as string[]).includes(key)) return { type: key as QuestionType, shown, suggestion: null };
  if (TYPE_ALIASES[key]) return { type: TYPE_ALIASES[key], shown, suggestion: null };
  let best: QuestionType | null = null;
  let bestDistance = 99;
  for (const t of QUESTION_TYPES) {
    const d = levenshtein(key, t);
    if (d < bestDistance) { bestDistance = d; best = t; }
  }
  return { type: null, shown, suggestion: best && bestDistance <= 3 ? best : null };
}

function suggestedTitleFrom(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!base || /template/i.test(base)) return "Untitled survey";
  return base.slice(0, 200);
}

/** Pick the separator whose first real row has the most recognised column names (comma wins ties). */
function chooseDelimiter(text: string): string {
  let best = ",";
  let bestScore = -1;
  for (const d of [",", ";", "\t"]) {
    const { rows } = parseCsv(text, d);
    const header = rows.find(r => !isBlankRow(r) && !isCommentRow(r));
    const score = header ? header.filter(c => columnFor(c) !== null).length : 0;
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

export function parseSurveyCsv(bytes: Uint8Array, fileName: string): CsvParseResult {
  const errors: CsvIssue[] = [];
  const warnings: CsvIssue[] = [];
  const notices: string[] = [];
  let totalErrors = 0;
  const err = (row: number, message: string) => { totalErrors += 1; if (errors.length < MAX_ERRORS_SHOWN) errors.push({ row, message }); };
  const warn = (row: number, message: string) => { warnings.push({ row, message }); };
  const fail = (): CsvParseResult => ({ ok: false, errors, totalErrors, warnings, notices });

  if (bytes.length === 0) { err(0, "The file is empty."); return fail(); }
  if (bytes.length > MAX_FILE_BYTES) { err(0, "The file is too large (over 1 MB). A survey template should be far smaller than that."); return fail(); }

  const decoded = decodeCsvBytes(bytes);
  if (decoded.encoding === "windows-1252") {
    notices.push("This file was not saved as UTF-8, so it was read as Windows-1252. If accented or special letters look wrong, re-save it as “CSV UTF-8” and upload it again.");
  }
  const text = decoded.text.replace(/^\ufeff/, "");

  const delimiter = chooseDelimiter(text);
  const { rows, unclosedQuote } = parseCsv(text, delimiter);
  if (unclosedQuote) {
    err(0, "A quoted cell is never closed - the file has a stray double-quote (\") character. Check the cells near the end of the file.");
    return fail();
  }

  const headerIndex = rows.findIndex(r => !isBlankRow(r) && !isCommentRow(r));
  if (headerIndex === -1) { err(0, "The file has no column names or questions in it."); return fail(); }

  // ── header ──
  const headerRowNumber = headerIndex + 1;
  const colIndex: Partial<Record<Column, number>> = {};
  rows[headerIndex].forEach((raw, i) => {
    if (clean(raw) === "") return;
    const col = columnFor(raw);
    if (!col) { warn(headerRowNumber, `Column “${clean(raw)}” isn't one of the template columns, so it was ignored.`); return; }
    if (colIndex[col] !== undefined) { err(headerRowNumber, `The column “${col}” appears twice.`); return; }
    colIndex[col] = i;
  });
  for (const col of REQUIRED_COLUMNS) {
    if (colIndex[col] === undefined) {
      err(headerRowNumber, `Missing column “${col}”. Row ${headerRowNumber} must contain the template's column names: ${CSV_COLUMNS.join(", ")}.`);
    }
  }
  if (errors.length > 0) return fail();

  const get = (row: string[], col: Column): string => (colIndex[col] === undefined ? "" : clean(row[colIndex[col]!]));

  // ── data rows ──
  const items: SurveyItem[] = [];
  let questionCount = 0;
  let sectionCount = 0;
  let currentSection = "";
  const seenSections = new Set<string>();
  const seenQuestions = new Map<string, number>();

  for (let r = headerIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    if (isBlankRow(row) || isCommentRow(row)) continue;
    const rowNo = r + 1;
    const startErrors = totalErrors;

    // question_text
    const qText = get(row, "question_text");
    if (qText === "") err(rowNo, "question_text is empty. Every row needs a question.");
    else if (qText.length > 2000) err(rowNo, `question_text is too long (${qText.length} characters; the limit is 2000).`);

    // question_type
    const t = normalizeType(get(row, "question_type"));
    if (t.shown === "") err(rowNo, "question_type is empty. Use one of: " + QUESTION_TYPES.join(", ") + ".");
    else if (!t.type) {
      err(rowNo, `unknown question_type '${t.shown}'.${t.suggestion ? ` Did you mean '${t.suggestion}'?` : ""} Use one of: ${QUESTION_TYPES.join(", ")}.`);
    }

    // required
    const reqRaw = get(row, "required");
    let required = false;
    if (reqRaw !== "") {
      if (/^(yes|y|true|1)$/i.test(reqRaw)) required = true;
      else if (/^(no|n|false|0)$/i.test(reqRaw)) required = false;
      else err(rowNo, `required must be yes or no (found '${reqRaw}').`);
    }

    // help_text
    const help = get(row, "help_text");
    if (help.length > 1000) err(rowNo, `help_text is too long (${help.length} characters; the limit is 1000).`);

    // section
    const section = get(row, "section");
    if (section.length > 200) err(rowNo, `section is too long (${section.length} characters; the limit is 200).`);

    // type-specific fields
    const type = t.type;
    let options: string[] = [];
    let scaleMin: number | null = null;
    let scaleMax: number | null = null;
    let minLabel = "";
    let maxLabel = "";

    const optionsRaw = get(row, "options");
    const scaleCells = (["scale_min", "scale_max", "scale_min_label", "scale_max_label"] as Column[]).filter(c => get(row, c) !== "");

    if (type && isChoiceType(type)) {
      const parts = optionsRaw === "" ? [] : optionsRaw.split("|").map(clean);
      while (parts.length && parts[0] === "") parts.shift();
      while (parts.length && parts[parts.length - 1] === "") parts.pop();
      if (parts.some(p => p === "")) {
        err(rowNo, "options has an empty choice (two | in a row). Separate choices with a single | like Math|Science|English.");
      } else if (parts.length < 2) {
        err(rowNo, `options needs at least 2 choices separated by | for a ${type} question (found ${parts.length}).`);
      } else if (parts.length > 100) {
        err(rowNo, `options has ${parts.length} choices; the limit is 100.`);
      } else {
        const seen = new Set<string>();
        for (const p of parts) {
          const k = p.toLowerCase();
          if (seen.has(k)) err(rowNo, `options lists '${p}' more than once.`);
          seen.add(k);
          if (p.length > 500) err(rowNo, `an option is too long (${p.length} characters; the limit is 500).`);
        }
        options = parts;
      }
      if (scaleCells.length > 0) warn(rowNo, `scale columns are ignored for ${type} questions.`);
    } else if (type) {
      if (optionsRaw !== "") warn(rowNo, `options are ignored for ${type} questions.`);
    }

    const readInt = (col: Column): number | null | "bad" => {
      const raw = get(row, col);
      if (raw === "") return null;
      if (/^\d+(\.0+)?$/.test(raw)) return Number(raw.split(".")[0]);
      err(rowNo, `${col} must be a whole number (found '${raw}').`);
      return "bad";
    };

    if (type === "linear_scale") {
      const minV = readInt("scale_min");
      const maxV = readInt("scale_max");
      const min = minV === "bad" ? null : (minV ?? 1);
      const max = maxV === "bad" ? null : (maxV ?? 5);
      if (min !== null && min !== 0 && min !== 1) err(rowNo, `scale_min must be 0 or 1 (found '${min}').`);
      if (max !== null && (max < 2 || max > 10)) err(rowNo, `scale_max must be between 2 and 10 (found '${max}').`);
      scaleMin = min; scaleMax = max;
      minLabel = get(row, "scale_min_label");
      maxLabel = get(row, "scale_max_label");
      if (minLabel.length > 100) err(rowNo, "scale_min_label is too long (limit 100 characters).");
      if (maxLabel.length > 100) err(rowNo, "scale_max_label is too long (limit 100 characters).");
    } else if (type === "rating") {
      const minV = readInt("scale_min");
      const maxV = readInt("scale_max");
      if (minV !== null && minV !== "bad" && minV !== 1) err(rowNo, `a rating always starts at 1 - leave scale_min blank (found '${minV}').`);
      const max = maxV === "bad" ? null : (maxV ?? 5);
      if (max !== null && (max < 3 || max > 10)) err(rowNo, `for a rating, scale_max is the number of stars and must be between 3 and 10 (found '${max}').`);
      scaleMin = 1; scaleMax = max;
      if (get(row, "scale_min_label") !== "" || get(row, "scale_max_label") !== "") warn(rowNo, "scale labels are ignored for rating questions.");
    } else if (type && scaleCells.length > 0 && !isChoiceType(type)) {
      warn(rowNo, `scale columns are ignored for ${type} questions.`);
    }

    if (totalErrors > startErrors) continue; // this row has problems: keep checking the others, but build nothing from it

    // ── section header ──
    if (section !== "" && section !== currentSection) {
      if (seenSections.has(section)) warn(rowNo, `Section “${section}” appears again after other sections, so a second section with the same title is created.`);
      seenSections.add(section);
      currentSection = section;
      const header: SectionItem = { kind: "section", id: newId(), title: section, description: "" };
      items.push(header);
      sectionCount += 1;
    }

    // ── question ──
    const dupKey = qText.toLowerCase();
    const firstRow = seenQuestions.get(dupKey);
    if (firstRow !== undefined) warn(rowNo, `This question has the same text as row ${firstRow}.`);
    else seenQuestions.set(dupKey, rowNo);

    const q: QuestionItem = newQuestion(type!);
    q.text = qText;
    q.helpText = help;
    q.required = required;
    q.options = options.map(label => ({ id: newId(), label }));
    q.scaleMin = scaleMin;
    q.scaleMax = scaleMax;
    q.scaleMinLabel = type === "linear_scale" ? minLabel : "";
    q.scaleMaxLabel = type === "linear_scale" ? maxLabel : "";
    items.push(q);
    questionCount += 1;
  }

  if (totalErrors === 0) {
    if (questionCount === 0) err(0, `No questions found. Add at least one question in the rows below the column names (row ${headerRowNumber}).`);
    else if (items.length > MAX_ITEMS) err(0, `Too many rows: a survey can have at most ${MAX_ITEMS} questions and sections together (this file has ${items.length}).`);
  }
  if (totalErrors > 0) return fail();

  return {
    ok: true,
    doc: { title: suggestedTitleFrom(fileName), description: "", consentEnabled: false, consentText: "", items },
    questionCount, sectionCount, warnings, notices,
  };
}
