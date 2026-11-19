import { ChevronLeft, ChevronRight } from "lucide-react";
import { pageCount, pageNumbers, showingText } from "@/lib/dailyRecordsView";

/**
 * Pagination for a list that is read PAGE BY PAGE from the database (so the total is the true total, never the number of rows that happened to arrive):
 * "Showing 1–50 of 3,482 records", Previous / Next and the page numbers (1 … 4 5 6 … 70). Used by the Consultation Tool lists.
 */
export function ServerPagination({ page, pageSize, total, onPageChange, noun = "records", disabled = false }: {
  page: number; pageSize: number; total: number; onPageChange: (page: number) => void; noun?: string; disabled?: boolean;
}) {
  const pages = pageCount(total, pageSize);
  const btn = "inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-[13.5px] font-semibold disabled:opacity-40";
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3 py-3 text-[14px] text-slate-700">
      <span aria-live="polite">{showingText(page, pageSize, total, noun)}</span>
      {total > pageSize && (
        <div className="flex flex-wrap items-center gap-1">
          <button type="button" onClick={() => onPageChange(page - 1)} disabled={disabled || page <= 1} className={`${btn} border-[#062444]/25 bg-white text-[#062444] hover:bg-[#f7f9fc]`}><ChevronLeft size={14} aria-hidden="true" /> Previous</button>
          {pageNumbers(page, pages).map((p, i) => p === "…"
            ? <span key={`gap${i}`} className="px-1 text-slate-500" aria-hidden="true">…</span>
            : <button key={p} type="button" onClick={() => onPageChange(p)} disabled={disabled} aria-current={p === page ? "page" : undefined} aria-label={`Page ${p}`}
                className={`${btn} ${p === page ? "border-[#062444] bg-[#062444] text-white" : "border-[#062444]/25 bg-white text-[#062444] hover:bg-[#f7f9fc]"}`}>{p.toLocaleString("en-US")}</button>)}
          <button type="button" onClick={() => onPageChange(page + 1)} disabled={disabled || page >= pages} className={`${btn} border-[#062444]/25 bg-white text-[#062444] hover:bg-[#f7f9fc]`}>Next <ChevronRight size={14} aria-hidden="true" /></button>
        </div>
      )}
    </nav>
  );
}
