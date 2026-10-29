// Builds the Certificate of Scholarship Renewal (CSR) as a PDF, laid out like the office's own CSR.docx / "V2 CSR.pdf".
// Used by the csr-issue edge function (Deno) and by the local demo's stand-in (Node); it imports only pdf-lib and qrcode, so both can run it.
// Pure helpers at the top (names, the program code, dates, the CSR number) are tested in Node by tests/renewal/run.mjs.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
// The pure QR maths only (the full "qrcode" entry also pulls in image writers that need the file system).
// @ts-ignore no type declarations for this deep import
import * as QRCore from "qrcode/lib/core/qrcode.js";
import { CSR_ASSETS } from "./csrAssets.ts";

// ── The words printed on the certificate (pure) ─────────────
/** "JUAN -TEST N. DELA CRUZ": first name, the middle INITIAL with a dot, last name, all capitals. */
export function csrFullName(first: string, middle: string, last: string): string {
  const mid = (middle ?? "").trim();
  const initial = mid ? mid.charAt(0).toUpperCase() + "." : "";
  return [first, initial, last].map(s => (s ?? "").trim()).filter(Boolean).join(" ").replace(/\s+/g, " ").toUpperCase();
}

/** The printed name of the Mayor split where the "Klarex" picture goes: "HON. ROLANDO A. UY" -> before "HON. ROLANDO", after "A. UY". Null when the name has no "ROLANDO" with something after it (the picture then goes beside the signature as before). */
export function splitNameForMark(name: string): { before: string; after: string } | null {
  const m = /^(.*?\bROLANDO)\s+(\S.*)$/i.exec((name ?? "").trim());
  return m ? { before: m[1], after: m[2] } : null;
}

/** The Program as stored, then "-" and the year number ("BS Marine" + "5th Year" -> "BS Marine-5"); the program alone when the year has no number. */
export function csrProgramCode(program: string, yearLevel: string): string {
  const p = (program ?? "").trim().toUpperCase();
  const n = /(\d+)/.exec(yearLevel ?? "")?.[1] ?? "";
  return n ? `${p}-${n}` : p;
}

const ORDINAL_EXCEPTIONS = new Set([11, 12, 13]);
/** 4 -> "4th", 21 -> "21st", 12 -> "12th". */
export function ordinalDay(day: number): string {
  const suffix = ORDINAL_EXCEPTIONS.has(day % 100) ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[day % 10] ?? "th";
  return `${day}${suffix}`;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** The day / month / year in Philippine time (UTC+8), for "Issued this 4th day of July 2025". */
export function manilaDateParts(at: Date): { day: number; month: string; year: number } {
  const m = new Date(at.getTime() + 8 * 3600000);
  return { day: m.getUTCDate(), month: MONTHS[m.getUTCMonth()], year: m.getUTCFullYear() };
}

export function termClassText(term: string): { period: string; cls: string } {
  if (term === "1st Semester") return { period: "1ST Semester", cls: "1ST SEMESTER CLASS" };
  if (term === "2nd Semester") return { period: "2ND Semester", cls: "2ND SEMESTER CLASS" };
  return { period: "Summer", cls: "SUMMER CLASS" };
}

/** CSR-2026-1S-00012: the school year's first year, the term (1S / 2S / SU) and a five-digit running number for that term. */
export function csrNumberText(schoolYear: string, term: string, sequence: number): string {
  const start = /^(\d{4})/.exec(schoolYear)?.[1] ?? "0000";
  const t = term === "1st Semester" ? "1S" : term === "2nd Semester" ? "2S" : "SU";
  return `CSR-${start}-${t}-${String(sequence).padStart(5, "0")}`;
}

export interface CsrSignatory { name: string; title: string; signature?: Uint8Array | null; mark?: Uint8Array | null }
export interface CsrData {
  csrNumber: string; version: number;
  fullName: string; scholarIdNumber: string; barangay: string; program: string; school: string;
  term: string; schoolYear: string; issuedAt: Date; place: string;
  officer: CsrSignatory; mayor: CsrSignatory;
  /** The page the scholar's QR opens (the existing scholar QR, not a second code). */
  qrUrl: string;
}

// ── Layout ──────────────────────────────────────────────────
const PAGE_W = 595.28, PAGE_H = 841.89;
const LEFT = 34.5, TEXT_W = 527;
const BODY = 12, LEADING = 17.2, PARA_GAP = 9;

interface Run { text: string; bold?: boolean; underline?: boolean }
interface Word { text: string; bold: boolean; underline: boolean; width: number; space: number; joinsNext: boolean }

const b64 = (s: string): Uint8Array => Uint8Array.from(atob(s), c => c.charCodeAt(0));

/** Standard PDF fonts only know Latin text: anything else becomes "?" instead of making the whole certificate fail. */
function pdfSafe(font: PDFFont, text: string): string {
  const set = new Set(font.getCharacterSet());
  return Array.from(text).map(ch => (set.has(ch.codePointAt(0) as number) ? ch : "?")).join("");
}

function toWords(runs: Run[], regular: PDFFont, bold: PDFFont, size: number): Word[] {
  const words: Word[] = [];
  for (const run of runs) {
    const font = run.bold ? bold : regular;
    const text = pdfSafe(font, run.text);
    const parts = text.split(/(\s+)/).filter(p => p.length > 0);
    for (const part of parts) {
      if (/^\s+$/.test(part)) { if (words.length) words[words.length - 1].space = regular.widthOfTextAtSize(" ", size); continue; }
      const prev = words[words.length - 1];
      // a run that starts right after another run with no space (e.g. a full stop) is glued to the previous word
      const glue = !!prev && prev.space === 0;
      words.push({ text: part, bold: !!run.bold, underline: !!run.underline, width: font.widthOfTextAtSize(part, size), space: 0, joinsNext: false });
      if (glue) prev.joinsNext = true;
    }
  }
  return words;
}

/** Breaks the words into lines of at most `width` (the first line is `indent` shorter) and returns them. */
function breakLines(words: Word[], width: number, indent: number): Word[][] {
  const lines: Word[][] = [];
  let line: Word[] = [], used = 0, avail = width - indent;
  for (const w of words) {
    const gap = line.length && !line[line.length - 1].joinsNext ? line[line.length - 1].space : 0;
    if (line.length && used + gap + w.width > avail) { lines.push(line); line = []; used = 0; avail = width; }
    const g = line.length && !line[line.length - 1].joinsNext ? line[line.length - 1].space : 0;
    line.push(w); used += g + w.width;
  }
  if (line.length) lines.push(line);
  return lines;
}

function drawLine(page: PDFPage, line: Word[], x: number, y: number, size: number, regular: PDFFont, bold: PDFFont, targetWidth: number | null) {
  const gaps = line.slice(0, -1).filter(w => !w.joinsNext).length;
  const natural = line.reduce((a, w, i) => a + w.width + (i < line.length - 1 && !w.joinsNext ? w.space : 0), 0);
  const extra = targetWidth !== null && gaps > 0 ? Math.max(0, (targetWidth - natural) / gaps) : 0;
  let cx = x;
  line.forEach((w, i) => {
    const font = w.bold ? bold : regular;
    page.drawText(w.text, { x: cx, y, size, font, color: rgb(0, 0, 0) });
    const next = line[i + 1];
    const gap = w.joinsNext ? 0 : w.space + extra;
    if (w.underline) {
      const to = cx + w.width + (next && next.underline && !w.joinsNext ? gap : 0);
      page.drawLine({ start: { x: cx, y: y - 1.6 }, end: { x: to, y: y - 1.6 }, thickness: 0.8, color: rgb(0, 0, 0) });
    }
    cx += w.width + gap;
  });
}

/** Draws a justified paragraph (first line indented); returns the y (from the top) of the next free baseline. */
function paragraph(page: PDFPage, runs: Run[], top: number, regular: PDFFont, bold: PDFFont, indent: number): number {
  const lines = breakLines(toWords(runs, regular, bold, BODY), TEXT_W, indent);
  let y = top;
  lines.forEach((line, i) => {
    const last = i === lines.length - 1;
    const x = LEFT + (i === 0 ? indent : 0);
    drawLine(page, line, x, PAGE_H - y, BODY, regular, bold, last ? null : TEXT_W - (i === 0 ? indent : 0));
    y += LEADING;
  });
  return y;
}

function centered(page: PDFPage, text: string, y: number, font: PDFFont, size: number) {
  const t = pdfSafe(font, text);
  page.drawText(t, { x: (PAGE_W - font.widthOfTextAtSize(t, size)) / 2, y: PAGE_H - y, size, font, color: rgb(0, 0, 0) });
}

/** The scholar's own QR as vector squares (sharp at any zoom); `size` is the side of the code in points. */
function drawQr(page: PDFPage, url: string, x: number, topY: number, size: number) {
  const core = ((QRCore as unknown as { default?: unknown }).default ?? QRCore) as { create: (text: string, opts: { errorCorrectionLevel: string }) => { modules: { size: number; get: (r: number, c: number) => number } } };
  const qr = core.create(url, { errorCorrectionLevel: "M" });
  const n = qr.modules.size, quiet = 1, cell = size / (n + quiet * 2);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (qr.modules.get(r, c)) page.drawRectangle({ x: x + (c + quiet) * cell, y: PAGE_H - topY - (r + quiet + 1) * cell, width: cell + 0.15, height: cell + 0.15, color: rgb(0, 0, 0) });
  }
}

async function embedPng(doc: PDFDocument, bytes: Uint8Array) {
  return doc.embedPng(bytes);
}

/** The certificate as PDF bytes. */
export async function buildCsrPdf(d: CsrData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Certificate of Scholarship Renewal ${d.csrNumber}`);
  doc.setAuthor("City Education and Development Office");
  doc.setSubject(`Renewal of ${d.fullName}`);
  doc.setProducer("CEDO Scholar Portal");
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  // Watermark (behind everything), letterhead and the rule under it
  const watermark = await embedPng(doc, b64(CSR_ASSETS.watermark));
  page.drawImage(watermark, { x: 121, y: PAGE_H - 281 - 144, width: 353, height: 144, opacity: 0.95 });
  const header = await embedPng(doc, b64(CSR_ASSETS.header));
  page.drawImage(header, { x: LEFT, y: PAGE_H - 36.6 - 70.5, width: TEXT_W, height: 70.5 });
  const rule = await embedPng(doc, b64(CSR_ASSETS.rule));
  page.drawImage(rule, { x: LEFT, y: PAGE_H - 113.7 - 2.2, width: TEXT_W, height: 2.2 });

  // Title
  const { period, cls } = termClassText(d.term);
  let size = 14;
  const title = "CERTIFICATE OF SCHOLARSHIP RENEWAL";
  while (bold.widthOfTextAtSize(title, size) > 318 && size > 10) size -= 0.25;
  centered(page, title, 169, bold, size);
  centered(page, `Period Covered: ${period} SY ${d.schoolYear}`, 186, bold, 11.5);

  page.drawText("TO WHOM IT MAY CONCERN:", { x: LEFT, y: PAGE_H - 236, size: 11.5, font: bold, color: rgb(0, 0, 0) });

  // The body
  let y = 277;
  const indent = 35;
  y = paragraph(page, [
    { text: "THIS IS TO CERTIFY", bold: true }, { text: " the " }, { text: "RENEWAL OF SCHOLARSHIP", bold: true, underline: true }, { text: " of " },
    { text: d.fullName, bold: true, underline: true }, { text: " bearing " }, { text: "Scholar ID No.", bold: true }, { text: " " }, { text: d.scholarIdNumber, bold: true, underline: true },
    { text: " and a resident of Barangay " }, { text: d.barangay.toUpperCase(), bold: true, underline: true },
    { text: ", Cagayan de Oro City, to the City Scholarship Program with the Course " }, { text: d.program, bold: true, underline: true },
    { text: " at " }, { text: d.school.toUpperCase(), bold: true }, { text: " for the " }, { text: cls, bold: true, underline: true },
    { text: " of School Year " }, { text: d.schoolYear, bold: true, underline: true }, { text: "." },
  ], y, regular, bold, indent) + PARA_GAP;
  y = paragraph(page, [{ text: "This certifies further that the City Government of Cagayan de Oro through the City Treasurer will pay the Tuition, Matriculation, and Other Fees which are relevant or applicable to the Course taken by the said scholar and as billed by the school." }], y, regular, bold, indent) + PARA_GAP;
  y = paragraph(page, [{ text: "This certification is issued upon the request of the above-named student-scholar that he/she is allowed to enroll in your school even without or with minimal down-payment however, the City Government through the City Scholarships Office shall submit an Official Master list of Scholars thirty (30) days after the last day of enrolment." }], y, regular, bold, indent) + PARA_GAP;
  const when = manilaDateParts(d.issuedAt);
  y = paragraph(page, [
    { text: "Issued this " }, { text: ordinalDay(when.day), bold: true, underline: true }, { text: " day of " }, { text: when.month, bold: true, underline: true }, { text: ` ${when.year} at ${d.place}.` },
  ], y, regular, bold, indent);

  // Endorsed by + the two signatories
  const endorsedTop = Math.max(y + 12, 512);
  page.drawText("Endorsed by:", { x: LEFT, y: PAGE_H - endorsedTop, size: BODY, font: regular, color: rgb(0, 0, 0) });
  const officerTop = endorsedTop + 46, mayorTop = officerTop + 100;
  const sig = async (bytes: Uint8Array | null | undefined, fallback: string | null, x: number, top: number, maxW: number, maxH: number) => {
    const raw = bytes ?? (fallback ? b64(fallback) : null);
    if (!raw) return;
    try {
      const img = await embedPng(doc, raw);
      const k = Math.min(maxW / img.width, maxH / img.height);
      page.drawImage(img, { x, y: PAGE_H - top - img.height * k, width: img.width * k, height: img.height * k });
    } catch { /* a signature picture that cannot be read is left out; the printed name stays */ }
  };
  const customOfficer = !!d.officer.signature, customMayor = !!d.mayor.signature;
  await sig(d.officer.signature, customOfficer ? null : CSR_ASSETS.officerSignature, 88, officerTop - 50, 60, 52);
  await sig(d.mayor.signature, customMayor ? null : CSR_ASSETS.mayorSignature, 80, mayorTop - 62, 58, 86);
  const nameSize = 11.5;
  const mayorPrinted = pdfSafe(bold, d.mayor.name.toUpperCase());
  const markSplit = splitNameForMark(mayorPrinted);
  const markBytes = d.mayor.mark ?? (customMayor ? null : b64(CSR_ASSETS.mayorMark));
  if (markBytes && !markSplit) await sig(d.mayor.mark, customMayor ? null : CSR_ASSETS.mayorMark, 150, mayorTop - 38, 44, 26);   // no "ROLANDO" in the name: the picture stays beside the signature
  page.drawText(pdfSafe(bold, d.officer.name.toUpperCase()), { x: LEFT, y: PAGE_H - officerTop, size: nameSize, font: bold, color: rgb(0, 0, 0) });
  const titleLines = breakLines(toWords([{ text: d.officer.title }], regular, bold, 11), 300, 0);
  titleLines.forEach((l, i) => drawLine(page, l, LEFT, PAGE_H - (officerTop + 15 + i * 14), 11, regular, bold, null));
  if (markBytes && markSplit) {
    // the "Klarex" picture sits in the name line, between "ROLANDO" and "A."
    const gap = 3, markH = 27;
    page.drawText(markSplit.before, { x: LEFT, y: PAGE_H - mayorTop, size: nameSize, font: bold, color: rgb(0, 0, 0) });
    let after = LEFT + bold.widthOfTextAtSize(markSplit.before, nameSize) + gap;
    try {
      const img = await embedPng(doc, markBytes);
      const k = markH / img.height;
      page.drawImage(img, { x: after, y: PAGE_H - mayorTop - 3, width: img.width * k, height: markH });
      after += img.width * k + gap;
    } catch { after += bold.widthOfTextAtSize(" ", nameSize); /* a picture that cannot be read is left out; the printed name stays */ }
    page.drawText(markSplit.after, { x: after, y: PAGE_H - mayorTop, size: nameSize, font: bold, color: rgb(0, 0, 0) });
  } else {
    page.drawText(mayorPrinted, { x: LEFT, y: PAGE_H - mayorTop, size: nameSize, font: bold, color: rgb(0, 0, 0) });
  }
  page.drawText(pdfSafe(regular, d.mayor.title), { x: LEFT + 90, y: PAGE_H - (mayorTop + 15), size: 11, font: regular, color: rgb(0, 0, 0) });

  // The scholar's QR (the same code as their ID) and the CSR number under it
  drawQr(page, d.qrUrl, 417, officerTop, 113);
  const num = `CSR No. ${d.csrNumber}${d.version > 1 ? `  ·  Copy ${d.version}` : ""}`;
  page.drawText(num, { x: 417 + (113 - regular.widthOfTextAtSize(num, 7.5)) / 2, y: PAGE_H - (officerTop + 113 + 11), size: 7.5, font: regular, color: rgb(0, 0, 0) });
  const scan = "Scan to check this certificate";
  page.drawText(scan, { x: 417 + (113 - regular.widthOfTextAtSize(scan, 7)) / 2, y: PAGE_H - (officerTop + 113 + 20), size: 7, font: regular, color: rgb(0.3, 0.3, 0.3) });

  // Footer
  centered(page, "This is an official document. Tampering nor editing in any kind is punishable by Laws.", 798, regular, 9.5);
  const footer = await embedPng(doc, b64(CSR_ASSETS.footer));
  page.drawImage(footer, { x: LEFT, y: PAGE_H - 762 - 81.7, width: TEXT_W, height: 81.7 });

  return doc.save();
}
