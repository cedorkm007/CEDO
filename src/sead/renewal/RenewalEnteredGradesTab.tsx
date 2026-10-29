import { useCallback, useEffect, useState } from "react";
import { useLiveReload } from "@/lib/liveUpdates";
import { AlertTriangle, CheckCircle2, CornerUpLeft, Loader2, Search } from "lucide-react";
import {
  decideEnteredGrades, ENTERED_GRADES_PAGE_SIZE, fetchEnteredGrades, fetchEnteredGradesCounts, getEnteredGradeImageUrl,
  type EnteredGradesCounts, type EnteredGradesFilter, type EnteredGradesRow,
} from "../enteredGradesApi";
import { formatDateTime, selfGradeDifferenceText, selfGradesStatusText, termLabelOf } from "@/lib/renewal";
import { ListPagination } from "@/app/components/PaginatedList";
import { ReasonDialog } from "./ReasonDialog";

const TONE: Record<"good" | "bad" | "warn" | "plain", string> = {
  good: "bg-green-100 text-green-950 border-green-300", bad: "bg-red-100 text-red-950 border-red-300", warn: "bg-amber-100 text-amber-950 border-amber-300", plain: "bg-slate-100 text-slate-900 border-slate-300",
};
const FILTERS: { key: EnteredGradesFilter; label: string }[] = [{ key: "pending", label: "Waiting for approval" }, { key: "approved", label: "Approved" }, { key: "returned", label: "Returned" }, { key: "all", label: "All" }];

/** One image the scholar uploaded, as large as its half of the screen so it can be read next to the grades; clicking opens it full size in a new tab. */
function Thumb({ path, name }: { path: string; name: string }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => { let live = true; void getEnteredGradeImageUrl(path).then(u => { if (live) setUrl(u); }); return () => { live = false; }; }, [path]);
  if (url === undefined) return <span className="flex h-40 w-full items-center justify-center rounded-md border border-[#e6ecf5] text-slate-700"><Loader2 size={16} className="animate-spin" aria-hidden="true" /></span>;
  if (!url) return <span className="rounded-md border border-[#e6ecf5] px-2 py-1 text-[13px] text-slate-800">{name} (can't be opened)</span>;
  return <a href={url} target="_blank" rel="noreferrer" aria-label={`Open ${name} full size`} className="block"><img src={url} alt={name} className="w-full rounded-md border border-[#e6ecf5] bg-white object-contain" /></a>;
}

/**
 * Scholar Renewal > Entered grades. A scholar whose school has not uploaded the grades can enter their own (code, subject, units, grade, with screenshots and a tick that wrong or
 * false information means disciplinary action or removal). The Grades Approver (a tag it.admin1 gives) approves or returns them; the evaluator can read. When the school later
 * uploads, its grades replace these and the differences are shown here. The database enforces who may decide.
 */
export function RenewalEnteredGradesTab({ refreshKey, onChanged, only }: { refreshKey: number; onChanged: () => void; only?: { scholarIdNumber: string; onDone: () => void } }) {
  // `only` = opened from the Scholar List for one scholar: just that scholar's entered grades that wait for approval, no filters, closes itself after a decision
  const [filter, setFilter] = useState<EnteredGradesFilter>("pending");
  const [typed, setTyped] = useState(only?.scholarIdNumber ?? "");
  const [query, setQuery] = useState(only?.scholarIdNumber ?? "");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<EnteredGradesRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<EnteredGradesCounts | null>(null);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  const [notice, setNotice] = useState("");
  const [deciding, setDeciding] = useState<{ row: EnteredGradesRow; approve: boolean } | null>(null);

  useEffect(() => { const t = setTimeout(() => { setQuery(typed); setPage(1); }, 350); return () => clearTimeout(t); }, [typed]);
  const load = useCallback(async () => {
    const [l, c] = await Promise.all([fetchEnteredGrades(filter, query, page), fetchEnteredGradesCounts()]);
    if (!l.ok) { if (l.missing) setMissing(true); else setError(l.error); return; }
    setRows(l.rows); setTotal(l.total); setError("");
    if (c.ok) setCounts(c.counts);
  }, [filter, query, page]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  useLiveReload(load);

  if (missing) return <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[14px] text-amber-950">Entered grades need the latest database update (the three supabase_migration_entered_grades files). Until it is run, this tab cannot show them.</p>;
  if (error) return <p role="alert" className="text-[14px] text-red-700">{error}</p>;
  const totalPages = Math.max(1, Math.ceil(total / ENTERED_GRADES_PAGE_SIZE));
  const countOf = (k: EnteredGradesFilter) => counts ? (k === "pending" ? counts.pending : k === "approved" ? counts.approved : k === "returned" ? counts.returned : counts.pending + counts.approved + counts.returned) : null;

  return (
    <div>
      {!only && <p className="text-[14px] text-slate-700 mb-3">
        Grades the scholars enter themselves while their school has not uploaded the grades. Check each one against the screenshot. <strong>Approve</strong> and the scholar counts as having complete grades until the school uploads;
        <strong> return</strong> it with a reason and the scholar enters it again. When a school uploads its grades they replace these, and any differences show here ({counts?.differing ?? 0} now).
        {counts && !counts.canDecide && " You can read them; only a Grades Approver can approve or return them."}
      </p>}
      {notice && <p role="status" className="mb-3 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-[14px] text-green-950">{notice}</p>}
      {!only && <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Show entered grades">
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => { setFilter(f.key); setPage(1); setRows(null); }} aria-pressed={filter === f.key}
            className={`rounded-full border px-3 py-1.5 text-[14px] font-semibold ${filter === f.key ? "border-[#062444] bg-[#062444] text-white" : "border-[#062444]/25 bg-white text-[#062444] hover:bg-[#f7f9fc]"}`}>
            {f.label}{countOf(f.key) != null ? ` (${countOf(f.key)})` : ""}
          </button>
        ))}
      </div>}
      {!only && <div className="relative mb-3 max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" aria-hidden="true" />
        <input value={typed} onChange={e => setTyped(e.target.value)} placeholder="Search by name or Scholar ID" aria-label="Search entered grades"
          className="w-full rounded-lg border border-[#062444]/25 py-2 pl-9 pr-3 text-[14px] outline-none focus:border-[#062444] bg-white" />
      </div>}

      {!rows ? <p className="text-[14px] text-slate-700 flex items-center gap-2"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…</p>
      : rows.length === 0 ? <p className="rounded-xl border border-dashed border-[#e6ecf5] px-4 py-8 text-center text-[14px] text-slate-700">{only ? "Nothing is waiting for approval for this scholar any more." : query ? "Nothing matches your search." : filter === "pending" ? "No entered grades are waiting for approval." : "Nothing here."}</p>
      : (
        <>
          <ul className="space-y-3">
            {rows.map(r => {
              const st = selfGradesStatusText(r.status);
              return (
                <li key={r.id} className="rounded-xl border border-[#e6ecf5] bg-white px-4 py-3.5 text-[14px]">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-[#062444] text-[15px]">{r.name} <span className="font-normal text-slate-600">· {r.scholarIdNumber}</span></p>
                      <p className="text-slate-800">{r.school || "No school"} · {r.program || "No program"} · {r.yearLevel || "No year level"}</p>
                      <p className="text-slate-800">Renewal for {termLabelOf(r.schoolYear, r.term)} · grades of <strong>{termLabelOf(r.basisSchoolYear, r.basisTerm)}</strong> · sent {formatDateTime(r.submittedAt)}{r.version > 1 ? ` (try ${r.version})` : ""}</p>
                    </div>
                    <span className={`rounded-full border px-2.5 py-0.5 text-[13px] font-semibold ${TONE[st.tone]}`}>{st.text}</span>
                  </div>

                  {!r.gradingReady && r.status !== "returned" && (
                    <p className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-amber-950"><AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                      This school's grading system has no passing mark yet, so these grades cannot be judged as passed or failed. Scholars' Grades Monitoring staff can set it up (Grades Monitoring &gt; Grading setup).</p>
                  )}
                  {r.schoolSubmitted && <p className="mt-2 rounded-md border border-[#e6ecf5] bg-[#f7f9fc] px-2.5 py-2 text-slate-900">The school has already uploaded its grades for this semester; those are the grades that count.</p>}

                  <div className="mt-2 grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className="min-w-0">
                  <table className="w-full text-left">
                    <thead className="text-[#062444]"><tr><th scope="col" className="py-1 pr-2 font-bold">Code</th><th scope="col" className="py-1 pr-2 font-bold">Subject</th><th scope="col" className="py-1 pr-2 text-right font-bold">Units</th><th scope="col" className="py-1 text-right font-bold">Grade</th></tr></thead>
                    <tbody>{r.lines.map(l => <tr key={l.code} className="border-t border-[#eef3fb]"><td className="py-1 pr-2">{l.code}</td><td className="py-1 pr-2 break-words">{l.subject}</td><td className="py-1 pr-2 text-right">{l.units}</td><td className="py-1 text-right font-semibold">{l.grade}</td></tr>)}</tbody>
                  </table>
                  {r.officialCheckedAt && (
                    <div className={`mt-2 rounded-md border px-2.5 py-2 ${r.differences && r.differences.length > 0 ? "border-red-300 bg-red-50 text-red-950" : "border-green-300 bg-green-50 text-green-950"}`}>
                      <p className="font-semibold">The school uploaded its grades ({formatDateTime(r.officialCheckedAt)}) and they were compared with these.</p>
                      {r.differences && r.differences.length === 0 && <p>They match.</p>}
                      {r.differences && r.differences.length > 0 && <><p>{r.differences.length} difference{r.differences.length === 1 ? "" : "s"} (the school's grades count; the entered grades may be wrong or false):</p><ul className="mt-1 list-disc pl-5">{r.differences.map((d, i) => <li key={i}>{selfGradeDifferenceText(d).replace("you entered", "the scholar entered").replace("you did not enter it", "the scholar did not enter it")}</li>)}</ul></>}
                    </div>
                  )}
                  {r.status !== "pending" && r.decidedAt && <p className="mt-2 text-slate-800">Decided {formatDateTime(r.decidedAt)}{r.decidedByLabel ? ` by ${r.decidedByLabel}` : ""}.{r.decisionNote ? ` Note: ${r.decisionNote}` : ""}</p>}
                  {r.previousCount > 0 && <p className="mt-1 text-[13.5px] text-slate-700">This scholar has {r.previousCount} other entered-grades record{r.previousCount === 1 ? "" : "s"}.</p>}

                  {r.canDecide && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button onClick={() => { setNotice(""); setDeciding({ row: r, approve: true }); }} className="inline-flex items-center gap-1.5 rounded-lg bg-green-800 px-3 py-1.5 font-bold text-white hover:bg-green-900"><CheckCircle2 size={15} aria-hidden="true" /> Approve</button>
                      <button onClick={() => { setNotice(""); setDeciding({ row: r, approve: false }); }} className="inline-flex items-center gap-1.5 rounded-lg bg-red-700 px-3 py-1.5 font-bold text-white hover:bg-red-800"><CornerUpLeft size={15} aria-hidden="true" /> Return for correction</button>
                    </div>
                  )}
                  </div>
                  <section aria-label={`Screenshots of ${r.name}`} className="min-w-0 lg:sticky lg:top-2 lg:max-h-[85vh] lg:self-start lg:overflow-y-auto">
                    <p className="mb-1 font-semibold text-[#062444]">Screenshots ({r.files.length})</p>
                    <div className="space-y-2">{r.files.map(f => <Thumb key={f.path} path={f.path} name={f.name} />)}</div>
                  </section>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="mt-3"><ListPagination page={page} totalPages={totalPages} onPageChange={setPage} filteredCount={total} pageSize={ENTERED_GRADES_PAGE_SIZE} itemLabel="entered grades" /></div>
        </>
      )}

      {deciding && (
        <ReasonDialog
          title={deciding.approve ? "Approve the entered grades" : "Return the entered grades"}
          intro={deciding.approve
            ? <>I checked that the grades of <strong>{deciding.row.name}</strong> match the screenshot. They will count as the scholar's complete grades for {termLabelOf(deciding.row.basisSchoolYear, deciding.row.basisTerm)} until the school uploads its own.</>
            : <>The scholar is told your reason and enters the grades again. The renewal keeps waiting.</>}
          label={deciding.approve ? "Note to the scholar" : "Reason (the scholar will see this)"} confirmLabel={deciding.approve ? "Approve" : "Return"}
          required={!deciding.approve} danger={!deciding.approve} minLength={3} onCancel={() => setDeciding(null)}
          onConfirm={async reason => {
            const r = await decideEnteredGrades(deciding.row.id, deciding.approve, reason);
            if (!r.ok) return r.error;
            setNotice(r.result === "returned" ? `Returned. ${deciding.row.name} was told.`
              : r.result === "approved_needs_setup" ? `Approved and ${deciding.row.name} was told. But this school has no passing mark yet, so the grades cannot be judged: ask Scholars' Grades Monitoring staff to set up the school's grading system.` : `Approved. ${deciding.row.name} counts as having complete grades and was told.`);
            setDeciding(null); onChanged(); await load(); only?.onDone(); return null;
          }}
        />
      )}
    </div>
  );
}
