import { jsPDF } from "jspdf";

/**
 * Generic "export a list of scholars (or any row data) as a landscape A4
 * PDF table" — extracted from ScholarsTab.tsx's own handleExportPdf
 * (Scholars Information subtab), which has this exact drawing logic
 * inline for its one call site. The Scholarship Program Information tab
 * needs the identical shape (Name/School/Course/Year Level columns) at
 * several different drill-down levels (Barangay, School, Year Level,
 * Course) — genuinely the same document shape reused many times within
 * one feature, unlike this project's usual "one function per document
 * type" convention (see docGenerator.ts), which is for document types
 * that actually differ. Kept separate from ScholarsTab.tsx's own copy
 * rather than refactoring that working, unrelated code.
 */

/** Truncates `text` (appending "…") so it fits within `maxWidth` mm at the pdf's current font — same helper ScholarsTab.tsx keeps privately for its own PDF export. */
function truncateToWidth(pdf: jsPDF, text: string, maxWidth: number): string {
  if (pdf.getTextWidth(text) <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 1 && pdf.getTextWidth(`${truncated}…`) > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return truncated.length < text.length ? `${truncated}…` : text;
}

export interface PdfExportColumn<T> {
  label: string;
  value: (row: T) => string;
  /** Relative column width — larger means wider. Defaults to 1 (equal width) for any column that doesn't set one. */
  weight?: number;
}

export async function exportTableAsPdf<T>(opts: {
  title: string;
  columns: PdfExportColumn<T>[];
  rows: T[];
  filtersSummary: string;
  filenamePrefix: string;
}): Promise<void> {
  const { title, columns, rows, filtersSummary, filenamePrefix } = opts;
  const weights = columns.map(c => c.weight ?? 1);

  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 10;
  const usableWidth = pageWidth - margin * 2;
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  const colWidths = weights.map(w => (w / totalWeight) * usableWidth);
  const headerRowHeight = 7;
  const dataRowHeight = 6.5;

  function drawColumnHeader(y: number): number {
    pdf.setFillColor(248, 250, 253);
    pdf.rect(margin, y, usableWidth, headerRowHeight, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(0, 136, 204);
    let x = margin;
    columns.forEach((c, i) => {
      pdf.text(truncateToWidth(pdf, c.label, colWidths[i] - 3), x + 1.5, y + headerRowHeight - 2);
      x += colWidths[i];
    });
    return y + headerRowHeight;
  }

  let y = margin;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12);
  pdf.setTextColor(6, 36, 68);
  pdf.text(title, margin, y);
  y += 6;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8.5);
  pdf.setTextColor(100, 116, 139);
  pdf.text(`Generated ${new Date().toLocaleString()} • ${rows.length} scholar${rows.length === 1 ? "" : "s"}`, margin, y);
  y += 5;
  pdf.text(filtersSummary, margin, y);
  y += 6;

  y = drawColumnHeader(y);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7.5);
  pdf.setTextColor(51, 65, 85);

  for (const row of rows) {
    if (y + dataRowHeight > pageHeight - margin) {
      pdf.addPage();
      y = drawColumnHeader(margin);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7.5);
      pdf.setTextColor(51, 65, 85);
    }
    let x = margin;
    columns.forEach((c, i) => {
      pdf.text(truncateToWidth(pdf, c.value(row), colWidths[i] - 3), x + 1.5, y + dataRowHeight - 2);
      x += colWidths[i];
    });
    pdf.setDrawColor(240, 243, 248);
    pdf.line(margin, y + dataRowHeight, margin + usableWidth, y + dataRowHeight);
    y += dataRowHeight;
  }

  const pageCount = pdf.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    pdf.setPage(p);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    pdf.setTextColor(148, 163, 184);
    pdf.text(`Page ${p} of ${pageCount}`, pageWidth - margin, pageHeight - 4, { align: "right" });
  }

  pdf.save(`${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.pdf`);
}

export interface ProfilePdfSection {
  heading: string;
  columns: string[];
  rows: string[][];
  emptyMessage: string;
}

/**
 * PDF variant of the Comprehensive Scholar Profile (see also
 * generateComprehensiveScholarProfile in docGenerator.ts for the Word
 * version, and ScholarListPanel.tsx for the CSV version) — a portrait,
 * multi-section document rather than one flat table, so it's drawn here
 * directly with jsPDF rather than reusing exportTableAsPdf above.
 */
export async function exportComprehensiveScholarProfilePdf(opts: {
  scholarIdNumber: string;
  basicInfo: { label: string; value: string }[];
  sections: ProfilePdfSection[];
}): Promise<void> {
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 14;
  const usableWidth = pageWidth - margin * 2;
  let y = margin;

  function ensureSpace(next: number) {
    if (y + next > pageHeight - margin) {
      pdf.addPage();
      y = margin;
    }
  }

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(14);
  pdf.setTextColor(6, 36, 68);
  pdf.text("COMPREHENSIVE SCHOLAR PROFILE", pageWidth / 2, y, { align: "center" });
  y += 6;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(100, 116, 139);
  pdf.text(`Generated ${new Date().toLocaleString()}`, pageWidth / 2, y, { align: "center" });
  y += 9;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.setTextColor(6, 36, 68);
  pdf.text("Basic Information", margin, y);
  y += 5.5;
  pdf.setFontSize(9);
  for (const { label, value } of opts.basicInfo) {
    ensureSpace(5.5);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(51, 65, 85);
    pdf.text(`${label}:`, margin, y);
    pdf.setFont("helvetica", "normal");
    pdf.text(value || "—", margin + 38, y);
    y += 5.5;
  }
  y += 3;

  for (const section of opts.sections) {
    ensureSpace(11);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    pdf.setTextColor(6, 36, 68);
    pdf.text(section.heading, margin, y);
    y += 5.5;

    if (section.rows.length === 0) {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.setTextColor(148, 163, 184);
      pdf.text(section.emptyMessage, margin, y);
      y += 8;
      continue;
    }

    const colWidths = section.columns.map(() => usableWidth / section.columns.length);
    ensureSpace(6.5);
    pdf.setFillColor(248, 250, 253);
    pdf.rect(margin, y, usableWidth, 6, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(0, 136, 204);
    let x = margin;
    section.columns.forEach((c, i) => {
      pdf.text(truncateToWidth(pdf, c, colWidths[i] - 3), x + 1.5, y + 4.2);
      x += colWidths[i];
    });
    y += 6;

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(51, 65, 85);
    for (const row of section.rows) {
      ensureSpace(5.5);
      x = margin;
      row.forEach((value, i) => {
        pdf.text(truncateToWidth(pdf, value, colWidths[i] - 3), x + 1.5, y + 3.8);
        x += colWidths[i];
      });
      pdf.setDrawColor(240, 243, 248);
      pdf.line(margin, y + 5.5, margin + usableWidth, y + 5.5);
      y += 5.5;
    }
    y += 4;
  }

  const pageCount = pdf.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    pdf.setPage(p);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    pdf.setTextColor(148, 163, 184);
    pdf.text(`Page ${p} of ${pageCount}`, pageWidth - margin, pageHeight - 4, { align: "right" });
  }

  pdf.save(`Scholar_Profile_${opts.scholarIdNumber}_${new Date().toISOString().slice(0, 10)}.pdf`);
}
