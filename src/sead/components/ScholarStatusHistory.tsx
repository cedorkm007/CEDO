import { useEffect, useState } from "react";
import { fetchScholarStatusHistory, STATUS_SOURCE_LABEL, type StatusHistoryEntry } from "../statusHistoryApi";
import { DocTable } from "./DocPage";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric", timeZone: "Asia/Manila" });
}

/**
 * One scholar's scholarship status history, newest first. Marks temporary (INC) probation, which does not count as "previous
 * probation" for renewal. Shown in the scholar preview window; if this account may not read it, a short note says so.
 */
export function ScholarStatusHistory({ scholarIdNumber }: { scholarIdNumber: string }) {
  const [rows, setRows] = useState<StatusHistoryEntry[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError("");
    void fetchScholarStatusHistory(scholarIdNumber).then(r => {
      if (cancelled) return;
      if (r.ok) setRows(r.rows); else setError(r.error);
    });
    return () => { cancelled = true; };
  }, [scholarIdNumber]);

  if (error) return <p className="text-[13px] text-slate-600">The status history is not available ({error}).</p>;
  if (!rows) return <p className="text-[13px] text-slate-600">Loading…</p>;
  return (
    <DocTable
      columns={["Date", "Status", "From", "Term", "Changed by", "How"]}
      rows={rows.map(r => [
        formatDate(r.changedAt),
        r.isTemporary ? `${r.status} (temporary — INC)` : r.status,
        r.previousStatus ?? "—",
        [r.term, r.schoolYear].filter(Boolean).join(" ") || "—",
        r.changedByName || "—",
        `${STATUS_SOURCE_LABEL[r.source] ?? r.source}${r.note ? ` — ${r.note}` : ""}`,
      ])}
      emptyMessage="No status changes have been recorded for this scholar yet."
    />
  );
}
