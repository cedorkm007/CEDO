import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { fetchNotApplied, markNotRequired, type NotAppliedRow } from "../renewalApi";
import { ReasonDialog } from "./ReasonDialog";

/** Scholars who have not applied for the term (not Removed, not On leave). The evaluator can mark one "Not required this term" with a reason. */
export function RenewalNotAppliedTab({ schoolYear, term, onChanged, refreshKey }: { schoolYear: string; term: string; onChanged: () => void; refreshKey: number }) {
  const [rows, setRows] = useState<NotAppliedRow[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [marking, setMarking] = useState<NotAppliedRow | null>(null);

  const load = useCallback(async () => {
    const r = await fetchNotApplied(schoolYear, term);
    if (r.ok) { setRows(r.rows); setError(""); } else setError(r.error);
  }, [schoolYear, term]);
  useEffect(() => { setRows(null); void load(); }, [load, refreshKey]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? []).filter(r => !q || r.name.toLowerCase().includes(q) || r.scholarIdNumber.toLowerCase().includes(q) || r.school.toLowerCase().includes(q));
  }, [rows, query]);

  if (error) return <p role="alert" className="text-[14px] text-red-700">{error}</p>;
  if (!rows) return <p className="text-[14px] text-slate-700 flex items-center gap-2"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…</p>;

  return (
    <div>
      <p className="text-[14px] text-slate-700 mb-3">Scholars who have not applied for this term. Removed and On leave scholars are left out.</p>
      <div className="relative mb-3 max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" aria-hidden="true" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name, ID or school" aria-label="Search scholars who have not applied"
          className="w-full rounded-lg border border-[#062444]/25 py-2 pl-9 pr-3 text-[14px] outline-none focus:border-[#062444] bg-white" />
      </div>
      {shown.length === 0 ? <p className="rounded-xl border border-dashed border-[#e6ecf5] px-4 py-8 text-center text-[14px] text-slate-700">Everyone has applied, or been marked as not required.</p> : (
        <div className="overflow-x-auto rounded-xl border border-[#e6ecf5] bg-white" tabIndex={0} role="region" aria-label="Scholars who have not applied">
          <table className="w-full min-w-[720px] text-left text-[14px]">
            <thead className="bg-[#f7f9fc] text-[#062444]"><tr>{["Scholar", "School", "Program · Year", "Status", "Action"].map(h => <th key={h} scope="col" className="px-3 py-2.5 font-bold">{h}</th>)}</tr></thead>
            <tbody>
              {shown.map(r => (
                <tr key={r.scholarIdNumber} className="border-t border-[#eef3fb]">
                  <td className="px-3 py-2.5"><div className="font-bold text-[#062444]">{r.name}</div><div className="text-[13px] text-slate-600">{r.scholarIdNumber}</div></td>
                  <td className="px-3 py-2.5 text-slate-800">{r.school}</td>
                  <td className="px-3 py-2.5 text-slate-800">{r.program} · {r.yearLevel}</td>
                  <td className="px-3 py-2.5 text-slate-800">{r.status}</td>
                  <td className="px-3 py-2.5"><button onClick={() => setMarking(r)} className="font-semibold text-[#00709f] hover:underline">Mark not required</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[13.5px] text-slate-600">Showing {shown.length} of {rows.length}.</p>

      {marking && (
        <ReasonDialog
          title="Mark as not required this term" intro={<>{marking.name} will leave the “Not applied” list for this term.</>}
          label="Reason (for example: graduating)" confirmLabel="Mark not required" onCancel={() => setMarking(null)}
          onConfirm={async reason => {
            const r = await markNotRequired(marking.scholarIdNumber, schoolYear, term, reason);
            if (!r.ok) return r.error;
            setMarking(null); onChanged(); await load(); return null;
          }}
        />
      )}
    </div>
  );
}
