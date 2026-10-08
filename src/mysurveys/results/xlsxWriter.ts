import type { Cell } from "./exportTable";

/**
 * A small, dependency-light .xlsx writer (an .xlsx file is a zip of XML parts).
 * Uses jszip, which the project already ships, and is loaded only when someone
 * actually clicks "Excel" -- it never reaches the public survey page.
 *
 * Text is written as inline strings (never as formulas), so respondents' free
 * text can't execute in Excel; numbers are written as real numbers so scale and
 * rating columns can be summed and averaged straight away. The first row is
 * bold and frozen, and columns are sized to their content.
 */

export interface XlsxSheet {
  name: string;
  headers: string[];
  rows: Cell[][];
}

const MAX_CELL_CHARS = 32767; // Excel's limit for one cell

function xmlEscape(s: string): string {
  return s
    // characters XML 1.0 cannot contain at all
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function columnName(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); }
  return out;
}

function sheetName(raw: string, used: Set<string>): string {
  let base = raw.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Sheet";
  let name = base, i = 2;
  while (used.has(name.toLowerCase())) { name = `${base.slice(0, 28)} ${i++}`; }
  used.add(name.toLowerCase());
  base = name;
  return base;
}

// Cell styles: 0 = normal, 1 = bold header, 2 = wrapped text (long / multi-line answers).
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function sheetXml(sheet: XlsxSheet): string {
  const all: Cell[][] = [sheet.headers, ...sheet.rows];
  const widths = sheet.headers.map(h => Math.min(Math.max(h.length, 10), 60));
  for (const row of sheet.rows) row.forEach((c, i) => {
    const len = c === null ? 0 : String(c).split("\n")[0].length;
    if (len + 2 > widths[i]) widths[i] = Math.min(len + 2, 60);
  });

  const rowsXml = all.map((row, r) => {
    const cells = row.map((value, c) => {
      if (value === null || value === "") return "";
      const ref = `${columnName(c)}${r + 1}`;
      if (typeof value === "number") return `<c r="${ref}"><v>${value}</v></c>`;
      const text = value.length > MAX_CELL_CHARS ? `${value.slice(0, MAX_CELL_CHARS - 1)}…` : value;
      const style = r === 0 ? 1 : (text.includes("\n") || text.length > 60 ? 2 : 0);
      return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ""}><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
    }).join("");
    return `<row r="${r + 1}">${cells}</row>`;
  }).join("");

  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols}</cols>
<sheetData>${rowsXml}</sheetData>
</worksheet>`;
}

/** The finished workbook as bytes (callers wrap it in a Blob to download it). */
export async function buildXlsxBytes(sheets: XlsxSheet[]): Promise<Uint8Array> {
  const { default: JSZip } = await import("jszip");
  const used = new Set<string>();
  const names = sheets.map(s => sheetName(s.name, used));

  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("\n")}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);
  zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${names.map((n, i) => `<sheet name="${xmlEscape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>
</workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("\n")}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);
  zip.file("xl/styles.xml", STYLES_XML);
  sheets.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)));

  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
