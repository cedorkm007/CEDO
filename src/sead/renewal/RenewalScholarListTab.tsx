import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveReload } from "@/lib/liveUpdates";
import { ChevronDown, Loader2, Lock, RefreshCw, Search } from "lucide-react";
import {
  EMPTY_SCHOLAR_LIST_FILTERS, fetchScholarActions, fetchScholarList, fetchScholarListMatrix, fetchScholarListOptions, fetchScholarSdpCredits, refreshScholarListStep, SCHOLAR_LIST_PAGE_SIZE,
  type ScholarListFilters, type ScholarListMatrixRow, type ScholarListOptions, type ScholarListRow, type ScholarSdpCredits,
} from "../renewalScholarListApi";
import { ELIGIBILITY_OPTIONS, formatDateTime, formatDay, gradeIndicators, gradesProgressText, SDP_CATEGORY_LABELS, sdpReconsiderationStatusText, sdpStatusText, termLabelOf, type ScholarEligibility, type SdpReconsiderationStatus } from "@/lib/renewal";
import { ListPagination } from "@/app/components/PaginatedList";
import { ModalShell } from "../components/SeadUiShell";
import { ReferralFormModal } from "../components/ReferralFormModal";
import { ReferralFormPanel } from "../components/ReferralFormPanel";
import { fetchScholarInformationByIdNumber, type ScholarInformationRow } from "../seadApi";
import { canDoAction, neededActions, NO_ROLES, renewalSummary, waitingForText, type NeededAction, type ScholarActionFacts, type SummaryTone, type ViewerRoles } from "@/lib/renewalActions";
import { RenewalEnteredGradesTab } from "./RenewalEnteredGradesTab";
import { RenewalSdpReconsiderationTab } from "./RenewalSdpReconsiderationTab";

const TONE_CHIP: Record<"good" | "bad" | "warn" | "plain", string> = {
  good: "bg-green-100 text-green-950 border-green-300", bad: "bg-red-100 text-red-950 border-red-300", warn: "bg-amber-100 text-amber-950 border-amber-300", plain: "bg-slate-100 text-slate-900 border-slate-300",
};
const toneOf = (key: string) => ELIGIBILITY_OPTIONS.find(o => o.key === key)?.tone ?? "plain";

/** A drop-down of tick boxes: nothing ticked = no filter on that. */
function MultiSelect({ label, options, selected, onChange }: { label: string; options: { value: string; label: string }[]; selected: string[]; onChange: (next: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);
  return (
    <div className="relative" ref={box}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="true"
        className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[14px] bg-white text-left ${selected.length ? "border-[#062444] font-semibold text-[#062444]" : "border-[#062444]/25 text-slate-800"}`}>
        <span className="truncate">{label}{selected.length ? ` (${selected.length})` : ""}</span><ChevronDown size={15} aria-hidden="true" className="shrink-0" />
      </button>
      {open && (
        <div role="group" aria-label={label} className="absolute z-30 mt-1 max-h-72 w-72 max-w-[85vw] overflow-y-auto rounded-xl border border-[#e6ecf5] bg-white p-2 shadow-lg">
          {options.length === 0 ? <p className="px-2 py-1.5 text-[14px] text-slate-700">Nothing to choose.</p> : options.map(o => (
            <label key={o.value} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-[14px] text-slate-900 hover:bg-[#f7f9fc]">
              <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} className="mt-1 h-4 w-4 shrink-0" /><span className="break-words">{o.label}</span>
            </label>
          ))}
          {selected.length > 0 && <button type="button" onClick={() => onChange([])} className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-[14px] font-semibold text-[#00709f] hover:bg-[#f7f9fc]">Clear {label.toLowerCase()}</button>}
        </div>
      )}
    </div>
  );
}

function SdpCell({ r, onView }: { r: ScholarListRow; onView: (r: ScholarListRow) => void }) {
  const s = sdpStatusText({ applicable: r.sdpApplicable, complied: r.sdpComplied, missing: r.sdpMissing });
  return (
    <div>
      <span className={s.tone === "good" ? "font-semibold text-green-900" : s.tone === "bad" ? "font-semibold text-red-800" : "text-slate-800"}>{s.text}</span>
      {r.sdpApplicable && r.sdpReconsideration === "approved" && r.sdpComplied === true && <span className="block text-[13px] text-slate-800">by SDP reconsideration</span>}
      {r.sdpApplicable && r.sdpReconsideration === "pending" && <span className="block text-[13px] font-semibold text-amber-900">Reconsideration requested</span>}
      {r.sdpApplicable && r.sdpReconsideration === "denied" && <span className="block text-[13px] font-semibold text-red-800">Reconsideration not approved</span>}
      {r.sdpApplicable && (r.sdpComplied === false || r.sdpReconsideration === "approved") && <button onClick={() => onView(r)} className="mt-0.5 block font-semibold text-[#00709f] hover:underline text-left">View SDP credits</button>}
    </div>
  );
}

function GradesCell({ r }: { r: ScholarListRow }) {
  const chips = gradeIndicators(r);
  const notIn = r.gradesState === "waiting" || r.gradesState === "no_grades";
  return (
    <div>
      <span className="text-slate-900">{gradesProgressText(r)}</span>
      {notIn && r.total > 0 && r.graded === 0 && <span className="block text-[13px] text-slate-700">Not graded yet</span>}
      {chips.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{chips.map(c => <span key={c.text} className={`rounded-full border px-2 py-0.5 text-[13px] font-semibold ${TONE_CHIP[c.tone]}`}>{c.text}</span>)}</div>}
    </div>
  );
}

const SUMMARY_TONE: Record<SummaryTone, string> = { good: "text-green-900", bad: "text-red-800", warn: "text-amber-900", plain: "text-slate-900" };

/** The Renewal status column: how far the renewal is, then the SDP, the grades and the consultation in a few words. */
function SummaryCell({ r, facts, ready }: { r: ScholarListRow; facts: ScholarActionFacts | null; ready: boolean }) {
  if (!ready) return <span className="text-slate-700">—</span>;
  const s = renewalSummary(r, facts);
  return (
    <div>
      <span className={`font-bold ${SUMMARY_TONE[s.tone]}`}>{s.headline}</span>
      {s.details.length > 0 && <ul className="mt-0.5 space-y-0.5 text-[13px] text-slate-800">{s.details.map(d => <li key={d}>{d}</li>)}</ul>}
    </div>
  );
}

/** The Action needed column: what waits on staff. Only the staff assigned to an action can click it; everybody else sees who it is waiting for. */
function ActionCell({ r, facts, ready, viewer, busy, onAct }: { r: ScholarListRow; facts: ScholarActionFacts | null; ready: boolean; viewer: ViewerRoles; busy: string | null; onAct: (a: NeededAction, r: ScholarListRow, f: ScholarActionFacts) => void }) {
  if (!ready || !facts) return <span className="text-slate-700">—</span>;
  const list = neededActions(r, facts);
  if (list.length === 0) return <span className="text-slate-700">No action needed</span>;
  return (
    <ul className="space-y-1.5">
      {list.map(a => canDoAction(a, viewer)
        ? <li key={a.label}><button type="button" onClick={() => onAct(a, r, facts)} disabled={busy === r.scholarIdNumber} className="rounded-lg bg-[#062444] px-2.5 py-1 text-left text-[13px] font-bold text-white hover:bg-[#0a3a6e] disabled:opacity-60">{busy === r.scholarIdNumber && a.key === "refer_consultation" ? "Opening…" : a.label}<span className="sr-only"> for {r.name}</span></button></li>
        : <li key={a.label} className="text-[13px] text-slate-800"><span className="inline-flex items-start gap-1"><Lock size={12} className="mt-1 shrink-0 text-slate-600" aria-hidden="true" /><span><span className="font-semibold">{a.label}</span><span className="block text-slate-700">{waitingForText(a)}</span></span></span></li>)}
    </ul>
  );
}

function EligibilityCell({ r }: { r: ScholarListRow }) {
  return <div className="flex flex-wrap gap-1">{r.eligibility.map(k => <span key={k} className={`rounded-full border px-2 py-0.5 text-[13px] font-semibold ${TONE_CHIP[toneOf(k)]}`}>{ELIGIBILITY_OPTIONS.find(o => o.key === k)?.label ?? k}</span>)}</div>;
}

/**
 * Scholar Renewal > Scholar List: every scholar who can renew in the term, with the SDP status, the grades and the renewal eligibility, filtered by school, year level, program and eligibility
 * (the filters apply together), with a count table of school against eligibility whose numbers can be clicked. The numbers are the renewal check's own, saved by the database; "Refresh" checks
 * everybody again in small steps. A table on a wide screen, one card per scholar on a narrow one.
 */
export function RenewalScholarListTab({ schoolYear, term, refreshKey, viewer = NO_ROLES, onOpenRecord, onChanged }: { schoolYear: string; term: string; refreshKey: number; viewer?: ViewerRoles; onOpenRecord?: (recordId: string) => void; onChanged?: () => void }) {
  const [filters, setFilters] = useState<ScholarListFilters>(EMPTY_SCHOLAR_LIST_FILTERS);
  const [typed, setTyped] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ScholarListRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [matrix, setMatrix] = useState<ScholarListMatrixRow[] | null>(null);
  const [options, setOptions] = useState<ScholarListOptions | null>(null);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  const [showMatrix, setShowMatrix] = useState(true);
  const [refreshing, setRefreshing] = useState<{ done: number; total: number } | null>(null);
  const [refreshError, setRefreshError] = useState("");
  const [viewing, setViewing] = useState<ScholarListRow | null>(null);
  const [facts, setFacts] = useState<Record<string, ScholarActionFacts> | null>(null);       // null = not loaded yet
  const [actionsMissing, setActionsMissing] = useState(false);
  const [acting, setActing] = useState<{ key: "approve_grades" | "decide_sdp" | "decide_case"; row: ScholarListRow; facts: ScholarActionFacts } | null>(null);
  const [referring, setReferring] = useState<ScholarInformationRow | null>(null);
  const [referBusy, setReferBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const autoTried = useRef("");

  // the search waits for a pause in typing, then starts again from page 1
  useEffect(() => { const t = setTimeout(() => { setFilters(f => (f.query === typed ? f : { ...f, query: typed })); setPage(1); }, 350); return () => clearTimeout(t); }, [typed]);
  const change = (patch: Partial<ScholarListFilters>) => { setFilters(f => ({ ...f, ...patch })); setPage(1); };
  const anyFilter = filters.query !== "" || filters.schoolIds.length > 0 || filters.yearLevels.length > 0 || filters.programs.length > 0 || filters.eligibility.length > 0;
  const clear = () => { setTyped(""); setFilters(EMPTY_SCHOLAR_LIST_FILTERS); setPage(1); };

  const loadOptions = useCallback(async () => {
    const r = await fetchScholarListOptions(schoolYear, term);
    if (r.ok) { setOptions(r.options); setMissing(false); } else if (r.missing) setMissing(true); else setError(r.error);
  }, [schoolYear, term]);
  const loadList = useCallback(async () => {
    const [l, m] = await Promise.all([fetchScholarList(schoolYear, term, filters, page), fetchScholarListMatrix(schoolYear, term, filters)]);
    if (!l.ok) { if (l.missing) setMissing(true); else setError(l.error); return; }
    setRows(l.rows); setTotal(l.total); setError("");
    if (m.ok) setMatrix(m.rows);
    const a = await fetchScholarActions(schoolYear, term, l.rows.map(x => x.scholarIdNumber));
    if (a.ok) { setFacts(a.facts); setActionsMissing(false); } else if (a.missing) { setActionsMissing(true); setFacts({}); } else setFacts({});
  }, [schoolYear, term, filters, page]);

  useEffect(() => { setOptions(null); setFilters(EMPTY_SCHOLAR_LIST_FILTERS); setTyped(""); setPage(1); void loadOptions(); }, [loadOptions, refreshKey]);
  useEffect(() => { if (!missing) void loadList(); }, [loadList, missing, refreshKey]);
  useLiveReload(async () => { if (!missing) { void loadOptions(); await loadList(); } });      // a decision, a booking or new grades: update in place

  /** Checks everybody again, 100 scholars at a time (the first step has no start time: the database's own clock marks it, and every step after hands it back). */
  const refresh = useCallback(async () => {
    setRefreshError(""); setRefreshing({ done: 0, total: 0 });
    let since: string | null = null, guard = 0;
    for (;;) {
      const s = await refreshScholarListStep(schoolYear, term, since, 100);
      if (!s.ok) { setRefreshError(s.error); break; }
      since = s.since;
      setRefreshing({ done: s.total - s.remaining, total: s.total });
      if (s.remaining <= 0) break;
      if (s.done === 0 || ++guard > 400) { setRefreshError("The check stopped before it finished. Please press Refresh again."); break; }
    }
    setRefreshing(null);
    await loadOptions(); await loadList();
  }, [schoolYear, term, loadOptions, loadList]);

  // the first time the tab is opened for a term nothing has been checked yet: start the check by itself
  useEffect(() => {
    const key = `${schoolYear}|${term}`;
    if (viewer.evaluator && options && options.scholars > 0 && options.checked === 0 && autoTried.current !== key && !refreshing) { autoTried.current = key; void refresh(); }
  }, [options, schoolYear, term, refresh, refreshing, viewer.evaluator]);

  /** A button of the Action needed column: opens the screen where the person with that role decides (the database checks the role again). */
  async function act(a: NeededAction, r: ScholarListRow, f: ScholarActionFacts) {
    setActionError("");
    if (a.key === "open_application") { if (f.recordId && onOpenRecord) onOpenRecord(f.recordId); return; }
    if (a.key === "refer_consultation") {
      setReferBusy(r.scholarIdNumber);
      const scholar = await fetchScholarInformationByIdNumber(r.scholarIdNumber);
      setReferBusy(null);
      if (!scholar) { setActionError("Couldn't open this scholar's record to make the referral."); return; }
      setReferring(scholar); return;
    }
    setActing({ key: a.key, row: r, facts: f });
  }
  const afterAct = () => { setActing(null); setReferring(null); onChanged?.(); void loadList(); };

  if (missing) return <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[14px] text-amber-950">The Scholar List needs the latest database update (supabase_migration_renewal_scholar_list.sql). Until it is run, this tab cannot show the list.</p>;
  if (error) return <p role="alert" className="text-[14px] text-red-700">{error}</p>;

  const totalPages = Math.max(1, Math.ceil(total / SCHOLAR_LIST_PAGE_SIZE));
  const notChecked = options ? Math.max(0, options.scholars - options.checked) : 0;
  const crossed = (schoolId: string | null, key: ScholarEligibility | null) =>
    (schoolId === null ? filters.schoolIds.length === 0 : filters.schoolIds.length === 1 && filters.schoolIds[0] === schoolId) && (key === null ? filters.eligibility.length === 0 : filters.eligibility.length === 1 && filters.eligibility[0] === key);
  const pick = (schoolId: string | null, key: ScholarEligibility | null) => change({ schoolIds: schoolId ? [schoolId] : filters.schoolIds, eligibility: key ? [key] : filters.eligibility });
  const matrixKeys: { key: ScholarEligibility; field: "ready" | "consultation" | "sdpReconsideration" | "waiting" | "review" }[] = [
    { key: "ready", field: "ready" }, { key: "consultation", field: "consultation" }, { key: "sdp_reconsideration", field: "sdpReconsideration" }, { key: "waiting", field: "waiting" }, { key: "review", field: "review" },
  ];
  const sums = (matrix ?? []).reduce((a, m) => ({ ready: a.ready + m.ready, consultation: a.consultation + m.consultation, sdpReconsideration: a.sdpReconsideration + m.sdpReconsideration, waiting: a.waiting + m.waiting, review: a.review + m.review, total: a.total + m.total }),
    { ready: 0, consultation: 0, sdpReconsideration: 0, waiting: 0, review: 0, total: 0 });

  return (
    <div>
      <p className="text-[14px] text-slate-700 mb-3">Every scholar who can renew in {termLabelOf(schoolYear, term)}, with the SDP status, the grades of the term and where the scholar stands for renewal. A scholar who fails a subject or has an INC or DRP is “For consultation”; a scholar who lacks SDP credits is “For SDP reconsideration” (both can apply). The “Action needed” column shows what waits on staff; only the staff assigned to an action can press it, the others see who it is waiting for.</p>

      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[14px] text-slate-800">
        <span>{options?.lastChecked ? <>Checked {formatDateTime(options.lastChecked)}</> : "Not checked yet"}{notChecked > 0 && !refreshing ? <> · <strong>{notChecked}</strong> scholar{notChecked === 1 ? "" : "s"} not checked yet</> : null}</span>
        {viewer.evaluator && <button onClick={() => void refresh()} disabled={!!refreshing || !options} className="inline-flex items-center gap-1.5 rounded-lg border border-[#062444]/25 bg-white px-3 py-1.5 font-semibold text-[#062444] hover:bg-[#f7f9fc] disabled:opacity-60">
          <RefreshCw size={14} aria-hidden="true" className={refreshing ? "animate-spin" : ""} /> {refreshing ? "Checking…" : "Refresh"}
        </button>}
        {refreshing && <span role="status" className="text-slate-800">{refreshing.total > 0 ? `Checked ${refreshing.done} of ${refreshing.total} scholars…` : "Starting…"}</span>}
      </div>
      {refreshing && refreshing.total > 0 && <div className="mb-3 h-2 w-full max-w-md overflow-hidden rounded-full bg-[#e6ecf5]" aria-hidden="true"><div className="h-full bg-[#00709f] transition-all" style={{ width: `${Math.round((refreshing.done / refreshing.total) * 100)}%` }} /></div>}
      {refreshError && <p role="alert" className="mb-3 text-[14px] text-red-700">{refreshError}</p>}
      {actionError && <p role="alert" className="mb-3 text-[14px] text-red-700">{actionError}</p>}
      {actionsMissing && <p role="status" className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[14px] text-amber-950">The Action needed and Renewal status columns need the latest database update (supabase_migration_renewal_actions_needed.sql). Until it is run they stay empty.</p>}

      {/* filters: tick several in each; the four kinds apply together */}
      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" aria-hidden="true" />
          <input value={typed} onChange={e => setTyped(e.target.value)} placeholder="Search name or ID" aria-label="Search scholars"
            className="w-full rounded-lg border border-[#062444]/25 py-2 pl-9 pr-3 text-[14px] outline-none focus:border-[#062444] bg-white" />
        </div>
        <MultiSelect label="School" options={(options?.schools ?? []).filter(s => s.id).map(s => ({ value: s.id as string, label: s.name }))} selected={filters.schoolIds} onChange={schoolIds => change({ schoolIds })} />
        <MultiSelect label="Year level" options={(options?.yearLevels ?? []).map(y => ({ value: y, label: y }))} selected={filters.yearLevels} onChange={yearLevels => change({ yearLevels })} />
        <MultiSelect label="Program" options={(options?.programs ?? []).map(p => ({ value: p, label: p }))} selected={filters.programs} onChange={programs => change({ programs })} />
        <MultiSelect label="Renewal eligibility" options={ELIGIBILITY_OPTIONS.map(o => ({ value: o.key, label: o.label }))} selected={filters.eligibility} onChange={eligibility => change({ eligibility: eligibility as ScholarEligibility[] })} />
      </div>
      {anyFilter && <p className="mb-3 text-[14px] text-slate-800"><button onClick={clear} className="font-semibold text-[#00709f] hover:underline">Clear all filters</button></p>}

      {/* the count table: school against eligibility; click a number to see exactly those scholars */}
      <div className="mb-4 rounded-xl border border-[#e6ecf5] bg-white">
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <h2 className="text-[14px] font-bold text-[#062444]">Schools and renewal eligibility</h2>
          <button onClick={() => setShowMatrix(s => !s)} aria-expanded={showMatrix} className="text-[14px] font-semibold text-[#00709f] hover:underline">{showMatrix ? "Hide" : "Show"}</button>
        </div>
        {showMatrix && (!matrix ? <p className="px-3 pb-3 text-[14px] text-slate-700 flex items-center gap-2"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…</p>
          : matrix.length === 0 ? <p className="px-3 pb-3 text-[14px] text-slate-700">No scholars to count{anyFilter ? " with these filters" : ""}.</p>
          : (
            <div className="max-h-80 overflow-auto border-t border-[#eef3fb]">
              <table className="w-full text-left text-[14px]">
                <caption className="sr-only">Number of scholars of each school under each renewal eligibility. A number can be selected to list those scholars.</caption>
                <thead className="sticky top-0 bg-[#f7f9fc] text-[#062444]">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-bold">School</th>
                    {ELIGIBILITY_OPTIONS.map(o => <th key={o.key} scope="col" className="px-2 py-2 text-right font-bold">{o.label}</th>)}
                    <th scope="col" className="px-3 py-2 text-right font-bold">All</th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.map(m => (
                    <tr key={m.schoolId ?? "none"} className="border-t border-[#eef3fb]">
                      <th scope="row" className="px-3 py-2 font-semibold text-slate-900 break-words">{m.school}</th>
                      {matrixKeys.map(k => (
                        <td key={k.key} className="px-2 py-1.5 text-right">
                          {m.schoolId && m[k.field] > 0
                            ? <button onClick={() => pick(m.schoolId, k.key)} aria-label={`${m.school}: ${m[k.field]} ${ELIGIBILITY_OPTIONS.find(o => o.key === k.key)?.label}`} aria-pressed={crossed(m.schoolId, k.key)}
                                className={`min-w-[2.5rem] rounded-md px-2 py-0.5 font-semibold ${crossed(m.schoolId, k.key) ? "bg-[#062444] text-white" : "text-[#00709f] hover:bg-[#eaf4fb]"}`}>{m[k.field]}</button>
                            : <span className="px-2 text-slate-800">{m[k.field]}</span>}
                        </td>
                      ))}
                      <td className="px-3 py-1.5 text-right">
                        {m.schoolId ? <button onClick={() => pick(m.schoolId, null)} aria-label={`${m.school}: all ${m.total}`} className="min-w-[2.5rem] rounded-md px-2 py-0.5 font-semibold text-[#00709f] hover:bg-[#eaf4fb]">{m.total}</button> : <span className="px-2 text-slate-800">{m.total}</span>}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-[#dbe5f2] bg-[#f7f9fc] font-bold text-[#062444]">
                    <th scope="row" className="px-3 py-2">All schools shown</th>
                    {matrixKeys.map(k => (
                      <td key={k.key} className="px-2 py-2 text-right">
                        {sums[k.field] > 0 ? <button onClick={() => change({ schoolIds: [], eligibility: [k.key] })} className="min-w-[2.5rem] rounded-md px-2 py-0.5 text-[#00709f] hover:bg-[#eaf4fb]" aria-label={`All schools: ${sums[k.field]} ${ELIGIBILITY_OPTIONS.find(o => o.key === k.key)?.label}`}>{sums[k.field]}</button> : <span className="px-2">0</span>}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right">{sums.total}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))}
        <p className="px-3 pb-2 text-[13px] text-slate-700">A scholar who is both “For consultation” and “For SDP reconsideration” is counted in both columns. The table follows the search, school, year level and program filters.</p>
      </div>

      {!rows ? <p className="text-[14px] text-slate-700 flex items-center gap-2"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…</p>
      : rows.length === 0 ? <p className="rounded-xl border border-dashed border-[#e6ecf5] px-4 py-8 text-center text-[14px] text-slate-700">{refreshing ? "Checking the scholars…" : anyFilter ? "No scholar matches these filters." : options && options.scholars === 0 ? "No scholar can renew in this term." : viewer.evaluator ? "No scholar has been checked yet. Press Refresh." : "No scholar has been checked yet. The Scholar Renewal Evaluator checks the scholars with the Refresh button."}</p>
      : (
        <>
          <div className="hidden xl:block rounded-xl border border-[#e6ecf5] bg-white" aria-label="Scholar list">
            <table className="w-full table-fixed text-left text-[14px]">
              <thead className="bg-[#f7f9fc] text-[#062444]">
                <tr>
                  {[["Scholar", "w-[20%]"], ["SDP status", "w-[10%]"], ["Grades", "w-[12%]"], ["Renewal eligibility", "w-[12%]"], ["Renewal status", "w-[22%]"], ["Action needed", "w-[24%]"]]
                    .map(([h, w]) => <th key={h} scope="col" className={`px-2 py-2.5 font-bold align-bottom ${w}`}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.scholarIdNumber} className="border-t border-[#eef3fb] align-top">
                    <td className="px-2 py-2.5 break-words">
                      <div className="font-bold text-[#062444]">{r.name}</div>
                      <div className="text-[13px] text-slate-700">{r.scholarIdNumber} · {r.status}</div>
                      <div className="text-[13px] text-slate-800">{r.school || "No school"}</div>
                      <div className="text-[13px] text-slate-800">{r.program || "No program"} · {r.yearLevel || "No year level"}</div>
                    </td>
                    <td className="px-2 py-2.5 break-words"><SdpCell r={r} onView={setViewing} /></td>
                    <td className="px-2 py-2.5 break-words"><GradesCell r={r} /></td>
                    <td className="px-2 py-2.5"><EligibilityCell r={r} /></td>
                    <td className="px-2 py-2.5 break-words"><SummaryCell r={r} facts={facts?.[r.scholarIdNumber] ?? null} ready={facts !== null && !actionsMissing} /></td>
                    <td className="px-2 py-2.5 break-words"><ActionCell r={r} facts={facts?.[r.scholarIdNumber] ?? null} ready={facts !== null && !actionsMissing} viewer={viewer} busy={referBusy} onAct={act} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="xl:hidden space-y-2.5">
            {rows.map(r => (
              <li key={r.scholarIdNumber} className="rounded-xl border border-[#e6ecf5] bg-white px-3.5 py-3 text-[14px]">
                <p className="font-bold text-[#062444]">{r.name} <span className="font-normal text-slate-600">· {r.scholarIdNumber}</span></p>
                <p className="text-slate-800">{r.school || "No school"} · {r.program || "No program"} · {r.yearLevel || "No year level"} · {r.status}</p>
                <dl className="mt-1.5 grid grid-cols-[7rem_1fr] gap-x-2 gap-y-1.5">
                  <dt className="text-slate-600">SDP status</dt><dd><SdpCell r={r} onView={setViewing} /></dd>
                  <dt className="text-slate-600">Grades</dt><dd><GradesCell r={r} /></dd>
                  <dt className="text-slate-600">Eligibility</dt><dd><EligibilityCell r={r} /></dd>
                  <dt className="text-slate-600">Renewal status</dt><dd><SummaryCell r={r} facts={facts?.[r.scholarIdNumber] ?? null} ready={facts !== null && !actionsMissing} /></dd>
                  <dt className="text-slate-600">Action needed</dt><dd><ActionCell r={r} facts={facts?.[r.scholarIdNumber] ?? null} ready={facts !== null && !actionsMissing} viewer={viewer} busy={referBusy} onAct={act} /></dd>
                </dl>
              </li>
            ))}
          </ul>
          <div className="mt-3">
            <ListPagination page={page} totalPages={totalPages} onPageChange={setPage} filteredCount={total} pageSize={SCHOLAR_LIST_PAGE_SIZE} itemLabel="scholars" />
          </div>
        </>
      )}

      {viewing && <SdpCreditsModal scholar={viewing} schoolYear={schoolYear} term={term} onClose={() => setViewing(null)} />}
      {acting?.key === "approve_grades" && (
        <ModalShell title={`Entered grades of ${acting.row.name}`} onClose={() => setActing(null)} wide>
          <RenewalEnteredGradesTab refreshKey={refreshKey} onChanged={() => onChanged?.()} only={{ scholarIdNumber: acting.row.scholarIdNumber, onDone: afterAct }} />
        </ModalShell>
      )}
      {acting?.key === "decide_sdp" && (
        <ModalShell title={`SDP reconsideration of ${acting.row.name}`} onClose={() => setActing(null)} wide>
          <RenewalSdpReconsiderationTab refreshKey={refreshKey} onChanged={() => onChanged?.()} only={{ scholarIdNumber: acting.row.scholarIdNumber, onDone: afterAct }} />
        </ModalShell>
      )}
      {acting?.key === "decide_case" && acting.facts.dhReferralId && (
        <ModalShell title={`${acting.row.name}: renewal for ${termLabelOf(schoolYear, term)}`} onClose={() => setActing(null)} wide>
          <ReferralFormPanel mode="approve" referralId={acting.facts.dhReferralId} onDone={afterAct} />
        </ModalShell>
      )}
      {referring && <ReferralFormModal mode="create" scholar={referring} onClose={() => setReferring(null)} onDone={afterAct} />}
    </div>
  );
}

/** One scholar's SDP credit information: the credits had in each category against the credits needed, the credits earned in the semester that counts, and credits set aside for later. */
export function SdpCreditsModal({ scholar, schoolYear, term, onClose }: { scholar: { scholarIdNumber: string; name: string }; schoolYear: string; term: string; onClose: () => void }) {
  const [data, setData] = useState<ScholarSdpCredits | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void fetchScholarSdpCredits(scholar.scholarIdNumber, schoolYear, term).then(r => { if (!live) return; if (r.ok) setData(r.credits); else setError(r.error); });
    return () => { live = false; };
  }, [scholar.scholarIdNumber, schoolYear, term]);
  const cats: [string, number | undefined][] = data ? [["community_service", data.sdp.communityService], ["community_volunteerism", data.sdp.communityVolunteerism], ["formation_program", data.sdp.formationProgram]] : [];
  const base = data?.required ?? 3;
  const owedOf = (k: string) => Math.max(0, (data?.sdp.required[k] ?? base) - base);      // credits lacking last semester (approved SDP reconsideration): they count against this semester
  const need = (_k: string) => base;
  return (
    <ModalShell title="SDP credits" onClose={onClose} wide>
      <p className="text-[14px] text-slate-900"><strong>{scholar.name}</strong> · {scholar.scholarIdNumber}</p>
      {error ? <p role="alert" className="text-[14px] text-red-700">{error}</p> : !data ? <p className="text-[14px] text-slate-700 flex items-center gap-2"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…</p> : (
        <>
          <p className="text-[14px] text-slate-800">The renewal for {termLabelOf(schoolYear, term)} looks at the SDP credits of {termLabelOf(data.basisSchoolYear, data.basisTerm)}. Each category needs {data.required} credits, Credits lacking last semester after an approved SDP reconsideration count against this semester, so they show as negative credits (credits left over from earlier semesters are counted).</p>
          {data.sdp.reconsideration && <p className="rounded-lg border border-[#e6ecf5] bg-[#f7f9fc] px-3 py-2 text-[14px] text-slate-900"><strong>SDP reconsideration: {sdpReconsiderationStatusText(data.sdp.reconsideration.status as SdpReconsiderationStatus).text}.</strong>{data.sdp.reconsideration.note ? ` Note: ${data.sdp.reconsideration.note}` : ""}</p>}
          <table className="w-full text-left text-[14px]">
            <thead className="text-[#062444]"><tr><th scope="col" className="py-1.5 pr-2 font-bold">Category</th><th scope="col" className="py-1.5 px-2 text-right font-bold">Credits</th><th scope="col" className="py-1.5 pl-2 font-bold">Status</th></tr></thead>
            <tbody>
              {cats.map(([k, n]) => (
                <tr key={k} className="border-t border-[#eef3fb]">
                  <td className="py-1.5 pr-2 text-slate-900">{SDP_CATEGORY_LABELS[k] ?? k}</td>
                  <td className="py-1.5 px-2 text-right text-slate-900">{(n ?? 0) - owedOf(k)} of {need(k)}</td>
                  <td className={`py-1.5 pl-2 font-semibold ${(n ?? 0) - owedOf(k) >= need(k) ? "text-green-900" : "text-red-800"}`}>{(n ?? 0) - owedOf(k) >= need(k) ? "Complete" : `Lacks ${need(k) - ((n ?? 0) - owedOf(k))}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 className="text-[14px] font-bold text-[#062444] pt-1">Credits earned in {termLabelOf(data.basisSchoolYear, data.basisTerm)}</h3>
          {data.credits.length === 0 ? <p className="text-[14px] text-slate-800">No SDP credit was recorded for this semester.</p> : (
            <ul className="space-y-1.5 text-[14px]">
              {data.credits.map((c, i) => <li key={i} className="rounded-lg border border-[#e6ecf5] px-3 py-1.5 text-slate-900"><span className="font-semibold">{c.activity}</span> · {SDP_CATEGORY_LABELS[c.category ?? ""] ?? "No category"} · {c.credits} credit{c.credits === 1 ? "" : "s"}{c.attendedDate ? <> · {formatDay(c.attendedDate)}</> : null}</li>)}
            </ul>
          )}
          {data.reserved.length > 0 && (
            <>
              <h3 className="text-[14px] font-bold text-[#062444] pt-1">Credits set aside</h3>
              <ul className="space-y-1.5 text-[14px]">
                {data.reserved.map((c, i) => <li key={i} className="rounded-lg border border-[#e6ecf5] px-3 py-1.5 text-slate-900">{SDP_CATEGORY_LABELS[c.category] ?? c.category} · {c.amount} credit{c.amount === 1 ? "" : "s"}{c.fromSemester ? <> from {c.fromSemester} {c.fromSchoolYear ?? ""}</> : null}{c.claimed ? " · already used" : ""}</li>)}
              </ul>
            </>
          )}
        </>
      )}
    </ModalShell>
  );
}
