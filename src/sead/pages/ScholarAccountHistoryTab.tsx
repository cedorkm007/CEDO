import { useEffect, useState } from "react";
import { Search, PlusCircle, MinusCircle } from "lucide-react";
import { fetchScholarAccountLog } from "../seadApi";
import type { ScholarAccountLogEntry } from "../types";

const SOURCE_LABEL: Record<ScholarAccountLogEntry["source"], string> = {
  single: "Single",
  bulk: "Bulk upload",
  undo: "Bulk undo",
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function ScholarAccountHistoryTab() {
  const [entries, setEntries] = useState<ScholarAccountLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState<"" | "added" | "removed">("");

  async function load() {
    setLoading(true);
    const result = await fetchScholarAccountLog({
      search: search.trim() || undefined,
      action: actionFilter || undefined,
    });
    setEntries(result);
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [actionFilter]);
  useEffect(() => {
    const t = setTimeout(load, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-2 bg-white border border-[#e6ecf5] rounded-lg px-3 py-2 flex-1 max-w-sm">
          <Search size={15} className="text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or Scholar ID…"
            className="w-full text-sm outline-none" />
        </div>
        <div className="flex items-center gap-1 bg-white border border-[#e6ecf5] rounded-lg p-1">
          {(["", "added", "removed"] as const).map(v => (
            <button key={v} onClick={() => setActionFilter(v)}
              className={`text-[12.5px] font-semibold px-3 py-1.5 rounded-md ${
                actionFilter === v ? "bg-[#062444] text-white" : "text-slate-500 hover:bg-[#f8fafd]"
              }`}>
              {v === "" ? "All" : v === "added" ? "Added" : "Removed"}
            </button>
          ))}
        </div>
      </div>

      <p className="text-[12.5px] text-slate-500 mb-2 px-1">
        {loading ? "Loading…" : entries.length === 0 ? "No account changes recorded yet." : `Showing the ${entries.length} most recent change${entries.length === 1 ? "" : "s"}.`}
      </p>

      <div className="bg-white rounded-2xl border border-[#e6ecf5] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#f8fafd] text-left text-[11px] uppercase tracking-wide text-[#0088cc]">
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Change</th>
              <th className="px-4 py-3">Scholar</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Staff</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
            ) : entries.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">No account changes recorded yet.</td></tr>
            ) : (
              entries.map(e => (
                <tr key={e.id} className="border-t border-[#f0f3f8] hover:bg-[#f8fafd]">
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{formatDate(e.createdAt)}</td>
                  <td className="px-4 py-3">
                    {e.action === "added" ? (
                      <span className="inline-flex items-center gap-1.5 text-[12px] font-bold text-green-700 bg-green-100 px-2.5 py-1 rounded-full">
                        <PlusCircle size={12} /> Added
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-[12px] font-bold text-red-600 bg-red-100 px-2.5 py-1 rounded-full">
                        <MinusCircle size={12} /> Removed
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium text-[#062444]">{e.scholarName} <span className="text-slate-400 font-normal">({e.scholarIdNumber})</span></td>
                  <td className="px-4 py-3 text-slate-500">{SOURCE_LABEL[e.source]}</td>
                  <td className="px-4 py-3 text-slate-500">{e.performedByName}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
