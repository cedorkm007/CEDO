// ─────────────────────────────────────────────────────────────
// src/lib/renewalEnrollment.ts
// Scholar Renewal > Renewed: the "Enrollment confirmation" tick box, and the EXPORT of the confirmed enrolled as an allowance endorsement sheet (an .xlsx laid out like the office's own
// "ALLOWANCE ENDORSEMENT" sheet: a title bar, a batch line, NAME OF SCHOLAR | YEAR | COURSE | BARANGAY | SCHOOL | REMARKS, and the PREPARED BY / CHECKED BY block).
// Plain helpers (no Supabase / React) so tests can run them alone; JSZip is loaded only when the file is written. Nothing here decides who is on the list: the database does.
// ─────────────────────────────────────────────────────────────

/** One scholar of the export, as the database gives it (supabase_migration_renewal_enrollment_confirmation.sql). */
export interface EnrollmentExportRow { scholarIdNumber: string; lastName: string; firstName: string; middleName: string; yearLevel: string; program: string; barangay: string; school: string; renewedOn: string }

/** One person of the signature block. */
export interface Signatory { name: string; title: string; unit: string }
export interface EndorsementOptions {
  /** The line under the title, for example "3RD BATCH-OCTOBER 25, 2026". */
  batchLabel: string;
  preparedBy: Signatory; checkedBy: Signatory;
}

/** The names and offices on the office's own sheet. They are only the starting values: the export window lets the staff change them. */
export const DEFAULT_PREPARED_BY: Signatory = { name: "MANILYN Y. IGMEN", title: "Administrative Officer II", unit: "Academic Contract and Administrative Service" };
export const DEFAULT_CHECKED_BY: Signatory = { name: "ROXANNE JUL L. TANDANG", title: "Division Head", unit: "Scholarships and Educational Assistance Division" };

export const ENDORSEMENT_HEADERS = ["NAME OF SCHOLAR", "YEAR", "COURSE", "BARANGAY", "SCHOOL", "REMARKS"] as const;
/** Column widths of the office's sheet (characters). */
export const ENDORSEMENT_WIDTHS = [45.29, 14.43, 22.14, 31, 25.71, 25.71] as const;
export const ENDORSEMENT_TITLE = "ALLOWANCE ENDORSEMENT";

/** "ABA", "RACHEL", "SANTOS" -> "ABA, RACHEL S." (upper case, middle name as an initial). */
export function endorsementName(r: Pick<EnrollmentExportRow, "lastName" | "firstName" | "middleName">): string {
  const last = r.lastName.trim().replace(/\s+/g, " "), first = r.firstName.trim().replace(/\s+/g, " "), mid = r.middleName.trim();
  const initial = mid ? `${mid[0]}.` : "";
  return `${last}, ${first}${initial ? ` ${initial}` : ""}`.toUpperCase();
}

/** "3rd Year" -> 3; nothing that has a number -> null (the sheet then shows the text as it is). */
export function yearNumber(yearLevel: string): number | null {
  const m = /\d+/.exec(yearLevel ?? "");
  return m ? Number(m[0]) : null;
}

const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
const parts = (day: string): { y: number; m: number; d: number } | null => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day); return m ? { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) } : null; };
export function isDay(s: string): boolean { const p = parts(s); return !!p && p.m >= 0 && p.m < 12 && p.d >= 1 && p.d <= new Date(p.y, p.m + 1, 0).getDate(); }

/** "2026-11-17" / "2026-11-20" -> "NOVEMBER 17 - 20, 2026"; one day -> "NOVEMBER 17, 2026"; over a month or a year -> both ends in full. */
export function rangeLabel(from: string, to: string): string {
  const a = parts(from), b = parts(to);
  if (!a && !b) return "";
  if (!a || !b) { const p = (a ?? b)!; return `${MONTHS[p.m]} ${p.d}, ${p.y}`; }
  if (from === to) return `${MONTHS[a.m]} ${a.d}, ${a.y}`;
  if (a.y === b.y && a.m === b.m) return `${MONTHS[a.m]} ${a.d} - ${b.d}, ${a.y}`;
  if (a.y === b.y) return `${MONTHS[a.m]} ${a.d} - ${MONTHS[b.m]} ${b.d}, ${a.y}`;
  return `${MONTHS[a.m]} ${a.d}, ${a.y} - ${MONTHS[b.m]} ${b.d}, ${b.y}`;
}

/** The line under the title when the staff do not type a batch label of their own. */
export function defaultBatchLabel(term: string, schoolYear: string, from: string, to: string): string {
  const range = rangeLabel(from, to);
  return `${term} ${schoolYear}${range ? ` - RENEWED ${range}` : ""}`.toUpperCase();
}

/** "Allowance-Endorsement-1st-Semester-2026-2027_2026-11-17_to_2026-11-20.xlsx" */
export function endorsementFileName(term: string, schoolYear: string, from: string, to: string): string {
  const base = `Allowance-Endorsement-${term}-${schoolYear}`.replace(/[^A-Za-z0-9-]+/g, "-").replace(/-+/g, "-");
  const range = from && to ? (from === to ? `_${from}` : `_${from}_to_${to}`) : from ? `_from_${from}` : to ? `_until_${to}` : "";
  return `${base}${range}.xlsx`;
}

/** The text and number cells of the sheet, row by row (what the file will contain), so a test can read them without opening Excel. */
export type SheetCell = string | number | null;
export function endorsementGrid(rows: EnrollmentExportRow[], o: EndorsementOptions): { header: SheetCell[]; body: SheetCell[][]; footer: SheetCell[][] } {
  const body = rows.map((r): SheetCell[] => [endorsementName(r), yearNumber(r.yearLevel) ?? (r.yearLevel.trim() || null), r.program.trim() || null, r.barangay.trim().toUpperCase() || null, r.school.trim() || null, null]);
  const col = (a: string, d: string): SheetCell[] => [a || null, null, null, d || null, null, null];
  const footer: SheetCell[][] = [
    ["PREPARED BY:", null, null, "CHECKED BY:", null, null],
    [],
    col(o.preparedBy.name, o.checkedBy.name),
    col(o.preparedBy.title, o.checkedBy.title),
    col(o.preparedBy.unit, o.checkedBy.unit),
  ];
  return { header: [...ENDORSEMENT_HEADERS], body, footer };
}

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cleanText = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const LETTERS = ["A", "B", "C", "D", "E", "F"];

// cell looks (positions in cellXfs below)
const X = { plain: 0, title: 1, batch: 2, header: 3, text: 4, number: 5, center: 6, signLabel: 7, signName: 8 } as const;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="6">
<font><sz val="11"/><color rgb="FF000000"/><name val="Calibri"/></font>
<font><b/><sz val="16"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><b/><sz val="13"/><color rgb="FFFFF2CC"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><b/><u/><sz val="12"/><color rgb="FF000000"/><name val="Calibri"/></font>
<font><b/><sz val="12"/><color rgb="FF000000"/><name val="Calibri"/></font>
</fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF073763"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right><top style="thin"><color rgb="FF000000"/></top><bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function cellXml(ref: string, value: SheetCell, style: number): string {
  if (value === null || value === "") return style ? `<c r="${ref}" s="${style}"/>` : "";
  if (typeof value === "number") return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cleanText(value))}</t></is></c>`;
}

/** The sheet as an .xlsx file. The names and the school are written as text; the year as a number (like the office's sheet). */
export async function buildEndorsementXlsx(rows: EnrollmentExportRow[], o: EndorsementOptions): Promise<Uint8Array> {
  const { default: JSZip } = await import("jszip");
  const g = endorsementGrid(rows, o);
  const out: string[] = [];
  const push = (r: number, cells: string, height?: number) => out.push(`<row r="${r}"${height ? ` ht="${height}" customHeight="1"` : ""}>${cells}</row>`);
  push(1, cellXml("A1", ENDORSEMENT_TITLE, X.title) + LETTERS.slice(1).map(l => cellXml(`${l}1`, null, X.title)).join(""), 30);
  push(2, cellXml("A2", o.batchLabel.trim() || null, X.batch) + LETTERS.slice(1).map(l => cellXml(`${l}2`, null, X.batch)).join(""), 24);
  push(4, g.header.map((h, i) => cellXml(`${LETTERS[i]}4`, h, X.header)).join(""), 24);
  let r = 5;
  for (const line of g.body) {
    push(r, line.map((v, i) => cellXml(`${LETTERS[i]}${r}`, v, i === 1 ? X.number : X.text)).join(""), 20);
    r++;
  }
  r += 1;       // one empty row before the signature block
  g.footer.forEach((line, k) => {
    if (line.length) push(r, line.map((v, i) => cellXml(`${LETTERS[i]}${r}`, v, k === 0 ? X.signLabel : k === 2 ? X.signName : X.plain)).join(""));
    r++;
  });

  const cols = `<cols>${ENDORSEMENT_WIDTHS.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`;
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:F${r}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A5" sqref="A5"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${out.join("")}</sheetData><mergeCells count="2"><mergeCell ref="A1:F1"/><mergeCell ref="A2:F2"/></mergeCells><pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;

  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${ENDORSEMENT_TITLE}" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">'${ENDORSEMENT_TITLE}'!$4:$4</definedName><definedName name="_xlnm.Print_Area" localSheetId="0">'${ENDORSEMENT_TITLE}'!$A$1:$F$${r}</definedName></definedNames></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file("xl/styles.xml", STYLES_XML);
  zip.file("xl/worksheets/sheet1.xml", sheet);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** Today's date as "YYYY-MM-DD" in Philippine time (the dates of the export are Philippine days). */
export function manilaToday(now: Date = new Date()): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return p;
}
