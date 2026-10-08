/**
 * Low-level CSV reading for "Create from Template (CSV)". Dependency-free and
 * free of any browser APIs beyond TextDecoder, so it can be unit-tested in Node.
 *
 * Deals with what real-world spreadsheet exports do:
 *  - UTF-8 with or without a BOM (Excel's "CSV UTF-8" adds one; Google Sheets doesn't)
 *  - UTF-16 (Excel's "Unicode Text"), detected by its BOM
 *  - Windows-1252 (Excel's plain "CSV (Comma delimited)" on Windows) as a fallback
 *  - CRLF, LF and CR line endings
 *  - quoted cells containing commas, doubled quotes ("") and line breaks
 *  - ';' or tab separators (Excel in many locales) -- chosen by the caller
 *
 * Unlike src/sead/csvUtils.ts this never drops blank lines, because the caller
 * reports problems by spreadsheet row number and every record must keep its place.
 */

export type CsvEncoding = "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";

export function decodeCsvBytes(bytes: Uint8Array): { text: string; encoding: CsvEncoding } {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), encoding: "utf-8" };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder("utf-16le").decode(bytes.subarray(2)), encoding: "utf-16le" };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder("utf-16be").decode(bytes.subarray(2)), encoding: "utf-16be" };
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    // Not valid UTF-8: almost certainly Excel's legacy "CSV (Comma delimited)" on Windows.
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252" };
  }
}

export interface ParsedCsv {
  /** One entry per record, blank lines included, so index + 1 is the spreadsheet row number. */
  rows: string[][];
  /** True when a quoted cell was never closed (a stray " in the file). */
  unclosedQuote: boolean;
}

export function parseCsv(text: string, delimiter: string): ParsedCsv {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const n = text.length;

  for (let i = 0; i < n; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } // "" inside quotes is a literal quote
        else inQuotes = false;
      } else {
        field += c; // commas and line breaks inside quotes are part of the cell
      }
      continue;
    }
    if (c === '"' && field.trim() === "") { field = ""; inQuotes = true; continue; } // a quote only opens a cell at its start
    if (c === delimiter) { row.push(field); field = ""; continue; }
    if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += c;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return { rows, unclosedQuote: inQuotes };
}
