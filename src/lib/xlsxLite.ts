// ─────────────────────────────────────────────────────────────
// src/lib/xlsxLite.ts
// A small reader and writer for .xlsx files (a zip of XML files), built on JSZip, which the app already carries. No Supabase / React.
//   * readXlsx: the first sheet as a grid of text (row by row, column by column; empty cells are "").
//   * buildXlsx: one sheet with merged cells, column widths and a few looks (bold, shaded, framed), for the School Portal's grade template.
// JSZip is loaded only when a file is read or written, so it is not part of the first page load.
// ─────────────────────────────────────────────────────────────

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    if (e[0] === "#") { const code = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(code) ? String.fromCodePoint(code) : ""; }
    return XML_ENTITIES[e] ?? "";
  });
}
const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// control characters other than tab / new line are not allowed in XML
const cleanText = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

/** "AB12" -> { col: 27 (zero-based), row: 11 (zero-based) } */
export function cellRef(ref: string): { col: number; row: number } | null {
  const m = /^([A-Z]+)(\d+)$/.exec(ref.toUpperCase());
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: Number(m[2]) - 1 };
}
export function columnLetters(index: number): string {
  let n = index + 1, out = "";
  while (n > 0) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); }
  return out;
}

/** Text inside <t> tags of one <si> / <is> block (rich text has several pieces; phonetic hints are skipped). */
function textOf(block: string): string {
  const withoutPhonetic = block.replace(/<rPh[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of withoutPhonetic.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += unescapeXml(m[1]);
  return out;
}

/** The first sheet of an .xlsx file as rows of text. Numbers come back as written in the file (1.5 -> "1.5"); a formula gives its last result. */
export async function readXlsx(data: ArrayBuffer | Uint8Array): Promise<string[][]> {
  const { default: JSZip } = await import("jszip");
  let zip;
  try { zip = await JSZip.loadAsync(data); } catch { throw new Error("That does not look like an Excel (.xlsx) file."); }
  const file = (name: string) => zip.file(name);

  // which file holds the first sheet: workbook.xml says "rId1", the relationships file says where that is
  let sheetPath = "xl/worksheets/sheet1.xml";
  const wb = await file("xl/workbook.xml")?.async("string");
  const rels = await file("xl/_rels/workbook.xml.rels")?.async("string");
  if (wb && rels) {
    const first = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(wb)?.[1];
    if (first) {
      for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
        if (new RegExp(`\\bId="${first}"`).test(m[0])) {
          const target = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
          if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
        }
      }
    }
  }
  const sheetXml = await file(sheetPath)?.async("string");
  if (!sheetXml) throw new Error("The Excel file has no sheet to read.");

  const sharedXml = await file("xl/sharedStrings.xml")?.async("string");
  const shared: string[] = sharedXml ? [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(m => textOf(m[1])) : [];

  const grid: string[][] = [];
  let nextRow = 0;
  for (const rowMatch of sheetXml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowIndex = Number(/\br="(\d+)"/.exec(rowMatch[1])?.[1] ?? nextRow + 1) - 1;
    nextRow = rowIndex + 1;
    const body = rowMatch[2] ?? "";
    const cells: string[] = [];
    let nextCol = 0;
    for (const c of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1], inner = c[2] ?? "";
      const ref = /\br="([A-Za-z]+\d+)"/.exec(attrs)?.[1];
      const col = ref ? cellRef(ref)?.col ?? nextCol : nextCol;
      nextCol = col + 1;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? "n";
      let value = "";
      if (type === "inlineStr") value = textOf(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? "");
      else {
        const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        if (v !== undefined) {
          if (type === "s") value = shared[Number(v)] ?? "";
          else if (type === "b") value = v.trim() === "1" ? "TRUE" : "FALSE";
          else value = unescapeXml(v);
        }
      }
      while (cells.length < col) cells.push("");
      cells[col] = value;
    }
    while (grid.length < rowIndex) grid.push([]);
    grid[rowIndex] = cells;
  }
  return grid;
}

// ── Writing ──────────────────────────────────────────────────
export type XlsxStyle = "normal" | "bold" | "title" | "header" | "box";
export interface XlsxCell { value: string | number | null; style?: XlsxStyle }
export interface XlsxSheet {
  name: string;
  /** Rows of cells; a plain string or number uses the normal look. */
  rows: (XlsxCell | string | number | null)[][];
  /** Merged ranges such as "A1:O1". */
  merges?: string[];
  /** Column widths in characters, from column A. */
  widths?: number[];
}

const STYLE_INDEX: Record<XlsxStyle, number> = { normal: 0, bold: 1, title: 2, header: 3, box: 4 };

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCE6F1"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** One sheet as an .xlsx file. Every value is written as text (the "box" look is formatted as text too), so a Student No. such as 00123 or a grade such as 1.50 stays as typed. */
export async function buildXlsx(sheet: XlsxSheet): Promise<Uint8Array> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  const name = escapeXml(cleanText(sheet.name).replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet1");
  zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file("xl/styles.xml", STYLES_XML);

  const cols = (sheet.widths ?? []).length
    ? `<cols>${(sheet.widths ?? []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
  const rowsXml = sheet.rows.map((row, r) => {
    const cells = row.map((raw, c) => {
      const cell: XlsxCell = raw !== null && typeof raw === "object" ? raw : { value: raw };
      if (cell.value === null || cell.value === "") {
        return cell.style && cell.style !== "normal" ? `<c r="${columnLetters(c)}${r + 1}" s="${STYLE_INDEX[cell.style]}"/>` : "";
      }
      const style = STYLE_INDEX[cell.style ?? "normal"];
      return `<c r="${columnLetters(c)}${r + 1}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cleanText(String(cell.value)))}</t></is></c>`;
    }).join("");
    return cells ? `<row r="${r + 1}">${cells}</row>` : "";
  }).join("");
  const merges = (sheet.merges ?? []).length ? `<mergeCells count="${sheet.merges!.length}">${sheet.merges!.map(m => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : "";
  zip.file("xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rowsXml}</sheetData>${merges}</worksheet>`);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
