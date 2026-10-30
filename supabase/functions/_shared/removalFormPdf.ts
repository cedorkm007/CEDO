// Builds the Scholarship Grant Termination Acknowledgement Form as a PDF, laid out like the office's own sample (REMOVAL LETTER.docx): the letterhead, the acknowledgement,
// the table of failed subjects, the provision of the contract and four signature places (the scholar, the parent or guardian, the Division Head who noted it and the City Education
// and Development Officer who endorsed it; the last two carry the e-signatures attached when the removal was approved).
// Used by the removal-form-issue edge function (Deno) and by the local demo's stand-in (Node); it imports only pdf-lib and the CSR helpers.
// Pure helpers at the top (the semester split, the number in words, the grouping, the date) are tested in Node by tests/removal-form/web_tests.mjs.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { REMOVAL_FORM_ASSETS } from "./removalFormAssets.ts";
import { b64, csrFullName, PAGE_H, PAGE_W, pdfSafe } from "./csrPdf.ts";

// ── The words printed on the form (pure) ────────────────────
/** "2nd Semester 2025-2026" -> { semester: "2nd Semester", schoolYear: "2025-2026" }; text that has neither a semester nor a school year is kept whole as the semester. */
export function splitSemesterYear(text: string): { semester: string; schoolYear: string } {
  const t = (text ?? "").trim();
  if (!t) return { semester: "—", schoolYear: "—" };
  const year = /(\d{4})\s*[-–]\s*(\d{4})/.exec(t);
  const sem = /\b(1st|first|2nd|second|summer)\b/i.exec(t);
  const semester = !sem ? "" : /^(1st|first)$/i.test(sem[1]) ? "1st Semester" : /^(2nd|second)$/i.test(sem[1]) ? "2nd Semester" : "Summer";
  const schoolYear = year ? `${year[1]}-${year[2]}` : (/\b(\d{4})\b/.exec(t)?.[1] ?? "");
  if (!semester && !schoolYear) return { semester: t, schoolYear: "—" };
  return { semester: semester || "—", schoolYear: schoolYear || "—" };
}

const WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen", "Twenty"];
/** 2 -> "Two (2)", 12 -> "Twelve (12)", 25 -> "25". */
export function countInWords(n: number): string { return n >= 0 && n < WORDS.length ? `${WORDS[n]} (${n})` : String(n); }

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "2026-10-28" -> "October 28, 2026". */
export function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${MONTHS[Number(m[2]) - 1] ?? ""} ${Number(m[3])}, ${m[1]}` : (iso ?? "");
}

export interface RemovalFailedSubject { semesterYear: string; yearLevel: string; code: string; subject: string }
export interface RemovalGroup { semester: string; schoolYear: string; yearLevel: string; subjects: string[] }
/** The failed subjects in the order given, one row for each semester (and year level) with its subjects listed; a subject with no name shows its code. */
export function groupFailedSubjects(rows: RemovalFailedSubject[]): RemovalGroup[] {
  const groups: RemovalGroup[] = [];
  for (const r of rows) {
    const { semester, schoolYear } = splitSemesterYear(r.semesterYear);
    const name = (r.subject || r.code || "").trim();
    if (!name) continue;
    const last = groups[groups.length - 1];
    if (last && last.semester === semester && last.schoolYear === schoolYear && last.yearLevel === (r.yearLevel || "—")) last.subjects.push(name);
    else groups.push({ semester, schoolYear, yearLevel: r.yearLevel || "—", subjects: [name] });
  }
  return groups;
}

export const DIVISION_HEAD_TITLE = "Head, Scholarships and Educational Assistance Division";
export const CONTRACT_PROVISION = "“A subsequent failure/s in any of his/her subjects or failure to arrive at the agreed average shall cause his/her outright removal from the program without need for deliberation.”";

export interface RemovalSignatory { name: string; title: string; signature?: Uint8Array | null }
export interface RemovalFormData {
  first: string; middle: string; last: string; program: string; yearLevel: string; school: string; barangay: string;
  failed: RemovalFailedSubject[];
  /** The day the Division Head approved, "2026-10-28". */
  issuedOn: string;
  divisionHead: RemovalSignatory; officer: RemovalSignatory;
}

// ── Layout ──────────────────────────────────────────────────
const ML = 57, TW = 481;                       // the sample's text margins
interface Run { text: string; bold?: boolean; italic?: boolean; underline?: boolean; red?: boolean }
interface W { text: string; bold: boolean; italic: boolean; underline: boolean; red: boolean; width: number; space: number }
interface Fonts { regular: PDFFont; bold: PDFFont; italic: PDFFont; boldItalic: PDFFont }
const fontOf = (f: Fonts, w: { bold: boolean; italic: boolean }) => (w.bold && w.italic ? f.boldItalic : w.bold ? f.bold : w.italic ? f.italic : f.regular);

function words(runs: Run[], f: Fonts, size: number): W[] {
  const out: W[] = [];
  for (const run of runs) {
    const font = fontOf(f, { bold: !!run.bold, italic: !!run.italic });
    for (const part of pdfSafe(font, run.text).split(/(\s+)/).filter(p => p.length > 0)) {
      if (/^\s+$/.test(part)) { if (out.length) out[out.length - 1].space = f.regular.widthOfTextAtSize(" ", size); continue; }
      out.push({ text: part, bold: !!run.bold, italic: !!run.italic, underline: !!run.underline, red: !!run.red, width: font.widthOfTextAtSize(part, size), space: 0 });
    }
  }
  return out;
}
function wrap(ws: W[], width: number, indent: number): W[][] {
  const lines: W[][] = []; let line: W[] = [], used = 0, avail = width - indent;
  for (const w of ws) {
    const gap = line.length ? line[line.length - 1].space : 0;
    if (line.length && used + gap + w.width > avail) { lines.push(line); line = []; used = 0; avail = width; }
    line.push(w); used += (line.length > 1 ? line[line.length - 2].space : 0) + w.width;
  }
  if (line.length) lines.push(line);
  return lines;
}
function drawWords(page: PDFPage, line: W[], x: number, y: number, size: number, f: Fonts, target: number | null) {
  const gaps = line.length - 1;
  const natural = line.reduce((a, w, i) => a + w.width + (i < gaps ? w.space : 0), 0);
  const extra = target !== null && gaps > 0 ? Math.max(0, (target - natural) / gaps) : 0;
  let cx = x;
  line.forEach((w, i) => {
    const color = w.red ? rgb(0.75, 0, 0) : rgb(0, 0, 0);
    page.drawText(w.text, { x: cx, y, size, font: fontOf(f, w), color });
    const gap = i < gaps ? w.space + extra : 0;
    if (w.underline) page.drawLine({ start: { x: cx, y: y - 1.5 }, end: { x: cx + w.width + (line[i + 1]?.underline ? gap : 0), y: y - 1.5 }, thickness: 0.7, color });
    cx += w.width + gap;
  });
}
/** A justified paragraph (first line indented); `top` and the result are measured from the top of the page. */
function paragraph(page: PDFPage, runs: Run[], top: number, f: Fonts, size: number, leading: number, indent: number): number {
  const lines = wrap(words(runs, f, size), TW, indent);
  let y = top;
  lines.forEach((line, i) => {
    const first = i === 0;
    drawWords(page, line, ML + (first ? indent : 0), PAGE_H - y, size, f, i === lines.length - 1 ? null : TW - (first ? indent : 0));
    y += leading;
  });
  return y;
}
function centeredIn(page: PDFPage, text: string, x: number, w: number, y: number, font: PDFFont, size: number, color = rgb(0, 0, 0)) {
  const t = pdfSafe(font, text);
  page.drawText(t, { x: x + (w - font.widthOfTextAtSize(t, size)) / 2, y: PAGE_H - y, size, font, color });
}
/** Centered lines of `text` wrapped to `width`; returns the y after the last line. */
function centeredWrapped(page: PDFPage, text: string, x: number, width: number, top: number, font: PDFFont, size: number, leading: number): number {
  const ws = text.split(/\s+/); let line = "", y = top;
  const flush = () => { if (line) { centeredIn(page, line, x, width, y, font, size); y += leading; line = ""; } };
  for (const w of ws) { const next = line ? `${line} ${w}` : w; if (line && font.widthOfTextAtSize(pdfSafe(font, next), size) > width) { flush(); line = w; } else line = next; }
  flush();
  return y;
}

/** The form as PDF bytes: one A4 page; a long list of failed subjects is first set more tightly, and only then do the signatures move to a second page. */
export async function buildRemovalFormPdf(d: RemovalFormData): Promise<Uint8Array> {
  const first = await render(d, false);
  return first ?? (await render(d, true))!;
}

/** `compact` sets the table and the gaps tighter; returns null (without a file) when the normal layout does not fit on one page. */
async function render(d: RemovalFormData, compact: boolean): Promise<Uint8Array | null> {
  const K = compact ? 0.55 : 1;      // the gaps and the minimum row heights
  const LIMIT = 772;                 // nothing is drawn below this (the footer starts under it)
  const fullName = csrFullName(d.first, d.middle, d.last);
  const doc = await PDFDocument.create();
  doc.setTitle(`Scholarship Grant Termination Acknowledgement Form - ${fullName}`);
  doc.setAuthor("City Education and Development Office");
  doc.setSubject(`Termination of the scholarship of ${fullName}`);
  doc.setProducer("CEDO Scholar Portal");
  let page = doc.addPage([PAGE_W, PAGE_H]);
  const f: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique), boldItalic: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
  };

  // letterhead and footer (the office's own pictures)
  const header = await doc.embedPng(b64(REMOVAL_FORM_ASSETS.header));
  const footer = await doc.embedPng(b64(REMOVAL_FORM_ASSETS.footer));
  const letterhead = (p: PDFPage) => {
    p.drawImage(header, { x: 61, y: PAGE_H - 36 - (433 * 173) / 1121, width: 433, height: (433 * 173) / 1121 });
    p.drawImage(footer, { x: ML, y: PAGE_H - 799 - (480 * 164) / 2048, width: 480, height: (480 * 164) / 2048 });
  };
  letterhead(page);

  // titles
  centeredIn(page, "CITY SCHOLARSHIPS PROGRAM", 0, PAGE_W, 121, f.regular, 9.5);
  centeredIn(page, "SCHOLARSHIP FOR TERTIARY EDUCATION", 0, PAGE_W, 133, f.regular, 9.5);
  centeredIn(page, "SCHOLARSHIP GRANT TERMINATION ACKNOWLEDGEMENT FORM", 0, PAGE_W, 146, f.bold, 9.5);

  const SIZE = 9.5, LEAD = 13.2;
  let y = 172;
  y = paragraph(page, [
    { text: "I, " }, { text: fullName, bold: true, underline: true }, { text: ",   a " }, { text: `${d.program.toUpperCase()}${d.yearLevel ? ` - ${d.yearLevel.toUpperCase()}` : ""}`, bold: true, underline: true },
    { text: ", in " }, { text: d.school || "—", bold: true, underline: true }, { text: " residing in Barangay " }, { text: (d.barangay || "—").toUpperCase(), bold: true, underline: true },
    { text: " and a beneficiary of the City Scholarship Program, acknowledge that upon the signing of this form, my scholarship is officially terminated due to one or more violations of the terms and conditions of the " },
    { text: "Scholarship Agreement", bold: true }, { text: " I signed upon the awarding of the Grant." },
  ], y, f, SIZE, LEAD, 30);
  y += 8;
  y = paragraph(page, [
    { text: "I understand that the scholarship was granted under the authority of " }, { text: "City Ordinance No. 13362-2018", bold: true },
    { text: ", also known as the Scholarship Code of 2018, and that the City Government of Cagayan de Oro reserves the right to revoke such grants upon breach of Contract." },
  ], y, f, SIZE, LEAD, 30);
  y += Math.round(22 * K);

  // the table of failed subjects
  const groups = groupFailedSubjects(d.failed);
  const cols = [86, 78, 247, 70];               // Semester, School Year, Failed Subject/s, Year Level (481 in all)
  const xs = cols.reduce<number[]>((a, w, i) => { a.push(i ? a[i - 1] + cols[i - 1] : ML); return a; }, []);
  const line = rgb(0, 0, 0);
  const hRow = Math.round(30 * K);
  const subjectLines = (g: RemovalGroup) => g.subjects.map(s => ({ s, ls: (() => { const ws = s.split(/\s+/); const out: string[] = []; let cur = ""; for (const w of ws) { const n = cur ? `${cur} ${w}` : w; if (cur && f.regular.widthOfTextAtSize(pdfSafe(f.regular, n), SIZE) > cols[2] - 34) { out.push(cur); cur = w; } else cur = n; } if (cur) out.push(cur); return out; })() }));
  const heights = groups.map(g => Math.max(Math.round(38 * K), Math.round(14 * K) + subjectLines(g).reduce((n, x) => n + x.ls.length, 0) * 12.5));
  const totalRow = Math.round(36 * K);
  const tableH = hRow + heights.reduce((a, b) => a + b, 0) + (groups.length ? 0 : 38) + totalRow;
  const top = y, bottom = top + tableH;
  const hline = (yy: number, x0 = ML, x1 = ML + TW) => page.drawLine({ start: { x: x0, y: PAGE_H - yy }, end: { x: x1, y: PAGE_H - yy }, thickness: 0.8, color: line });
  const vline = (x: number, y0: number, y1: number) => page.drawLine({ start: { x, y: PAGE_H - y0 }, end: { x, y: PAGE_H - y1 }, thickness: 0.8, color: line });
  hline(top); hline(bottom); vline(ML, top, bottom); vline(ML + TW, top, bottom);
  ["Semester", "School Year", "Failed Subject/s", "Year Level"].forEach((h, i) => centeredIn(page, h, xs[i], cols[i], top + hRow / 2 + 3.5, f.bold, SIZE));
  hline(top + hRow);
  let ry = top + hRow;
  groups.forEach((g, gi) => {
    const h = heights[gi];
    [0, 1, 3].forEach(i => centeredIn(page, [g.semester, g.schoolYear, "", g.yearLevel][i], xs[i], cols[i], ry + h / 2 + 3.5, f.regular, SIZE));
    let sy = ry + (h - subjectLines(g).reduce((n, x) => n + x.ls.length, 0) * 12.5) / 2 + 9.5, n = 1;
    for (const item of subjectLines(g)) {
      item.ls.forEach((l, li) => { page.drawText(pdfSafe(f.regular, li === 0 ? `${n}.` : ""), { x: xs[2] + 10, y: PAGE_H - sy, size: SIZE, font: f.regular }); page.drawText(pdfSafe(f.regular, l), { x: xs[2] + 28, y: PAGE_H - sy, size: SIZE, font: f.regular }); sy += 12.5; });
      n++;
    }
    ry += h; hline(ry);
  });
  if (!groups.length) { centeredIn(page, "—", xs[2], cols[2], ry + 22, f.regular, SIZE); ry += 38; hline(ry); }
  [xs[1], xs[2], xs[3]].forEach(x => vline(x, top, ry)); vline(xs[1], top, ry);
  // the total row: the first two columns are one cell
  const totalLabel = "Total Failed Subjects";
  const red = rgb(0.75, 0, 0);
  const tl = pdfSafe(f.boldItalic, totalLabel);
  page.drawText(tl, { x: xs[2] - 8 - f.boldItalic.widthOfTextAtSize(tl, 8.5), y: PAGE_H - (ry + totalRow / 2 + 3.5), size: 8.5, font: f.boldItalic, color: red });
  page.drawText(pdfSafe(f.bold, countInWords(groups.reduce((n, g) => n + g.subjects.length, 0))), { x: xs[2] + 10, y: PAGE_H - (ry + totalRow / 2 + 3.5), size: SIZE, font: f.bold, color: red });
  // the line between the first two columns stops above the total row (they are one cell there)
  y = bottom + Math.round(24 * K);

  y = paragraph(page, [
    { text: "According to the contract, you have violated the hereunder provisions, " }, { text: CONTRACT_PROVISION, bold: true, italic: true, red: true },
  ], y, f, SIZE, LEAD, 0);
  y += Math.round(22 * K);
  y = paragraph(page, [
    { text: "By signing below, " }, { text: "I acknowledge and accept the consequence of forfeiting all remaining privileges currently granted by the City Scholarship Program", bold: true },
    { text: ". I have been informed of the grounds for termination and may seek clarification from the City Education and Development if necessary." },
  ], y, f, SIZE, LEAD, 0);
  y += Math.round(14 * K);
  page.drawText("Date of Issued:", { x: ML, y: PAGE_H - y, size: SIZE, font: f.bold });
  const dateText = pdfSafe(f.regular, longDate(d.issuedOn));
  const dx = ML + f.bold.widthOfTextAtSize("Date of Issued: ", SIZE);
  page.drawText(dateText, { x: dx, y: PAGE_H - y, size: SIZE, font: f.regular });
  page.drawLine({ start: { x: dx, y: PAGE_H - y - 1.5 }, end: { x: dx + f.regular.widthOfTextAtSize(dateText, SIZE), y: PAGE_H - y - 1.5 }, thickness: 0.7, color: line });
  y += Math.round(26 * K);

  // the four signature places: all of them need about 165 pt; when they do not fit the first time, the tighter layout is tried, then they go on a second page
  if (y + 165 > LIMIT) {
    if (!compact) return null;
    page = doc.addPage([PAGE_W, PAGE_H]); letterhead(page); y = 150;
  }
  const BOXW = 216, GAP = 36, LX = ML, RX = ML + BOXW + GAP, BOXH = 21, grey = rgb(0.85, 0.85, 0.85);
  centeredIn(page, "Witness:", RX, BOXW, y + 4, f.regular, SIZE);
  y += 20;
  const box = (x: number, yy: number, name: string) => {
    page.drawRectangle({ x, y: PAGE_H - yy - BOXH, width: BOXW, height: BOXH, color: grey });
    if (!name) return;
    let size = 9.5; const t = pdfSafe(f.bold, name.toUpperCase());
    while (f.bold.widthOfTextAtSize(t, size) > BOXW - 8 && size > 6) size -= 0.25;
    centeredIn(page, t, x, BOXW, yy + BOXH / 2 + size * 0.35, f.bold, size);
  };
  box(LX, y, fullName); box(RX, y, "");
  centeredIn(page, "Name and Signature of Grantee", LX, BOXW, y + BOXH + 14, f.regular, SIZE);
  centeredIn(page, "Name and Signature of Parent/Guardian", RX, BOXW, y + BOXH + 14, f.regular, SIZE);
  y += BOXH + 38;
  page.drawText("Noted by:", { x: LX, y: PAGE_H - y, size: SIZE, font: f.bold });
  page.drawText("Endorsed by:", { x: RX, y: PAGE_H - y, size: SIZE, font: f.bold });
  y += 16;
  box(LX, y, d.divisionHead.name); box(RX, y, d.officer.name);
  // the e-signatures attached at approval, drawn over the top of the names
  const sig = async (bytes: Uint8Array | null | undefined, x: number) => {
    if (!bytes) return;
    try {
      const img = await doc.embedPng(bytes);
      const k = Math.min(110 / img.width, 46 / img.height);
      page.drawImage(img, { x: x + (BOXW - img.width * k) / 2, y: PAGE_H - y - BOXH / 2 - img.height * k / 2 + 6, width: img.width * k, height: img.height * k });
    } catch { /* a signature picture that cannot be read is left out; the printed name stays */ }
  };
  await sig(d.divisionHead.signature, LX); await sig(d.officer.signature, RX);
  centeredWrapped(page, d.divisionHead.title || DIVISION_HEAD_TITLE, LX, BOXW, y + BOXH + 14, f.regular, SIZE, 12);
  centeredWrapped(page, d.officer.title, RX, BOXW, y + BOXH + 14, f.regular, SIZE, 12);
  return await doc.save();
}
