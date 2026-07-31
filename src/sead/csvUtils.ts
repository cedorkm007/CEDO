/**
 * Minimal browser-side CSV parser/writer used by the bulk-upload modals
 * (bulk questions, bulk scholars). No external dependency — same
 * handles-quoted-fields approach as scripts/import-scholars-from-csv.mjs,
 * just running in the browser instead of Node.
 */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\r") { /* skip, \n handles the line break */ }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(cell => cell.trim() !== ""));
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function toCsv(headers: string[], rows: (string | number)[][]): string {
  const lines = [headers.map(h => csvEscape(String(h))).join(",")];
  for (const r of rows) lines.push(r.map(v => csvEscape(v === undefined || v === null ? "" : String(v))).join(","));
  return lines.join("\r\n");
}

/** Triggers a browser download of CSV content. */
export function downloadCsv(filename: string, csvContent: string) {
  // Leading BOM so Excel opens UTF-8 CSVs without mangling special characters.
  const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Finds the column index for a field given a list of acceptable header spellings. */
export function findColumn(normalizedHeaders: string[], aliases: string[]): number {
  return normalizedHeaders.findIndex(h => aliases.includes(h));
}

export function cell(row: string[], idx: number): string {
  return idx === -1 ? "" : (row[idx] ?? "").trim();
}
