// ─────────────────────────────────────────────────────────────
// src/lib/clearanceForm.ts
// The pre-filled clearance (the office's own "RECOMMENDATION FOR SCHOLARSHIP RENEWAL" form) for the School Portal's Renewal tab. Pure (no Supabase, no React): given the template and the
// scholars, it gives back a Word file or a PDF with TWO forms to an A4 page (the form is half a page). The page that downloads them is src/school/clearanceDownload.ts.
//
// What is filled in: given name, contact number, school, QPI/GWA, course and year, semester, scholar ID. The three recommendation boxes, the remarks, the signature and the
// "For CEDO staff only" block stay empty: the school's guidance counselor fills those in by hand.
//
// Word: the office's own form (src/assets/ClearanceTemplate.docx, built by scripts/build-clearance-template.cjs) is repeated once per scholar, so it keeps the office's wording and
// formatting. PDF: the same form drawn at the same size (Helvetica instead of Calibri), with the same letterhead and footer pictures taken from the template.
// The right-hand picture of the letterhead is the SCHOOL's own logo (uploaded in the School Portal); a school with no logo gets the form without it.
// ─────────────────────────────────────────────────────────────
import PizZip from "pizzip";
import { fitInBox, pngSize } from "./logoImage";
import { PDFDocument, StandardFonts, rgb, pushGraphicsState, popGraphicsState, rectangle, clip, endPath, type PDFFont, type PDFPage, type PDFImage } from "pdf-lib";

export interface ClearanceEntry {
  /** "JUAN DELA CRUZ" */
  name: string;
  contact: string;
  school: string;
  /** The scholar's GWA for the semester as the school shows it ("2.57"), or "". */
  gwa: string;
  /** "BACHELOR OF SCIENCE IN PSYCHOLOGY 3" */
  courseYear: string;
  /** "1st Semester 2025-2026" */
  semester: string;
  scholarId: string;
}

/** The school's logo: PNG bytes. */
export interface ClearanceLogo { bytes: Uint8Array }

/** The square the logo has to fit in, beside the CEDO banner, and where the box starts (from the form's left text edge): the office's own letterhead measurements. */
const LOGO_BOX_EMU = 619125, LOGO_LEFT_EMU = 4943475, LOGO_TOP_EMU = 9526;

/** Two forms to a page. */
export const FORMS_PER_PAGE = 2;
export const pageCountFor = (forms: number): number => Math.max(0, Math.ceil(forms / FORMS_PER_PAGE));

/** What goes in the boxes, in the form's own style: capitals, the year level as a number. */
export function clearanceEntryFor(s: {
  firstName: string; middleName: string; lastName: string; contactNo: string; schoolName: string; gwaText: string; program: string; yearLevel: string; semester: string; scholarIdNumber: string;
}): ClearanceEntry {
  const year = s.yearLevel.trim().match(/^(\d)/)?.[1] ?? s.yearLevel.trim();
  return {
    name: [s.firstName, s.middleName, s.lastName].map(x => x.trim()).filter(Boolean).join(" ").toUpperCase(),
    contact: s.contactNo.trim(), school: s.schoolName.trim().toUpperCase(), gwa: s.gwaText === "—" ? "" : s.gwaText,
    courseYear: [s.program.trim().toUpperCase(), year].filter(Boolean).join(" "), semester: s.semester, scholarId: s.scholarIdNumber.trim(),
  };
}

const xmlEscape = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const TAGS: (keyof ClearanceEntry)[] = ["name", "contact", "school", "gwa", "courseYear", "semester", "scholarId"];

const PAGE_BREAK = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
const CUT_LINE = '<w:p><w:pPr><w:pBdr><w:bottom w:val="dashed" w:sz="6" w:space="1" w:color="808080"/></w:pBdr><w:spacing w:before="60" w:after="160"/></w:pPr></w:p>';

/** The picture's place in the letterhead, as a Word anchor (the logo is fitted in the box without being stretched, and centred in it). */
function logoRunXml(size: { width: number; height: number }): string {
  const fit = fitInBox(size.width, size.height, LOGO_BOX_EMU);
  const cx = Math.round(fit.width), cy = Math.round(fit.height);
  const x = LOGO_LEFT_EMU + Math.round((LOGO_BOX_EMU - cx) / 2), y = LOGO_TOP_EMU + Math.round((LOGO_BOX_EMU - cy) / 2);
  return '<w:r><w:drawing><wp:anchor allowOverlap="1" behindDoc="1" distB="114300" distT="114300" distL="114300" distR="114300" hidden="0" layoutInCell="1" locked="0" relativeHeight="0" simplePos="0">'
    + '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>' + x + '</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>' + y + '</wp:posOffset></wp:positionV>'
    + '<wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:effectExtent b="0" l="0" r="0" t="0"/><wp:wrapNone/><wp:docPr id="1" name="school-logo.png"/>'
    + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="school-logo.png"/><pic:cNvPicPr preferRelativeResize="0"/></pic:nvPicPr>'
    + '<pic:blipFill><a:blip r:embed="rIdClLogo"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"/><a:ln/></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>';
}
const LOGO_MARK = "<w:r><w:t>{logo}</w:t></w:r>";

/** The Word file: the office's form once per scholar, two to a page. With a logo, the school's own picture is in the letterhead. */
export function buildClearanceDocx(template: ArrayBuffer | Uint8Array, entries: ClearanceEntry[], logo?: ClearanceLogo | null): Uint8Array {
  const zip = new PizZip(template);
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("The clearance template is damaged (no document.xml).");
  const xml = file.asText();
  const bodyStart = xml.indexOf("<w:body>") + "<w:body>".length;
  const sectAt = xml.indexOf("<w:sectPr");
  if (bodyStart < 8 || sectAt < 0) throw new Error("The clearance template is damaged (no body).");
  const head = xml.slice(0, bodyStart), tail = xml.slice(sectAt);
  let block = xml.slice(bodyStart, sectAt);
  const size = logo ? pngSize(logo.bytes) : null;
  if (logo && !size) throw new Error("The school's logo is not a PNG picture.");
  block = block.split(LOGO_MARK).join(logo && size ? logoRunXml(size) : "");
  if (logo && size) {
    zip.file("word/media/school-logo.png", logo.bytes);
    const rels = zip.file("word/_rels/document.xml.rels")?.asText();
    if (!rels) throw new Error("The clearance template is damaged (no relationships).");
    zip.file("word/_rels/document.xml.rels", rels.replace("</Relationships>", '<Relationship Id="rIdClLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/school-logo.png"/></Relationships>'));
  }

  let drawingId = 1000;
  const parts: string[] = [];
  entries.forEach((e, i) => {
    let form = block;
    for (const tag of TAGS) form = form.split(`{${tag}}`).join(xmlEscape(e[tag]));
    form = form.replace(/<wp:docPr id="\d+"/g, () => `<wp:docPr id="${drawingId++}"`);       // every picture of the file needs its own number
    parts.push(form);
    const last = i === entries.length - 1;
    if (!last) parts.push(i % FORMS_PER_PAGE === 0 ? CUT_LINE : PAGE_BREAK);
  });
  zip.file("word/document.xml", head + parts.join("") + tail);
  return zip.generate({ type: "uint8array", compression: "DEFLATE" });
}

// ── PDF ──────────────────────────────────────────────────────
const PT_PER_TWIP = 1 / 20, PT_PER_EMU = 1 / 12700;
const PAGE_W = 595.28, PAGE_H = 841.89, HALF = PAGE_H / 2;
const MARGIN = 652 * PT_PER_TWIP;
const INK = rgb(0, 0, 0), GREY = rgb(0.5, 0.5, 0.5);
const SIZE = 8;

interface Pictures { banner: PDFImage; footer: PDFImage; logo: { image: PDFImage; width: number; height: number } | null }

/** Draws one form into the half of the page whose top edge is `top` (points from the page bottom). */
function drawForm(page: PDFPage, top: number, e: ClearanceEntry, font: PDFFont, bold: PDFFont, pics: Pictures): void {
  let y = top;
  const textW = PAGE_W - 2 * MARGIN;
  const text = (t: string, x: number, f: PDFFont, size = SIZE) => page.drawText(t, { x, y: y - size, size, font: f, color: INK });
  const centered = (t: string, f: PDFFont) => text(t, (PAGE_W - f.widthOfTextAtSize(t, SIZE)) / 2, f);
  const rule = (x1: number, x2: number, yy: number, dash = false) => page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: 0.5, color: dash ? GREY : INK, dashArray: dash ? [3, 2] : undefined });
  const box = (x: number) => page.drawRectangle({ x, y: y - SIZE + 0.5, width: 6.5, height: 6.5, borderColor: INK, borderWidth: 0.6 });
  /** A long value is drawn smaller (down to 5.5 pt) so it still fits its place and nothing is cut off; only then is it shortened. */
  const drawFit = (t: string, x: number, f: PDFFont, maxWidth: number) => {
    let size = SIZE;
    while (size > 5.5 && f.widthOfTextAtSize(t, size) > maxWidth) size -= 0.25;
    let s = t;
    while (s.length > 1 && f.widthOfTextAtSize(s, size) > maxWidth) s = s.slice(0, -1);
    page.drawText(s, { x, y: y - SIZE + (SIZE - size) / 2, size, font: f, color: INK });
  };

  // letterhead: the CEDO banner, cropped the way the office's form crops it (28.477 % off the top, 21.454 % off the bottom)
  const bw = 4865203 * PT_PER_EMU, bh = 620395 * PT_PER_EMU, fullH = bh / (1 - 0.28477 - 0.21454);
  const bx = MARGIN - 76199 * PT_PER_EMU, by = top - 10 - bh;
  page.pushOperators(pushGraphicsState(), rectangle(bx, by, bw, bh), clip(), endPath());
  page.drawImage(pics.banner, { x: bx, y: by + bh - fullH * (1 - 0.28477) + 0, width: bw, height: fullH });
  page.pushOperators(popGraphicsState());
  if (pics.logo) {
    const box = LOGO_BOX_EMU * PT_PER_EMU, fit = fitInBox(pics.logo.width, pics.logo.height, box);
    page.drawImage(pics.logo.image, { x: MARGIN + LOGO_LEFT_EMU * PT_PER_EMU + (box - fit.width) / 2, y: top - 10 - box + (box - fit.height) / 2, width: fit.width, height: fit.height });
  }
  y = top - 10 - bh - 8;

  const title = "RECOMMENDATION FOR SCHOLARSHIP RENEWAL";
  centered(title, bold); y -= 20;

  // details: left column, then the right column at 6400 twips
  const colB = MARGIN + 6400 * PT_PER_TWIP;
  const pair = (l1: string, v1: string, l2?: string, v2?: string) => {
    text(l1, MARGIN, font);
    const x1 = MARGIN + font.widthOfTextAtSize(l1, SIZE);
    drawFit(v1, x1, bold, (l2 ? colB - 6 : PAGE_W - MARGIN) - x1);
    if (l2) { text(l2, colB, font); const x2 = colB + font.widthOfTextAtSize(l2, SIZE); drawFit(v2 ?? "", x2, bold, PAGE_W - MARGIN - x2); }
    y -= 12;
  };
  pair("GIVEN NAME: ", e.name, "CONTACT NUMBER: ", e.contact);
  pair("SCHOOL: ", e.school, "QPI/GWA: ", e.gwa);
  pair("COURSE AND YEAR: ", e.courseYear, "SEMESTER: ", e.semester);
  pair("SCHOLAR ID: ", e.scholarId);
  y -= 6;

  text("Following the check-in and evaluation, our office provides the following recommendation regarding the scholar’s scholarship renewal:", MARGIN, font); y -= 14;
  for (const label of ["Recommended for Scholarship Renewal", "Recommended for Scholarship Renewal with Close Monitoring and Appropriate Intervention", "May Be Advised to Apply for a Leave of Absence (LOA)"]) {
    box(MARGIN); text(label, MARGIN + 11, bold); y -= 12;
  }
  y -= 2;
  text("Remarks/Recommendation:", MARGIN, bold); y -= 15; rule(MARGIN, MARGIN + textW, y); y -= 14; rule(MARGIN, MARGIN + textW, y); y -= 6;
  y -= 6;
  text("This certification is issued for scholarship renewal purposes only.", MARGIN, font); y -= 16;

  const evalLabel = "Evaluated by: ", dateLabel = "Date: ";
  text(evalLabel, MARGIN, bold); const lx = MARGIN + bold.widthOfTextAtSize(evalLabel, SIZE); rule(lx, lx + 190, y - SIZE);
  const dx = MARGIN + 190 + bold.widthOfTextAtSize(evalLabel, SIZE) + 24;
  text(dateLabel, dx, bold); const dl = dx + bold.widthOfTextAtSize(dateLabel, SIZE); rule(dl, dl + 95, y - SIZE);
  y -= 11;
  const cap = "School Guidance Counselor"; text(cap, lx + (190 - font.widthOfTextAtSize(cap, SIZE)) / 2, font); y -= 10;
  rule(MARGIN, MARGIN + textW, y - 2, true); y -= 10;

  centered("FOR CEDO STAFF ONLY.", bold); y -= 13;
  text("Date received: ", MARGIN, bold); const rx = MARGIN + bold.widthOfTextAtSize("Date received: ", SIZE); rule(rx, rx + 90, y - SIZE); y -= 13;
  text("Action Taken:", MARGIN, bold);
  const ax = MARGIN + bold.widthOfTextAtSize("Action Taken:", SIZE) + 8;
  box(ax); text("Endorsed for Scholarship Renewal", ax + 11, font);
  const bx2 = ax + 11 + font.widthOfTextAtSize("Endorsed for Scholarship Renewal", SIZE) + 18; box(bx2); text("For Close Monitoring and Follow-up", bx2 + 11, font); y -= 12;
  box(ax); text("For Leave of Absence (LOA) Processing", ax + 11, font);
  const cx = ax + 11 + font.widthOfTextAtSize("For Leave of Absence (LOA) Processing", SIZE) + 18; box(cx); text("For Further Evaluation / Compliance", cx + 11, font);
  y -= 14;
  const recv = "Received by: "; const rvx = PAGE_W - MARGIN - 175 - bold.widthOfTextAtSize(recv, SIZE);
  text(recv, rvx, bold); rule(rvx + bold.widthOfTextAtSize(recv, SIZE), PAGE_W - MARGIN, y - SIZE);

  // footer picture, centred, at the bottom of the half page
  const fw = 4428000 * PT_PER_EMU, fh = 389433 * PT_PER_EMU;
  page.drawImage(pics.footer, { x: (PAGE_W - fw) / 2, y: top - HALF + 10, width: fw, height: fh });
}

/** The PDF: the same form, two to an A4 page. */
export async function buildClearancePdf(template: ArrayBuffer | Uint8Array, entries: ClearanceEntry[], logo?: ClearanceLogo | null): Promise<Uint8Array> {
  const zip = new PizZip(template);
  const bannerFile = zip.file("word/media/image3.png"), footerFile = zip.file("word/media/image1.png");
  if (!bannerFile || !footerFile) throw new Error("The clearance template is damaged (the letterhead pictures are missing).");
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logoSize = logo ? pngSize(logo.bytes) : null;
  if (logo && !logoSize) throw new Error("The school's logo is not a PNG picture.");
  const pics: Pictures = {
    banner: await pdf.embedPng(bannerFile.asUint8Array()), footer: await pdf.embedPng(footerFile.asUint8Array()),
    logo: logo && logoSize ? { image: await pdf.embedPng(logo.bytes), width: logoSize.width, height: logoSize.height } : null,
  };
  entries.forEach((e, i) => {
    const slot = i % FORMS_PER_PAGE;
    const page = slot === 0 ? pdf.addPage([PAGE_W, PAGE_H]) : pdf.getPage(pdf.getPageCount() - 1);
    drawForm(page, PAGE_H - slot * HALF - 8, e, font, bold, pics);
    if (slot === 0 && i + 1 < entries.length) page.drawLine({ start: { x: MARGIN, y: HALF }, end: { x: PAGE_W - MARGIN, y: HALF }, thickness: 0.5, color: GREY, dashArray: [4, 3] });
  });
  return pdf.save();
}
