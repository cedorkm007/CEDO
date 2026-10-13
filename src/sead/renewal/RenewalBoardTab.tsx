import { useCallback, useEffect, useMemo, useState } from "react";
import { Flag, Loader2, Search, StickyNote } from "lucide-react";
import { RenewalStageBadge } from "@/app/components/RenewalStageBadge";
import { BOARD_GROUPS, formatDay } from "@/lib/renewal";
import { fetchRenewalBoard, type BoardRow } from "../renewalApi";

/** Applications for one term, grouped by stage, with search. Click a row to open the scholar's renewal. */
export function RenewalBoardTab({ schoolYear, term, onOpen, refreshKey }: { schoolYear: string; term: string; onOpen: (recordId: string) => void; refreshKey: number }) {
  const [rows, setRows] = useState<BoardRow[] | null>(null);
  const [error, setError] = useState("");
  const [group, setGroup] = useState<string>("all");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    const r = await fetchRenewalBoard(schoolYear, term);
    if (r.ok) { setRows(r.rows); setError(""); } else setError(r.error);
  }, [schoolYear, term]);
  useEffect(() => { setRows(null); void load(); }, [load, refreshKey]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows?.length ?? 0 };
    for (const g of BOARD_GROUPS) c[g.key] = (rows ?? []).filter(r => (g.stages as readonly string[]).includes(r.stage)).length;
    return c;
  }, [rows]);

  const shown = useMemo(() => {
    const g = BOARD_GROUPS.find(x => x.key === group);
    const q = query.trim().toLowerCase();
    return (rows ?? []).filter(r => (!g || (g.stages as readonly string[]).includes(r.stage)) && (!q || r.name.toLowerCase().includes(q) || r.scholarIdNumber.toLowerCase().includes(q) || r.school.toLowerCase().includes(q)));
  }, [rows, group, query]);

  if (error) return <p role="alert" className="text-[14px] text-red-700">{error}</p>;
  if (!rows) return <p className="text-[14px] text-slate-700 flex items-center gap-2"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading applications…</p>;

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3" role="group" aria-label="Filter by stage">
        {[{ key: "all", label: "All" }, ...BOARD_GROUPS.map(g => ({ key: g.key, label: g.label }))].map(g => (
          <button key={g.key} onClick={() => setGroup(g.key)} aria-pressed={group === g.key}
            className={`rounded-full border px-3 py-1.5 text-[14px] font-semibold ${group === g.key ? "border-[#062444] bg-[#062444] text-white" : "border-[#062444]/25 bg-white text-[#062444] hover:bg-[#f7f9fc]"}`}>
            {g.label} <span className={`ml-1 font-bold ${group === g.key ? "text-[#F3BC00]" : "text-[#006aa3]"}`}>{counts[g.key] ?? 0}</span>
          </button>
        ))}
      </div>
      <div className="relative mb-3 max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" aria-hidden="true" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name, ID or school" aria-label="Search applications"
          className="w-full rounded-lg border border-[#062444]/25 py-2 pl-9 pr-3 text-[14px] outline-none focus:border-[#062444] bg-white" />
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[#e6ecf5] px-4 py-8 text-center text-[14px] text-slate-700">
          {rows.length === 0 ? "Nobody has applied for this term yet." : "No applications match this filter."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#e6ecf5] bg-white" tabIndex={0} role="region" aria-label="Renewal applications">
          <table className="w-full min-w-[860px] text-left text-[14px]">
            <thead className="bg-[#f7f9fc] text-[#062444]">
              <tr>{["Scholar", "School", "Program · Year", "Stage", "Case", "Applied"].map(h => <th key={h} scope="col" className="px-3 py-2.5 font-bold">{h}</th>)}</tr>
            </thead>
            <tbody>
              {shown.map(r => (
                <tr key={r.recordId} className="border-t border-[#eef3fb] hover:bg-[#f7f9fc]">
                  <td className="px-3 py-2.5">
                    <button onClick={() => onOpen(r.recordId)} className="text-left font-bold text-[#00709f] hover:underline">{r.name}</button>
                    <div className="text-[13px] text-slate-600">{r.scholarIdNumber}</div>
                  </td>
                  <td className="px-3 py-2.5 text-slate-800">{r.school}</td>
                  <td className="px-3 py-2.5 text-slate-800">{r.program} · {r.yearLevel}</td>
                  <td className="px-3 py-2.5"><RenewalStageBadge stage={r.stage} /></td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
                      {r.sdpComplied === false && <span className="rounded-full border border-amber-400 bg-amber-50 px-2 py-0.5 font-bold text-amber-900">SDP not complied</span>}
                      {r.failedCount > 0 && <span className="rounded-full border border-red-300 bg-red-50 px-2 py-0.5 font-bold text-red-800">{r.failedCount} failed</span>}
                      {r.incCount > 0 && <span className="rounded-full border border-amber-400 bg-amber-50 px-2 py-0.5 font-bold text-amber-900">{r.incCount} INC</span>}
                      {r.isLate && <span className="inline-flex items-center gap-1 rounded-full border border-slate-400 bg-slate-100 px-2 py-0.5 font-bold text-slate-800"><Flag size={12} aria-hidden="true" /> Late</span>}
                      {r.scholarNote && <span className="inline-flex items-center gap-1 rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 font-bold text-sky-900"><StickyNote size={12} aria-hidden="true" /> Has a note</span>}
                      {r.noShow && <span className="rounded-full border border-red-300 bg-red-50 px-2 py-0.5 font-bold text-red-800">No-show</span>}
                      {r.sdpComplied !== false && r.failedCount === 0 && r.incCount === 0 && !r.isLate && !r.scholarNote && <span className="text-slate-700">—</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-slate-800">{formatDay(r.appliedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[13.5px] text-slate-600">Showing {shown.length} of {rows.length}.</p>
    </div>
  );
}
