/**
 * docGenerator.ts
 * Generates Word (.docx) documents matching the LGU-CDO formats:
 *   1. Accomplishment Report  (Accomplishment_Report_FORMAT.docx)
 *   2. Accomplishment History (Accomplishment_History.docx)
 *
 * Both formats are reproduced field-for-field from the official templates:
 * same page size/orientation/margins, same letterhead, same table grid
 * (widths, borders, no shading), same fonts/sizes, and the same
 * Prepared-by / Approved-by signature block layout.
 */

import {
  Document, Packer, Paragraph, Table, TableRow, TableCell,
  TextRun, AlignmentType, WidthType, BorderStyle,
  ShadingType, VerticalAlign, Header, ImageRun,
  PageBorderDisplay, PageBorderOffsetFrom,
} from 'docx'
import { saveAs } from 'file-saver'
import letterheadUrl from '@/imports/CEDO_Letterhead.png'

// ── Shared helpers ───────────────────────────────────────────

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

const FONT = 'Arial'

// Letterhead image is 1121x173px in the source template, placed at
// 6081713 x 941112 EMU (÷9525 = px) in the header.
const LOGO_WIDTH = 639
const LOGO_HEIGHT = 99

let cachedLogoBuffer: ArrayBuffer | null = null
async function getLogoBuffer(): Promise<ArrayBuffer> {
  if (cachedLogoBuffer) return cachedLogoBuffer
  const res = await fetch(letterheadUrl)
  cachedLogoBuffer = await res.arrayBuffer()
  return cachedLogoBuffer
}

async function buildLetterheadHeader(): Promise<Header> {
  const buffer = await getLogoBuffer()
  return new Header({
    children: [
      new Paragraph({
        children: [
          new ImageRun({
            data: buffer,
            transformation: { width: LOGO_WIDTH, height: LOGO_HEIGHT },
          }),
        ],
      }),
    ],
  })
}

function bold(text: string, size = 24, underline = false): TextRun {
  return new TextRun({ text, bold: true, size, font: FONT, underline: underline ? {} : undefined })
}

function normal(text: string, size = 24, underline = false): TextRun {
  return new TextRun({ text, size, font: FONT, underline: underline ? {} : undefined })
}

function tabs(count: number): TextRun[] {
  return Array.from({ length: count }, () => new TextRun({ text: '\t', size: 24, font: FONT }))
}

function cell(
  children: Paragraph[],
  opts: { width?: number; vAlign?: (typeof VerticalAlign)[keyof typeof VerticalAlign] } = {},
): TableCell {
  return new TableCell({
    children,
    width: opts.width ? { size: opts.width, type: WidthType.DXA } : undefined,
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'auto' },
    verticalAlign: opts.vAlign ?? VerticalAlign.CENTER,
    margins: { top: 100, bottom: 100, left: 100, right: 100 },
    borders: {
      top:    { style: BorderStyle.SINGLE, size: 8, color: '000000' },
      bottom: { style: BorderStyle.SINGLE, size: 8, color: '000000' },
      left:   { style: BorderStyle.SINGLE, size: 8, color: '000000' },
      right:  { style: BorderStyle.SINGLE, size: 8, color: '000000' },
    },
  })
}

function headerCell(text: string, width: number): TableCell {
  return cell(
    [new Paragraph({ children: [bold(text, 24)], alignment: AlignmentType.CENTER })],
    { width, vAlign: VerticalAlign.CENTER },
  )
}

function emptyParagraph(): Paragraph {
  return new Paragraph({ children: [new TextRun({ text: '', font: FONT })] })
}

// ── 1. Accomplishment Report ─────────────────────────────────
// Format: LGU-CDO Accomplishment Report Template_JO_Form3 (landscape A4)
//
// [Letterhead]
// ACCOMPLISHMENT REPORT
// [Month date-range, year]  (bold, underlined)
// Table: NAME | NATURE OF WORK | ACCOMPLISHMENT REPORT
//   — a single row per staff member. The ACCOMPLISHMENT REPORT cell holds a
//     numbered list; each numbered item has a bold heading followed by a
//     plain-text description, all within the same cell (no extra rows).
// Prepared by: ................................ Approved by:
// [FULL NAME]                                    RICHEL PETALCURIN-DAHAY
// [Position]                                     Acting City Education and Development Officer
// [Nature of Work]

export interface AccomplishmentItem {
  heading: string        // e.g. "Presented the first Prototype of the Scholars' Bridging Application"
  description: string    // e.g. "Presented the initial working prototype ... continuous technical improvement."
}

export interface AccomplishmentReportOptions {
  staffName: string
  natureOfWork: string      // e.g. "Learning and Instructional Support" — printed in the NATURE OF WORK column
  staffItem: string         // printed on the line under the staff name (now: Position)
  staffPosition?: string    // printed on the line below that (now: Nature of Work)
  dateRange: string         // e.g. "July 1-15, 2025"
  items: AccomplishmentItem[]
}

export async function generateAccomplishmentReport(opts: AccomplishmentReportOptions): Promise<void> {
  // Column widths (DXA) — exact match to the official template's table grid
  const COL_NAME    = 3675
  const COL_NATURE  = 2625
  const COL_ACCOMP  = 9015
  const TABLE_WIDTH = COL_NAME + COL_NATURE + COL_ACCOMP // 15315

  const items = opts.items.length > 0 ? opts.items : [{ heading: '', description: '' }]

  // Build the numbered list inside a single ACCOMPLISHMENT REPORT cell:
  // "1. Heading" (bold) followed by the description (normal), for each item.
  const accomplishmentParagraphs: Paragraph[] = items.flatMap((item, i) => [
    new Paragraph({
      children: [bold(`${i + 1}. ${item.heading}`, 24)],
      spacing: { before: i === 0 ? 0 : 160 },
    }),
    new Paragraph({
      children: [normal(item.description, 24)],
    }),
  ])

  const tableRows: TableRow[] = [
    // Header row
    new TableRow({
      tableHeader: true,
      children: [
        headerCell('NAME', COL_NAME),
        headerCell('NATURE OF WORK', COL_NATURE),
        headerCell('ACCOMPLISHMENT REPORT', COL_ACCOMP),
      ],
    }),
    // Single data row — no per-accomplishment rows are added
    new TableRow({
      children: [
        cell(
          [new Paragraph({ children: [normal(opts.staffName, 24)] })],
          { width: COL_NAME },
        ),
        cell(
          [new Paragraph({ children: [normal(opts.natureOfWork, 24)] })],
          { width: COL_NATURE },
        ),
        cell(accomplishmentParagraphs, { width: COL_ACCOMP, vAlign: VerticalAlign.TOP }),
      ],
    }),
  ]

  const header = await buildLetterheadHeader()

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { width: 16838, height: 11906 },   // A4 landscape (DXA)
          margin: { top: 1440, right: 720, bottom: 431, left: 720, header: 720, footer: 720 },
        },
      },
      headers: { default: header },
      children: [
        // Title
        new Paragraph({
          children: [bold('ACCOMPLISHMENT REPORT', 36)],
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
        }),
        // Date range
        new Paragraph({
          children: [bold(opts.dateRange, 24, true)],
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
        }),
        // Main table
        new Table({
          width: { size: TABLE_WIDTH, type: WidthType.DXA },
          columnWidths: [COL_NAME, COL_NATURE, COL_ACCOMP],
          rows: tableRows,
        }),
        emptyParagraph(),
        emptyParagraph(),
        // Prepared by / Approved by
        new Paragraph({
          children: [normal('Prepared by:', 24), ...tabs(8), normal('Approved by:', 24)],
        }),
        emptyParagraph(),
        new Paragraph({
          children: [
            bold(opts.staffName.toUpperCase(), 24, true),
            ...tabs(8),
            bold('RICHEL PETALCURIN-DAHAY', 24, true),
          ],
        }),
        new Paragraph({
          children: [
            normal(opts.staffItem, 24),
            ...tabs(9),
            normal('Acting City Education and Development Officer', 24),
          ],
        }),
        new Paragraph({
          children: [normal(opts.staffPosition ?? '', 24)],
        }),
      ],
    }],
  })

  const blob = await Packer.toBlob(doc)
  saveAs(blob, `Accomplishment_Report_${opts.staffName.replace(/\s+/g,'_')}.docx`)
}

// ── 2. Accomplishment History ────────────────────────────────
// Format: LGU-CDO Accomplishment Report Template_JO_Form3 (portrait A4)
//
// [Letterhead]
// ACCOMPLISHMENT HISTORY
// Table: ACCOMPLISHMENTS | DATE

export interface HistoryRow {
  accomplishment: string
  date: string
}

export interface AccomplishmentHistoryOptions {
  staffName: string
  rows: HistoryRow[]
}

export async function generateAccomplishmentHistory(opts: AccomplishmentHistoryOptions): Promise<void> {
  // Column widths (DXA) — exact match to the official template's table grid
  const COL_ACCOMP = 5944
  const COL_DATE   = 3544
  const TABLE_WIDTH = COL_ACCOMP + COL_DATE // 9488

  const dataRows = opts.rows.length > 0 ? opts.rows : [{ accomplishment: '', date: '' }]

  const tableRows: TableRow[] = [
    // Header
    new TableRow({
      tableHeader: true,
      children: [
        headerCell('ACCOMPLISHMENTS', COL_ACCOMP),
        headerCell('DATE', COL_DATE),
      ],
    }),
    ...dataRows.map(
      row => new TableRow({
        children: [
          cell(
            [new Paragraph({ children: [normal(row.accomplishment, 24)] })],
            { width: COL_ACCOMP },
          ),
          cell(
            [new Paragraph({ children: [normal(row.date, 24)] })],
            { width: COL_DATE },
          ),
        ],
      })
    ),
  ]

  const header = await buildLetterheadHeader()

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },   // A4 portrait (DXA)
          margin: { top: 720, right: 431, bottom: 720, left: 1440, header: 720, footer: 720 },
        },
      },
      headers: { default: header },
      children: [
        new Paragraph({
          children: [bold('ACCOMPLISHMENT HISTORY', 36)],
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
        }),
        new Table({
          width: { size: TABLE_WIDTH, type: WidthType.DXA },
          columnWidths: [COL_ACCOMP, COL_DATE],
          rows: tableRows,
        }),
        emptyParagraph(),
      ],
    }],
  })

  const blob = await Packer.toBlob(doc)
  saveAs(blob, `Accomplishment_History_${opts.staffName.replace(/\s+/g,'_')}.docx`)
}

// ── Helper: format a date range string for display ─────────────
export function formatDateRange(month: number, year: number, half: 'first' | 'second' | 'full'): string {
  const m = MONTHS[month]
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  if (half === 'first')  return `${m} 1-15, ${year}`
  if (half === 'second') return `${m} 16-${daysInMonth}, ${year}`
  return `${m} 1-${daysInMonth}, ${year}`
}

// ── 3. CTO Application ───────────────────────────────────────
// PROVISIONAL layout — built from the standard CSC compensatory-time-off
// request fields. Swap this for the official CEDO template once it's
// supplied (see docs/FORMS_TEMPLATES.md).

export interface CTOFormOptions {
  staffName: string
  division: string
  position: string
  dateFrom: string    // display-formatted, e.g. "July 14, 2026"
  dateTo: string       // same as dateFrom for a single day
  dayType: 'Full Day' | 'Half Day (AM)' | 'Half Day (PM)'
  totalDays: string     // e.g. "1" or "3"
  reason: string
}

function labeledRow(label: string, value: string, labelWidth = 3200): TableRow {
  return new TableRow({
    children: [
      cell([new Paragraph({ children: [bold(label, 22)] })], { width: labelWidth }),
      cell([new Paragraph({ children: [normal(value || ' ', 22)] })], { width: 9488 - labelWidth }),
    ],
  })
}

export async function generateCTOForm(opts: CTOFormOptions): Promise<void> {
  const header = await buildLetterheadHeader()
  const COL_LABEL = 3200
  const COL_VALUE = 9488 - COL_LABEL

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 720, right: 431, bottom: 720, left: 1440, header: 720, footer: 720 },
        },
      },
      headers: { default: header },
      children: [
        new Paragraph({ children: [bold('APPLICATION FOR COMPENSATORY TIME-OFF (CTO)', 32)], alignment: AlignmentType.CENTER, spacing: { after: 300 } }),
        new Table({
          width: { size: 9488, type: WidthType.DXA },
          columnWidths: [COL_LABEL, COL_VALUE],
          rows: [
            labeledRow('Name of Employee', opts.staffName),
            labeledRow('Division', opts.division),
            labeledRow('Position', opts.position),
            labeledRow('Date(s) Requested', opts.dateFrom === opts.dateTo ? opts.dateFrom : `${opts.dateFrom} – ${opts.dateTo}`),
            labeledRow('Day Type', opts.dayType),
            labeledRow('Total Day(s)', opts.totalDays),
            labeledRow('Reason', opts.reason || '—'),
          ],
        }),
        emptyParagraph(), emptyParagraph(),
        new Paragraph({ children: [normal('I certify that the above information is true and correct, and that the compensatory time-off requested is charged against my accumulated overtime credits.', 22)], spacing: { after: 400 } }),
        new Paragraph({ children: [normal('Applicant\u2019s Signature over Printed Name:', 22)], spacing: { after: 600 } }),
        new Paragraph({ children: [normal('_______________________________________', 22)] }),
        emptyParagraph(),
        new Paragraph({ children: [normal('Recommending Approval:', 22), ...tabs(6), normal('Approved by:', 22)] }),
        emptyParagraph(), emptyParagraph(),
        new Paragraph({ children: [normal('_______________________________________', 22), ...tabs(2), normal('_______________________________________', 22)] }),
        new Paragraph({ children: [normal('Division Head', 22), ...tabs(9), normal('CEDO Department Head', 22)] }),
      ],
    }],
  })

  const blob = await Packer.toBlob(doc)
  saveAs(blob, `CTO_Application_${opts.staffName.replace(/\s+/g,'_')}.docx`)
}

// ── 4. Pass Slip ──────────────────────────────────────────────
// PROVISIONAL layout — built from the standard CSC pass slip fields.
// Swap this for the official CEDO template once it's supplied.

export interface PassSlipFormOptions {
  staffName: string
  division: string
  position: string
  date: string        // display-formatted
  timeOut: string
  timeIn: string
  purpose: string
}

export async function generatePassSlipForm(opts: PassSlipFormOptions): Promise<void> {
  const header = await buildLetterheadHeader()
  const COL_LABEL = 3200
  const COL_VALUE = 9488 - COL_LABEL

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 720, right: 431, bottom: 720, left: 1440, header: 720, footer: 720 },
        },
      },
      headers: { default: header },
      children: [
        new Paragraph({ children: [bold('OFFICIAL PASS SLIP', 32)], alignment: AlignmentType.CENTER, spacing: { after: 300 } }),
        new Table({
          width: { size: 9488, type: WidthType.DXA },
          columnWidths: [COL_LABEL, COL_VALUE],
          rows: [
            labeledRow('Name of Employee', opts.staffName),
            labeledRow('Division', opts.division),
            labeledRow('Position', opts.position),
            labeledRow('Date', opts.date),
            labeledRow('Time Out', opts.timeOut),
            labeledRow('Time In (expected)', opts.timeIn),
            labeledRow('Purpose', opts.purpose || '—'),
          ],
        }),
        emptyParagraph(), emptyParagraph(),
        new Paragraph({ children: [normal('This pass slip is limited to a maximum of three (3) hours and must be countersigned by the immediate supervisor.', 22)], spacing: { after: 400 } }),
        new Paragraph({ children: [normal('Requested by:', 22), ...tabs(6), normal('Approved by:', 22)] }),
        emptyParagraph(), emptyParagraph(),
        new Paragraph({ children: [normal('_______________________________________', 22), ...tabs(2), normal('_______________________________________', 22)] }),
        new Paragraph({ children: [normal('Employee Signature', 22), ...tabs(10), normal('Division Head', 22)] }),
      ],
    }],
  })

  const blob = await Packer.toBlob(doc)
  saveAs(blob, `Pass_Slip_${opts.staffName.replace(/\s+/g,'_')}.docx`)
}

// ── 5. Scholars Information Report ───────────────────────────
// Milestone 4b. Unlike 1-4 above, this isn't reproducing a fixed
// official template — it's a dynamic-width data table (landscape A4,
// letterhead header, one row per scholar), closest in structure to
// Accomplishment History's ACCOMPLISHMENTS | DATE table above, just with
// a caller-supplied column set instead of two fixed columns. Column
// labels/order/values are entirely supplied by the caller
// (buildExportColumns() in ScholarsTab.tsx) so this function has no
// knowledge of ScholarInformationRow, filters, or Supabase — it only
// lays out already-formatted string cells, the same separation of
// concerns Accomplishment Report/History already keep from their own
// callers.

export interface ScholarsInformationReportOptions {
  columns: string[]
  /**
   * Relative width per column, same length/order as `columns` — e.g.
   * passing 1.6 for the Name column and 1 for every other one mirrors
   * the Milestone 4a PDF export's own column-weighting exactly, so a
   * downloaded Word table reads with the same proportions as the PDF.
   * Defaults to equal weight per column if omitted or mismatched in length.
   */
  columnWeights?: number[]
  rows: string[][]
  /** Display-formatted, e.g. "August 25, 2026, 3:45 PM". */
  generatedAt: string
  /** e.g. "Filters: none" — the same describeAppliedFilters() output the PDF export's header block already uses, for a consistent "what this file does/doesn't include" summary across formats. */
  filtersSummary: string
}

export async function generateScholarsInformationReport(opts: ScholarsInformationReportOptions): Promise<void> {
  // Usable width (DXA) for landscape A4 with the same 720-DXA side
  // margins Accomplishment Report already uses below: 16838 - 720 - 720.
  const TABLE_WIDTH = 15398
  const weights = opts.columnWeights && opts.columnWeights.length === opts.columns.length
    ? opts.columnWeights
    : opts.columns.map(() => 1)
  const totalWeight = weights.reduce((sum, w) => sum + w, 0)
  const rawWidths = weights.map(w => (w / totalWeight) * TABLE_WIDTH)
  // Round every column except the last, then let the last absorb whatever
  // rounding remainder is left so the row still sums to exactly
  // TABLE_WIDTH — docx expects a table's declared width to match its
  // columns' widths.
  const colWidths = rawWidths.map((w, i) =>
    i === rawWidths.length - 1
      ? TABLE_WIDTH - rawWidths.slice(0, -1).reduce((sum, x) => sum + Math.round(x), 0)
      : Math.round(w)
  )

  const tableRows: TableRow[] = [
    new TableRow({
      tableHeader: true, // repeats this row on every page — same convention as every other table above
      children: opts.columns.map((label, i) => headerCell(label, colWidths[i])),
    }),
    ...opts.rows.map(row => new TableRow({
      children: row.map((value, i) => cell(
        // Body text at 20 (10pt) rather than the usual 24 (12pt) default —
        // deliberate size step-down from the header, matching the same
        // header/body distinction the Milestone 4a PDF export already
        // makes for the same reason: up to 9 columns need to stay
        // readable without any one column becoming too narrow to hold a
        // typical value.
        [new Paragraph({ children: [normal(value, 20)] })],
        { width: colWidths[i] },
      )),
    })),
  ]

  const header = await buildLetterheadHeader()

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { width: 16838, height: 11906 },   // A4 landscape (DXA), same as Accomplishment Report
          margin: { top: 1440, right: 720, bottom: 431, left: 720, header: 720, footer: 720 },
        },
      },
      headers: { default: header },
      children: [
        new Paragraph({
          children: [bold('SCHOLARS INFORMATION REPORT', 36)],
          alignment: AlignmentType.CENTER,
          spacing: { after: 120 },
        }),
        new Paragraph({
          children: [normal(`Generated ${opts.generatedAt} • ${opts.rows.length} scholar${opts.rows.length === 1 ? '' : 's'}`, 20)],
          alignment: AlignmentType.CENTER,
          spacing: { after: 60 },
        }),
        new Paragraph({
          children: [normal(opts.filtersSummary, 20)],
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
        }),
        new Table({
          width: { size: TABLE_WIDTH, type: WidthType.DXA },
          columnWidths: colWidths,
          rows: tableRows,
        }),
      ],
    }],
  })

  const blob = await Packer.toBlob(doc)
  saveAs(blob, `Scholars_Information_${new Date().toISOString().slice(0, 10)}.docx`)
}

// ── 5b. Financial Assistance Applicants Report ───────────────
// Same dynamic-width table structure as Scholars Information Report
// above — deliberately a separate function per this project's own
// "one function per document type" convention (see the comment on the
// Submission Monitoring Roster Report below), not a generalization of
// that one, since Financial Assistance applicants are a distinct
// document type even though the table shape happens to overlap.

export interface FinancialAssistanceReportOptions {
  columns: string[]
  columnWeights?: number[]
  rows: string[][]
  generatedAt: string
  filtersSummary: string
}

export async function generateFinancialAssistanceReport(opts: FinancialAssistanceReportOptions): Promise<void> {
  const TABLE_WIDTH = 15398
  const weights = opts.columnWeights && opts.columnWeights.length === opts.columns.length
    ? opts.columnWeights
    : opts.columns.map(() => 1)
  const totalWeight = weights.reduce((sum, w) => sum + w, 0)
  const rawWidths = weights.map(w => (w / totalWeight) * TABLE_WIDTH)
  const colWidths = rawWidths.map((w, i) =>
    i === rawWidths.length - 1
      ? TABLE_WIDTH - rawWidths.slice(0, -1).reduce((sum, x) => sum + Math.round(x), 0)
      : Math.round(w)
  )

  const tableRows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: opts.columns.map((label, i) => headerCell(label, colWidths[i])),
    }),
    ...opts.rows.map(row => new TableRow({
      children: row.map((value, i) => cell(
        [new Paragraph({ children: [normal(value, 20)] })],
        { width: colWidths[i] },
      )),
    })),
  ]

  const header = await buildLetterheadHeader()

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { width: 16838, height: 11906 },
          margin: { top: 1440, right: 720, bottom: 431, left: 720, header: 720, footer: 720 },
        },
      },
      headers: { default: header },
      children: [
        new Paragraph({
          children: [bold('FINANCIAL ASSISTANCE APPLICANTS REPORT', 36)],
          alignment: AlignmentType.CENTER,
          spacing: { after: 120 },
        }),
        new Paragraph({
          children: [normal(`Generated ${opts.generatedAt} • ${opts.rows.length} applicant${opts.rows.length === 1 ? '' : 's'}`, 20)],
          alignment: AlignmentType.CENTER,
          spacing: { after: 60 },
        }),
        new Paragraph({
          children: [normal(opts.filtersSummary, 20)],
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
        }),
        new Table({
          width: { size: TABLE_WIDTH, type: WidthType.DXA },
          columnWidths: colWidths,
          rows: tableRows,
        }),
      ],
    }],
  })

  const blob = await Packer.toBlob(doc)
  saveAs(blob, `Financial_Assistance_Applicants_${new Date().toISOString().slice(0, 10)}.docx`)
}

// ── 6. Submission Monitoring Roster Report ───────────────────
// Same dynamic-width table structure as Scholars Information Report
// above (reused deliberately rather than generalizing that function's
// hardcoded title/filename into a shared helper — this project's own
// convention here is one function per document type, matching Pass
// Slip / Accomplishment Report / Accomplishment History / Scholars
// Information each having their own function despite some layout
// overlap). One addition Scholars Information doesn't need: an
// activityName line, since a roster is always scoped to one submission
// activity, unlike the Scholars Information report which isn't scoped
// to any single entity.

export interface SubmissionRosterReportOptions {
  activityName: string
  columns: string[]
  columnWeights?: number[]
  rows: string[][]
  generatedAt: string
  /** e.g. "Filters: Year Level = 3rd Year; Status = Needs Resubmission" — same convention as ScholarsInformationReportOptions.filtersSummary. */
  filtersSummary: string
}

export async function generateSubmissionRosterReport(opts: SubmissionRosterReportOptions): Promise<void> {
  const TABLE_WIDTH = 15398
  const weights = opts.columnWeights && opts.columnWeights.length === opts.columns.length
    ? opts.columnWeights
    : opts.columns.map(() => 1)
  const totalWeight = weights.reduce((sum, w) => sum + w, 0)
  const rawWidths = weights.map(w => (w / totalWeight) * TABLE_WIDTH)
  const colWidths = rawWidths.map((w, i) =>
    i === rawWidths.length - 1
      ? TABLE_WIDTH - rawWidths.slice(0, -1).reduce((sum, x) => sum + Math.round(x), 0)
      : Math.round(w)
  )

  const tableRows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: opts.columns.map((label, i) => headerCell(label, colWidths[i])),
    }),
    ...opts.rows.map(row => new TableRow({
      children: row.map((value, i) => cell(
        [new Paragraph({ children: [normal(value, 20)] })],
        { width: colWidths[i] },
      )),
    })),
  ]

  const header = await buildLetterheadHeader()

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { width: 16838, height: 11906 },
          margin: { top: 1440, right: 720, bottom: 431, left: 720, header: 720, footer: 720 },
        },
      },
      headers: { default: header },
      children: [
        new Paragraph({
          children: [bold('SUBMISSION MONITORING ROSTER', 36)],
          alignment: AlignmentType.CENTER,
          spacing: { after: 60 },
        }),
        new Paragraph({
          children: [bold(opts.activityName, 26)],
          alignment: AlignmentType.CENTER,
          spacing: { after: 120 },
        }),
        new Paragraph({
          children: [normal(`Generated ${opts.generatedAt} • ${opts.rows.length} scholar${opts.rows.length === 1 ? '' : 's'}`, 20)],
          alignment: AlignmentType.CENTER,
          spacing: { after: 60 },
        }),
        new Paragraph({
          children: [normal(opts.filtersSummary, 20)],
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
        }),
        new Table({
          width: { size: TABLE_WIDTH, type: WidthType.DXA },
          columnWidths: colWidths,
          rows: tableRows,
        }),
      ],
    }],
  })

  const blob = await Packer.toBlob(doc)
  saveAs(blob, `Submission_Roster_${opts.activityName.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.docx`)
}

// ── 7. Comprehensive Scholar Profile ─────────────────────────
// The Scholarship Program Information tab's per-scholar export: basic
// info plus three subsystem sections (SDP, Formation Activities, Quest).
// Unlike every report above, this is a single-entity, multi-section
// document rather than one flat table, so it's built from scratch rather
// than reusing generateScholarsInformationReport's table layout — but it
// still reuses the same low-level helpers (labeledRow, headerCell, cell,
// normal, bold) already defined in this file. Kept generic (plain string
// fields, no imported sead-specific types) to match this file's existing
// convention of not depending on app-layer types.

export interface ComprehensiveScholarProfileOptions {
  scholar: {
    scholarIdNumber: string
    lastName: string
    firstName: string
    middleName: string
    school: string
    course: string
    yearLevel: string
    status: string
    barangay: string
    birthday: string
    civilStatus: string
    contactNo: string
  }
  sdpCompleted: { activityName: string; category: string; date: string }[]
  formationAttended: { activityName: string; dateTime: string; venue: string }[]
  questSubjects: { subjectName: string; topicCount: number; percentage: number; isCompleted: boolean }[]
  generatedAt: string
}

function sectionHeading(text: string): Paragraph {
  return new Paragraph({ children: [bold(text, 26)], spacing: { before: 300, after: 120 } })
}

function simpleTable(columns: string[], colWidths: number[], rows: string[][], emptyMessage: string): (Table | Paragraph)[] {
  if (rows.length === 0) return [new Paragraph({ children: [normal(emptyMessage, 22)], spacing: { after: 120 } })]
  return [new Table({
    width: { size: colWidths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [
      new TableRow({ tableHeader: true, children: columns.map((label, i) => headerCell(label, colWidths[i])) }),
      ...rows.map(row => new TableRow({
        children: row.map((value, i) => cell([new Paragraph({ children: [normal(value, 20)] })], { width: colWidths[i] })),
      })),
    ],
  })]
}

export async function generateComprehensiveScholarProfile(opts: ComprehensiveScholarProfileOptions): Promise<void> {
  const header = await buildLetterheadHeader()
  const COL_LABEL = 3200
  const COL_VALUE = 9488 - COL_LABEL
  const s = opts.scholar

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 }, // portrait A4, same as CTO Form
          margin: { top: 720, right: 431, bottom: 720, left: 1440, header: 720, footer: 720 },
        },
      },
      headers: { default: header },
      children: [
        new Paragraph({ children: [bold('COMPREHENSIVE SCHOLAR PROFILE', 32)], alignment: AlignmentType.CENTER, spacing: { after: 60 } }),
        new Paragraph({ children: [normal(`Generated ${opts.generatedAt}`, 20)], alignment: AlignmentType.CENTER, spacing: { after: 240 } }),

        sectionHeading('Basic Information'),
        new Table({
          width: { size: 9488, type: WidthType.DXA },
          columnWidths: [COL_LABEL, COL_VALUE],
          rows: [
            labeledRow('Scholar ID', s.scholarIdNumber),
            labeledRow('Name', `${s.lastName}, ${s.firstName} ${s.middleName}`.trim()),
            labeledRow('School', s.school || '—'),
            labeledRow('Program', s.course || '—'),
            labeledRow('Year Level', s.yearLevel || '—'),
            labeledRow('Status', s.status || '—'),
            labeledRow('Barangay', s.barangay || '—'),
            labeledRow('Birthday', s.birthday || '—'),
            labeledRow('Civil Status', s.civilStatus || '—'),
            labeledRow('Contact No.', s.contactNo || '—'),
          ],
        }),

        sectionHeading(`SDP — Completed Activities (${opts.sdpCompleted.length})`),
        ...simpleTable(
          ['Activity', 'Category', 'Date'], [5288, 2200, 2000],
          opts.sdpCompleted.map(a => [a.activityName, a.category || '—', a.date || '—']),
          'No completed SDP activities.',
        ),

        sectionHeading(`Formation Activities — Attended (${opts.formationAttended.length})`),
        ...simpleTable(
          ['Activity', 'Date', 'Venue'], [4288, 2400, 2800],
          opts.formationAttended.map(a => [a.activityName, a.dateTime || '—', a.venue || '—']),
          'No formation activity attendance recorded.',
        ),

        sectionHeading(`Quest — Subjects (${opts.questSubjects.length})`),
        ...simpleTable(
          ['Subject', 'Topics Completed', 'Score', 'Status'], [4488, 2400, 1400, 1200],
          opts.questSubjects.map(q => [q.subjectName, String(q.topicCount), `${q.percentage.toFixed(1)}%`, q.isCompleted ? 'Completed' : 'In Progress']),
          'No Quest activity recorded.',
        ),
      ],
    }],
  })

  const blob = await Packer.toBlob(doc)
  saveAs(blob, `Scholar_Profile_${s.scholarIdNumber}_${new Date().toISOString().slice(0, 10)}.docx`)
}

// ── 7. Scholar Counseling Referral Form (Form R5) ────────────
// Reproduces the office's actual paper Referral Form layout (photo
// supplied directly, not a generic label/value form like CTO/Pass Slip
// above): a "FORM R5" badge top-right, a two-column body — labeled
// fill-in fields + checkboxes + the two subject matrices on the left,
// a bordered REMARKS box on the right — and a bottom strip for
// Refer by/to, Date, Endorsed for, and Noted by. Only ever printed once
// a referral has been Approved, so the Division Head's actual signature
// image is embedded on the "Noted by" line instead of a blank line.

export interface ReferralSubjectRow { subjectCode: string; semesterAcademicYear: string; yearLevel: string }

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
const ALL_NO_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER }
const RULE_BORDER = { style: BorderStyle.SINGLE, size: 4, color: '000000' }
const NAVY = '062444'

function borderlessCell(children: (Paragraph | Table)[], width: number, vAlign: (typeof VerticalAlign)[keyof typeof VerticalAlign] = VerticalAlign.TOP): TableCell {
  return new TableCell({ children, width: { size: width, type: WidthType.DXA }, verticalAlign: vAlign, borders: ALL_NO_BORDERS, margins: { top: 20, bottom: 20, left: 0, right: 60 } })
}

/** Bold label followed by the filled-in, underlined value, padded with trailing underlined spaces so the rule keeps running toward the margin like the paper form's blank fill-in line. */
function labeledLine(label: string, value: string, size = 20): Paragraph {
  const padded = `${value || ''}${' '.repeat(22)}`
  return new Paragraph({
    children: [bold(`${label}: `, size), new TextRun({ text: padded, size, font: FONT, underline: {} })],
    spacing: { after: 100 },
  })
}

/** One line of ☑/☐ options — the selected value (matched by exact string) shows checked. */
function checkboxLine(options: string[], selected: string, size = 19): Paragraph {
  const children: TextRun[] = []
  options.forEach((opt, i) => {
    if (i > 0) children.push(normal('     ', size))
    children.push(normal(opt === selected ? '☑ ' : '☐ ', size + 2))
    children.push(normal(opt, size))
  })
  return new Paragraph({ children, spacing: { after: 100 } })
}

function ruledCell(text: string, width: number, isHeader: boolean): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    children: [new Paragraph({ children: [isHeader ? new TextRun({ text, italics: true, size: 16, font: FONT }) : normal(text || ' ', 19)] })],
    borders: { top: NO_BORDER, left: NO_BORDER, right: NO_BORDER, bottom: RULE_BORDER },
    margins: { top: 20, bottom: 60, left: 40, right: 40 },
  })
}

/** Failed Subjects / Lacking Grades — ruled fill-in lines (bottom border only per cell), matching the paper form's look, not a bordered data grid. */
function ruledMatrixTable(rows: ReferralSubjectRow[]): Table {
  const COL: [number, number, number] = [1300, 2200, 700]
  const displayRows = rows.length ? rows : [{ subjectCode: '', semesterAcademicYear: '', yearLevel: '' }]
  return new Table({
    width: { size: COL[0] + COL[1] + COL[2], type: WidthType.DXA },
    columnWidths: COL,
    rows: [
      new TableRow({ children: [ruledCell('(Subject Code)', COL[0], true), ruledCell('(Semester and Academic Year)', COL[1], true), ruledCell('(Yr. Lvl)', COL[2], true)] }),
      ...displayRows.map(r => new TableRow({ children: [ruledCell(r.subjectCode, COL[0], false), ruledCell(r.semesterAcademicYear, COL[1], false), ruledCell(r.yearLevel, COL[2], false)] })),
    ],
  })
}

export interface ReferralFormOptions {
  scholarIdNumber: string
  name: string
  courseYear: string
  school: string
  barangay: string
  contactNo: string
  previousSemesterStatus: string
  failedSubjects: ReferralSubjectRow[]
  lackingGrades: ReferralSubjectRow[]
  referredByName: string
  referredToName: string
  referralDate: string   // display-formatted
  endorsedFor: string
  remarks: string
  approvedByName: string
  approvedAt: string      // display-formatted
  /** The Division Head's actual approved signature image — null only if it genuinely couldn't be fetched. */
  signature: { buffer: ArrayBuffer; width: number; height: number } | null
}

export async function generateReferralForm(opts: ReferralFormOptions): Promise<void> {
  const header = await buildLetterheadHeader()
  const USABLE_WIDTH = 10466 // 11906 page width − 720 left/right margins
  const LEFT_COL = 4966 // ~47/53 split, matching the paper form's proportions
  const RIGHT_COL = USABLE_WIDTH - LEFT_COL

  const signatureParagraph = opts.signature
    ? new Paragraph({ children: [new ImageRun({ data: opts.signature.buffer, transformation: { width: opts.signature.width, height: opts.signature.height } })], spacing: { before: 40, after: 0 } })
    : new Paragraph({ children: [normal('(Signature unavailable)', 18)], spacing: { before: 40, after: 0 } })

  // A precise 3-row × 2-column grid — Refer by/Endorsed for, Refer to/On
  // Probation Status, Date/Removal+Renewal+Noted by — matching the paper
  // form's exact row alignment, not two independently-stacked columns.
  const bottomLeftWidth = Math.round(LEFT_COL * 0.4)
  const bottomRightWidth = LEFT_COL - bottomLeftWidth
  const bottomStrip = new Table({
    width: { size: LEFT_COL, type: WidthType.DXA },
    columnWidths: [bottomLeftWidth, bottomRightWidth],
    rows: [
      new TableRow({ children: [
        borderlessCell([labeledLine('Refer by', opts.referredByName)], bottomLeftWidth),
        borderlessCell([new Paragraph({ children: [bold('Endorsed for:', 20)] })], bottomRightWidth),
      ] }),
      new TableRow({ children: [
        borderlessCell([labeledLine('Refer to', opts.referredToName)], bottomLeftWidth),
        borderlessCell([checkboxLine(['On Probation Status'], opts.endorsedFor)], bottomRightWidth),
      ] }),
      new TableRow({ children: [
        borderlessCell([labeledLine('Date', opts.referralDate)], bottomLeftWidth),
        borderlessCell([
          new Paragraph({ children: (() => {
            const children: TextRun[] = []
            ;['Removal', 'Renewal'].forEach((opt, i) => {
              if (i > 0) children.push(normal('   ', 19))
              children.push(normal(opt === opts.endorsedFor ? '☑ ' : '☐ ', 21))
              children.push(normal(opt, 19))
            })
            children.push(normal('   ', 19), bold('Noted by:', 19))
            return children
          })() }),
          signatureParagraph,
          new Paragraph({ children: [normal(opts.approvedByName, 18)], alignment: AlignmentType.RIGHT }),
        ], bottomRightWidth),
      ] }),
    ],
  })

  const leftColumn: (Paragraph | Table)[] = [
    labeledLine('NAME', opts.name),
    labeledLine('COURSE & YR. LEVEL.', opts.courseYear),
    labeledLine('SCHOOL', opts.school),
    labeledLine('BARANGAY', opts.barangay),
    labeledLine('CONTACT NUMBER', opts.contactNo),
    new Paragraph({ children: [bold('Previous Semester Status:', 20)], spacing: { before: 120, after: 60 } }),
    checkboxLine(['Retained', 'On Probation', 'Special Recon'], opts.previousSemesterStatus),
    new Paragraph({ children: [bold('Failed Subject/s (since admission):', 20)], spacing: { before: 160, after: 60 } }),
    ruledMatrixTable(opts.failedSubjects),
    new Paragraph({ children: [bold('Lacking Grade/s:', 20)], spacing: { before: 160, after: 60 } }),
    ruledMatrixTable(opts.lackingGrades),
    new Paragraph({ children: [normal('', 20)], spacing: { before: 160 } }),
    bottomStrip,
  ]

  // A small badge (not a full-width bar) so it matches the "FORM R5" badge's
  // own cell-shading look exactly, rather than a stretched paragraph fill.
  const remarksBadgeWidth = 1800
  const remarksBadge = new Table({
    width: { size: remarksBadgeWidth, type: WidthType.DXA },
    columnWidths: [remarksBadgeWidth],
    rows: [new TableRow({ children: [
      new TableCell({
        width: { size: remarksBadgeWidth, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: NAVY },
        borders: ALL_NO_BORDERS,
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: [new Paragraph({ children: [new TextRun({ text: 'REMARKS:', bold: true, color: 'FFFFFF', size: 20, font: FONT })] })],
      }),
    ] })],
  })

  const remarksCell = new TableCell({
    width: { size: RIGHT_COL, type: WidthType.DXA },
    verticalAlign: VerticalAlign.TOP,
    borders: { top: RULE_BORDER, bottom: RULE_BORDER, left: RULE_BORDER, right: RULE_BORDER },
    margins: { top: 100, bottom: 100, left: 100, right: 100 },
    children: [
      remarksBadge,
      new Paragraph({ children: [normal('', 20)], spacing: { after: 100 } }),
      new Paragraph({ children: [normal(opts.remarks || '', 20)] }),
    ],
  })

  const bodyTable = new Table({
    width: { size: USABLE_WIDTH, type: WidthType.DXA },
    columnWidths: [LEFT_COL, RIGHT_COL],
    rows: [new TableRow({ children: [borderlessCell(leftColumn, LEFT_COL), remarksCell] })],
  })

  // Title shares the same row as the badge (both vertically centered),
  // matching the paper form's header band — not a separate line below it.
  const titleBadgeRow = new Table({
    width: { size: USABLE_WIDTH, type: WidthType.DXA },
    columnWidths: [USABLE_WIDTH - 2200, 2200],
    rows: [new TableRow({ children: [
      borderlessCell([new Paragraph({ children: [bold('REFERRAL FORM', 30)], alignment: AlignmentType.CENTER })], USABLE_WIDTH - 2200, VerticalAlign.CENTER),
      new TableCell({
        width: { size: 2200, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: NAVY },
        verticalAlign: VerticalAlign.CENTER,
        borders: ALL_NO_BORDERS,
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "FORM R5 (Office's Copy)", bold: true, color: 'FFFFFF', size: 16, font: FONT })] })],
      }),
    ] })],
  })

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 500, right: 720, bottom: 500, left: 720, header: 500, footer: 500 },
          borders: {
            pageBorders: { display: PageBorderDisplay.ALL_PAGES, offsetFrom: PageBorderOffsetFrom.PAGE },
            pageBorderTop: { style: BorderStyle.DOTTED, size: 12, color: '000000', space: 12 },
            pageBorderRight: { style: BorderStyle.DOTTED, size: 12, color: '000000', space: 12 },
            pageBorderBottom: { style: BorderStyle.DOTTED, size: 12, color: '000000', space: 12 },
            pageBorderLeft: { style: BorderStyle.DOTTED, size: 12, color: '000000', space: 12 },
          },
        },
      },
      headers: { default: header },
      children: [
        titleBadgeRow,
        new Paragraph({ children: [], spacing: { after: 160 } }),
        bodyTable,
      ],
    }],
  })

  const blob = await Packer.toBlob(doc)
  saveAs(blob, `Referral_Form_${opts.name.replace(/\s+/g, '_')}.docx`)
}