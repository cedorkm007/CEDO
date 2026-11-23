// ─────────────────────────────────────────────────────────────
// src/sead/creditedExport.ts
// SDP Monitoring > Credited Scholars > Export: EVERY row that matches the list, the filters and the search (not just the page on the screen), read page by page (500 at a time) with a progress count,
// then written as one Excel (.xlsx) or CSV file. Nothing is changed in the database.
// ─────────────────────────────────────────────────────────────
import { buildXlsx } from "@/lib/xlsxLite";
import { manilaDay } from "@/scholar/sdpApi";
import {
  CREDITED_EXPORT_HEADERS, EXPORT_PAGE, NOT_CREDITED_EXPORT_HEADERS, creditedExportRow, exportFileName, notCreditedExportRow, toCsv,
  type ExportActivity, type ExportFormat, type ListKind,
} from "@/lib/sdpCreditedFilters";
import type { CreditedSort } from "@/lib/sdpCreditedView";
import { fetchFilteredCredits, fetchFilteredNotCredited } from "./sdpCreditedFiltersApi";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Gives a file to the browser's download. */
export function downloadBytes(bytes: BlobPart, name: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** A table (header row first) as an .xlsx or .csv file. */
export async function downloadTable(rows: (string | number | null)[][], name: string, format: ExportFormat, widths?: number[], sheetName = "Sheet1"): Promise<void> {
  if (format === "csv") { downloadBytes(toCsv(rows), name, "text/csv;charset=utf-8"); return; }
  const bytes = await buildXlsx({ name: sheetName, rows: rows.map((r, i) => (i === 0 ? r.map(v => ({ value: v, style: "header" as const })) : r)), widths });
  downloadBytes(bytes as BlobPart, name, XLSX_MIME);
}

export interface ExportRequest {
  activityId: string; activity: ExportActivity; kind: ListKind; filters: Record<string, unknown>; search: string; sort: CreditedSort; format: ExportFormat;
  sessionNameOf: (activityDay: string | null, activitySid: string | null, attendedDate: string) => string;
  onProgress: (done: number, total: number) => void; isCancelled: () => boolean;
}
export type ExportResult = { ok: true; rows: number; fileName: string } | { ok: false; error: string; cancelled?: boolean };

export async function exportList(req: ExportRequest): Promise<ExportResult> {
  const table: (string | number | null)[][] = [req.kind === "credited" ? CREDITED_EXPORT_HEADERS : NOT_CREDITED_EXPORT_HEADERS];
  let total = 0;
  for (let page = 1; ; page++) {
    if (req.isCancelled()) return { ok: false, error: "The export was cancelled.", cancelled: true };
    if (req.kind === "credited") {
      const r = await fetchFilteredCredits(req.activityId, req.filters, req.search, req.sort, page, EXPORT_PAGE);
      if (!r.ok) return { ok: false, error: r.error };
      total = r.total;
      for (const x of r.rows) table.push(creditedExportRow({ ...x, sessionName: req.sessionNameOf(x.activityDay, x.activitySid, x.attendedDate) }, req.activity));
      req.onProgress(table.length - 1, total);
      if (r.rows.length < EXPORT_PAGE || table.length - 1 >= total) break;
    } else {
      const r = await fetchFilteredNotCredited(req.activityId, req.kind, req.filters, req.search, page, EXPORT_PAGE);
      if (!r.ok) return { ok: false, error: r.error };
      total = r.total;
      for (const x of r.rows) table.push(notCreditedExportRow({ ...x, status: x.scholarStatus }, req.activity));
      req.onProgress(table.length - 1, total);
      if (r.rows.length < EXPORT_PAGE || table.length - 1 >= total) break;
    }
  }
  const fileName = exportFileName(req.activity.name, req.kind, manilaDay(new Date().toISOString()), req.format);
  const widths = req.kind === "credited" ? [16, 28, 12, 28, 24, 18, 10, 36, 20, 22, 14, 26, 8, 22, 24] : [16, 28, 12, 28, 24, 18, 10, 16, 36, 20, 22, 36];
  await downloadTable(table, fileName, req.format, widths, req.kind === "credited" ? "Credited" : "Not credited");
  return { ok: true, rows: table.length - 1, fileName };
}
