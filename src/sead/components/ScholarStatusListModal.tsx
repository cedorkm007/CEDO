import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { ModalShell } from "./SeadUiShell";
import { ServerPagination } from "@/app/components/ServerPagination";
import { DASHBOARD_PAGE_SIZE, fetchStatusScholarsPage, type StatusListKind, type StatusScholar } from "../referralApi";

const WORDS: Record<StatusListKind, string> = { "On leave": "on leave", Reconsidered: "reconsidered", Removed: "removed" };

/**
 * The list behind a number on the Main Dashboard (On Leave, Reconsidered, Removed): the scholars who have that scholarship status now, read PAGE BY PAGE (20 a page, with the true total) and searched by name or
 * Scholar ID. The total is the number that was pressed.
 */
export function ScholarStatusListModal({ status, expected, onClose }: { status: StatusListKind; expected: number | null; onClose: () => void }) {
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<StatusScholar[] | null>(null);
  const [total, setTotal] = useState(expected ?? 0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const request = useRef(0);

  // the search waits until the person stops typing (300 ms), then starts again from page 1
  useEffect(() => {
    if (typed === search) return;
    const t = window.setTimeout(() => { setSearch(typed); setPage(1); }, 300);
    return () => window.clearTimeout(t);
  }, [typed, search]);

  useEffect(() => {
    const mine = ++request.current;
    setLoading(true);
    void fetchStatusScholarsPage(status, search, page).then(r => {
      if (mine !== request.current) return;      // a newer page was asked meanwhile
      setLoading(false);
      if (!r.ok) { setError(r.missing ? "This list needs the latest database update (supabase_migration_consultation_dashboard_all_visits.sql). Ask the IT admin to run it." : r.error); setRows([]); return; }
      setError(""); setRows(r.rows); setTotal(r.total);
    });
  }, [status, search, page]);

  return (
    <ModalShell title={`Scholars ${WORDS[status]}`} onClose={onClose} wide>
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" aria-hidden="true" />
        <input value={typed} onChange={e => setTyped(e.target.value)} placeholder="Search by name or Scholar ID…" aria-label="Search the list"
          className="w-full rounded-lg border border-[#e6ecf5] bg-white py-2 pl-9 pr-3 text-[14px] outline-none focus:border-[#062444]" />
      </div>
      {error && <p role="alert" className="text-[14px] text-red-700">{error}</p>}
      {rows === null || (loading && rows.length === 0) ? (
        <ul className="space-y-1.5" aria-busy="true" aria-label="Loading the list">
          {Array.from({ length: 5 }, (_, i) => <li key={i} className="rounded-lg border border-[#e6ecf5] bg-white px-3 py-3"><div className="h-4 w-56 animate-pulse rounded bg-slate-200" /><div className="mt-2 h-3.5 w-72 animate-pulse rounded bg-slate-200" /></li>)}
        </ul>
      ) : rows.length === 0 ? <p className="text-[14px] text-slate-700">{error ? "" : search ? "No scholar matches this search." : `No scholars are ${WORDS[status]}.`}</p> : (
        <ul className={`space-y-1.5 ${loading ? "opacity-60" : ""}`} aria-label={`Scholars ${WORDS[status]}`}>
          {rows.map(r => (
            <li key={r.scholarIdNumber} className="rounded-lg border border-[#e6ecf5] bg-white px-3 py-2 text-[14px]">
              <p className="font-bold text-[#062444]">{r.name}<span className="font-normal text-slate-600"> · {r.scholarIdNumber}</span></p>
              <p className="text-[13.5px] text-slate-700">{[r.course, r.yearLevel, r.school].filter(Boolean).join(" · ") || "—"}</p>
            </li>
          ))}
        </ul>
      )}
      <ServerPagination page={page} pageSize={DASHBOARD_PAGE_SIZE} total={total} onPageChange={p => setPage(Math.max(1, p))} noun="scholars" disabled={loading} />
    </ModalShell>
  );
}
