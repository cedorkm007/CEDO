import { useEffect, useState } from "react";
import { Search, PlusCircle, MinusCircle, RotateCcw, Pencil, ChevronLeft, ChevronRight } from "lucide-react";
import { fetchScholarAccountLog, ACCOUNT_LOG_PAGE_SIZE, type ScholarLogSortColumn } from "../seadApi";
import { useSortState, SortableTh } from "@/app/components/SortableTable";
import type { ScholarAccountLogEntry } from "../types";

const SOURCE_LABEL: Record<ScholarAccountLogEntry["source"], string> = {
  single: "Single",
  bulk: "Bulk",
  undo: "Bulk undo",
};

const ACTION_META: Record<ScholarAccountLogEntry["action"], { label: string; icon: typeof PlusCircle; className: string }> = {
  added: { label: "Added", icon: PlusCircle, className: "text-green-700 bg-green-100" },
  removed: { label: "Removed", icon: MinusCircle, className: "text-red-600 bg-red-100" },
  reset: { label: "Reset", icon: RotateCcw, className: "text-[#0088cc] bg-[#eef7fc]" },
  updated: { label: "Updated", icon: Pencil, className: "text-orange-600 bg-orange-50" },
};

const ACTION_FILTERS = ["", "added", "removed", "reset", "updated"] as const;
type ActionFilter = typeof ACTION_FILTERS[number];

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function ScholarAccountHistoryTab() {
  const [entries, setEntries] = useState<ScholarAccountLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState<ActionFilter>("");
  const [page, setPage] = useState(1);
  const { sortState, toggleSort } = useSortState();

  async function load(pageToLoad: number) {
    setLoading(true);
    const result = await fetchScholarAccountLog(
      { search: search.trim() || undefined, action: actionFilter || undefined },
      pageToLoad,
      sortState.key ? { column: sortState.key as ScholarLogSortColumn, direction: sortState.direction } : undefined,
    );
    setEntries(result.items);
    setTotal(result.total);
    setLoading(false);
  }

  // Debounced search: 350ms after typing stops, resetting to page 1 since
  // the result set (and therefore what "page 1" even means) changes.
  useEffect(() => {
    const t = setTimeout(() => { setPage(1); void load(1); }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Action filter takes effect immediately (no debounce needed — it's a
  // button click, not free text) and also resets to page 1.
  useEffect(() => {
    setPage(1);
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionFilter]);

  // A header click re-sorts the whole (server-side) result set, so jump
  // back to page 1 the same way search/action filtering does.
  useEffect(() => {
    setPage(1);
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortState.key, sortState.direction]);

  function goToPage(p: number) {
    const clamped = Math.min(Math.max(1, p), totalPages);
    setPage(clamped);
    void load(clamped);
  }

  const totalPages = Math.max(1, Math.ceil(total / ACCOUNT_LOG_PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * ACCOUNT_LOG_PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * ACCOUNT_LOG_PAGE_SIZE, total);

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-2 bg-white border border-[#e6ecf5] rounded-lg px-3 py-2 flex-1 max-w-sm">
          <Search size={15} className="text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or Scholar ID…"
            className="w-full text-sm outline-none" />
        </div>
        <div className="flex items-center gap-1 bg-white border border-[#e6ecf5] rounded-lg p-1 flex-wrap">
          {ACTION_FILTERS.map(v => (
            <button key={v} onClick={() => setActionFilter(v)}
              className={`text-[12.5px] font-semibold px-3 py-1.5 rounded-md ${
                actionFilter === v ? "bg-[#062444] text-white" : "text-slate-500 hover:bg-[#f8fafd]"
              }`}>
              {v === "" ? "All" : ACTION_META[v].label}
            </button>
          ))}
        </div>
      </div>

      <p className="text-[12.5px] text-slate-500 mb-2 px-1">
        {loading ? "Loading…" : total === 0 ? "No account changes recorded yet." : `Showing ${rangeStart}–${rangeEnd} of ${total} change${total === 1 ? "" : "s"}.`}
      </p>

      <div className="bg-white rounded-2xl border border-[#e6ecf5] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#f8fafd] text-left text-[11px] uppercase tracking-wide text-[#0088cc]">
              <SortableTh label="Date" sortKey="createdAt" sortState={sortState} onSort={toggleSort} className="px-4 py-3" />
              <SortableTh label="Change" sortKey="action" sortState={sortState} onSort={toggleSort} className="px-4 py-3" />
              <SortableTh label="Scholar" sortKey="scholarName" sortState={sortState} onSort={toggleSort} className="px-4 py-3" />
              <SortableTh label="Description" sortKey="description" sortState={sortState} onSort={toggleSort} className="px-4 py-3" />
              <SortableTh label="Type" sortKey="source" sortState={sortState} onSort={toggleSort} className="px-4 py-3" />
              <SortableTh label="Staff" sortKey="performedByName" sortState={sortState} onSort={toggleSort} className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
            ) : entries.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No account changes recorded yet.</td></tr>
            ) : (
              entries.map(e => {
                const meta = ACTION_META[e.action];
                const Icon = meta.icon;
                return (
                  <tr key={e.id} className="border-t border-[#f0f3f8] hover:bg-[#f8fafd]">
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{formatDate(e.createdAt)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 text-[12px] font-bold px-2.5 py-1 rounded-full ${meta.className}`}>
                        <Icon size={12} /> {meta.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-[#062444] whitespace-nowrap">{e.scholarName} <span className="text-slate-400 font-normal">({e.scholarIdNumber})</span></td>
                    <td className="px-4 py-3 text-slate-500 max-w-xs">{e.description || "—"}</td>
                    <td className="px-4 py-3 text-slate-500">{SOURCE_LABEL[e.source]}</td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{e.performedByName}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mt-3 px-1">
        <span />
        <div className="flex items-center gap-2">
          <button onClick={() => goToPage(page - 1)} disabled={loading || page <= 1}
            className="flex items-center gap-1 text-[12.5px] font-semibold text-[#062444] disabled:text-slate-300 disabled:cursor-not-allowed">
            <ChevronLeft size={14} /> Prev
          </button>
          <span className="text-[12.5px] text-slate-500 min-w-[90px] text-center">Page {page} of {totalPages}</span>
          <button onClick={() => goToPage(page + 1)} disabled={loading || page >= totalPages}
            className="flex items-center gap-1 text-[12.5px] font-semibold text-[#062444] disabled:text-slate-300 disabled:cursor-not-allowed">
            Next <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
