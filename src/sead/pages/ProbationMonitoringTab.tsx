import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, History, Eye, ChevronDown, ChevronRight } from "lucide-react";
import { fetchProbationMonitoringPage, saveProbationNotes, type ProbationPageRow } from "../scholarCounselingApi";
import { fetchScholarInformationByIdNumber, type ScholarInformationRow } from "../seadApi";
import { ScholarProfilePreviewModal } from "../components/ScholarProfilePreviewModal";
import { CounselingHistoryModal } from "../components/CounselingHistoryModal";
import { extendIncDeadline, fetchProbationRenewalDetail, type ProbationRenewalInfo } from "../appointmentsApi";
import { getStaffRenewalDocumentUrl } from "../renewalApi";
import { ReasonDialog } from "../renewal/ReasonDialog";
import { MultiSelect } from "../renewal/RenewalScholarListTab";
import { ServerPagination } from "@/app/components/ServerPagination";
import { SortableTh, useSortState } from "@/app/components/SortableTable";
import { daysLeftText, formatDay, manilaToday } from "@/lib/renewal";
import { pageCount } from "@/lib/dailyRecordsView";
import { useTabActive } from "@/lib/keepAlive";
import { probationFromSearch, probationToParams } from "@/lib/consultUrl";
import { ctReplace } from "../consultUrl";
import {
  ATTENTION_OPTIONS, EMPTY_PROBATION_FILTERS, incSummary, KIND_OPTIONS, PROBATION_PAGE_SIZE, PROBATION_REMEMBER_KEY, probationFiltersActive, readRememberedProbation,
  type ProbationFilters, type ProbationKind,
} from "@/lib/probationView";

const TH = "px-3 py-2.5 text-left text-[13px] font-medium text-slate-600 whitespace-nowrap";
const FIELD = "rounded-lg border border-[#062444]/25 bg-white px-2.5 py-2 text-[14px] text-slate-900";
const COLS = 7;
const TONE: Record<string, string> = {
  none: "text-slate-600", ok: "text-slate-800", soon: "font-semibold text-amber-800", passed: "font-semibold text-red-700", unset: "text-slate-800",
};

/** Debounced auto-save text cell for Study Plan / Academic Contract Update — saves ~800ms after the last keystroke, or immediately on blur. */
function NoteCell({ value, onSave, label }: { value: string; onSave: (next: string) => Promise<void>; label: string }) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(value); }, [value]);

  useEffect(() => {
    if (draft === value) return;
    const t = setTimeout(() => void commit(), 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  async function commit() {
    if (draft === value) return;
    setSaving(true);
    await onSave(draft);
    setSaving(false);
  }

  return (
    <div className="relative">
      <textarea value={draft} onChange={e => setDraft(e.target.value)} onBlur={() => void commit()} rows={2} aria-label={label}
        placeholder="—"
        className="w-full border border-transparent hover:border-[#e6ecf5] focus:border-[#0088cc] rounded-lg px-2 py-1.5 text-[12.5px] outline-none resize-none bg-transparent focus:bg-white" />
      {saving && <span className="absolute -top-1.5 right-1 text-[9.5px] font-semibold text-slate-400">Saving…</span>}
    </div>
  );
}

function readStored(): ReturnType<typeof readRememberedProbation> {
  try { return readRememberedProbation(window.sessionStorage.getItem(PROBATION_REMEMBER_KEY)); } catch { return null; }
}

type Detail = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; infos: ProbationRenewalInfo[] };

/**
 * "Probationary Monitoring" — the scholars currently on Probationary status, for staff to track their study plan and academic contract status alongside their counseling history.
 * The list is read PAGE BY PAGE from the database (50 a page, with the true total); the search and the filters (needs attention: INC deadline soon / passed / study plan missing;
 * type: temporary (INC) or regular probation) and the sort run in the database. Each row only shows a SUMMARY of the renewal (the current and the previous term);
 * the INC items and the uploaded study plans are read when the row is opened. The page, filters, search and sort are remembered.
 */
export function ProbationMonitoringTab() {
  const stored = useMemo(() => probationFromSearch(window.location.search) ?? readStored(), []);      // the address first, the choices remembered in this browser tab second
  const active = useTabActive();
  const [filters, setFilters] = useState<ProbationFilters>(stored?.filters ?? EMPTY_PROBATION_FILTERS);
  const [typed, setTyped] = useState(stored?.filters.search ?? "");
  const { sortState, toggleSort } = useSortState({ key: stored?.sortKey ?? "name", direction: stored?.sortDir ?? "asc" });
  const sort = useMemo(() => ({ key: (sortState.key === "deadline" ? "deadline" : "name") as "name" | "deadline", dir: sortState.direction }), [sortState]);
  const [page, setPage] = useState(stored?.page ?? 1);
  const [rows, setRows] = useState<ProbationPageRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  const request = useRef(0);
  const [viewingScholar, setViewingScholar] = useState<ScholarInformationRow | null>(null);
  const [viewingInfoId, setViewingInfoId] = useState<string | null>(null);
  const [viewingHistoryFor, setViewingHistoryFor] = useState<{ scholarIdNumber: string; name: string } | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<Record<string, Detail>>({});
  const [extending, setExtending] = useState<{ itemId: string; subject: string; scholar: string; scholarId: string; deadline: string | null } | null>(null);
  const [newDeadline, setNewDeadline] = useState("");
  const [fileError, setFileError] = useState("");

  // remember the page, the filters, the search and the sort (also after another tool or a reload)
  useEffect(() => {
    try { window.sessionStorage.setItem(PROBATION_REMEMBER_KEY, JSON.stringify({ filters, sortKey: sort.key, sortDir: sort.dir, page })); } catch { /* private window: it just is not remembered */ }
  }, [filters, sort, page]);
  // the address says the same (it only REPLACES the current step of the history)
  useEffect(() => { if (active) ctReplace(probationToParams({ filters, sortKey: sort.key, sortDir: sort.dir, page })); }, [active, filters, sort, page]);

  // a new sort starts again from page 1 (not on the first run, so a remembered page is kept)
  const firstSort = useRef(true);
  useEffect(() => { if (firstSort.current) { firstSort.current = false; return; } setPage(1); }, [sort.key, sort.dir]);

  // the search waits until the person stops typing (300 ms), then starts again from page 1
  useEffect(() => {
    if (typed === filters.search) return;
    const t = window.setTimeout(() => { setFilters(f => ({ ...f, search: typed })); setPage(1); }, 300);
    return () => window.clearTimeout(t);
  }, [typed, filters.search]);

  const load = useCallback(async () => {
    const mine = ++request.current;
    setLoading(true);
    const r = await fetchProbationMonitoringPage(filters, sort, page, PROBATION_PAGE_SIZE);
    if (mine !== request.current) return;          // a newer question was asked meanwhile
    setLoading(false);
    if (!r.ok) { if (r.missing) setMissing(true); else setError(r.error); setRows([]); return; }
    setError(""); setMissing(false);
    const last = pageCount(r.total, PROBATION_PAGE_SIZE);
    if (r.total > 0 && page > last) { setPage(last); return; }      // fewer pages now (a filter or a clean-up): go to the last one
    setRows(r.rows); setTotal(r.total);
  }, [filters, sort, page]);
  useEffect(() => { void load(); }, [load]);

  const change = (patch: Partial<ProbationFilters>) => { setFilters(f => ({ ...f, ...patch })); setPage(1); };
  const clear = () => { setTyped(""); setFilters(EMPTY_PROBATION_FILTERS); setPage(1); };

  async function loadDetail(id: string) {
    setDetails(d => ({ ...d, [id]: { state: "loading" } }));
    const r = await fetchProbationRenewalDetail(id);
    setDetails(d => ({ ...d, [id]: r.ok ? { state: "ready", infos: r.infos } : { state: "error", message: r.error } }));
  }
  function toggleOpen(id: string) {
    const isOpen = open.has(id);
    setOpen(prev => { const n = new Set(prev); if (isOpen) n.delete(id); else n.add(id); return n; });
    if (!isOpen) void loadDetail(id);      // the documents are read now, not for every scholar up front
  }

  async function openStudyPlan(path: string) {
    const r = await getStaffRenewalDocumentUrl(path);
    if (r.ok) { setFileError(""); window.open(r.url, "_blank", "noopener"); } else setFileError(r.error);
  }

  async function handleViewInfo(scholarIdNumber: string) {
    setViewingInfoId(scholarIdNumber);
    const info = await fetchScholarInformationByIdNumber(scholarIdNumber);
    setViewingInfoId(null);
    if (info) setViewingScholar(info);
  }

  function updateLocal(scholarIdNumber: string, patch: Partial<ProbationPageRow>) {
    setRows(prev => (prev ?? []).map(r => r.scholarIdNumber === scholarIdNumber ? { ...r, ...patch } : r));
  }

  const today = manilaToday();
  const anyFilter = probationFiltersActive(filters) || typed.trim() !== "";
  const skeleton = loading && (rows === null || rows.length === 0);      // the first load, or a load after a list with nothing in it; a page change keeps the old rows (dimmed) until the new ones arrive

  return (
    <div>
      <p className="mb-3 text-sm text-muted-foreground">Scholars currently on Probationary status — track their study plan and academic contract alongside their consultation history. The renewal information is for the current and the previous term.</p>

      <div className="mb-3 relative w-full max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" aria-hidden="true" />
        <input value={typed} onChange={e => setTyped(e.target.value)} placeholder="Search by name or Scholar ID…" aria-label="Search by name or Scholar ID"
          className="w-full rounded-lg border border-[#e6ecf5] bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[#062444]" />
      </div>

      <div className="mb-2 flex flex-wrap items-end gap-x-3 gap-y-2" role="group" aria-label="Filters">
        <div className="w-64"><MultiSelect label="Needs attention" options={ATTENTION_OPTIONS} selected={filters.attention} onChange={attention => change({ attention: attention as ProbationFilters["attention"] })} /></div>
        <label className="text-[13px] font-semibold text-slate-700">Type
          <select value={filters.kind} onChange={e => change({ kind: e.target.value as ProbationKind })} aria-label="Probation type" className={`${FIELD} mt-0.5 block w-44 font-normal`}>
            {KIND_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        {anyFilter && <button type="button" onClick={clear} className="pb-2 text-[13.5px] font-semibold text-[#00709f] hover:underline">Clear filters</button>}
      </div>

      {missing && <p role="status" className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[14px] text-amber-950">The Probationary Monitoring list needs the latest database update (supabase_migration_consultation_probation_paging.sql). Ask the IT admin to run it.</p>}
      {error && <p role="alert" className="mb-3 text-[14px] text-red-700">Couldn't load the scholars: {error}</p>}

      <div className="overflow-hidden rounded-2xl border border-[#e6ecf5] bg-white">
        <table className="w-full table-fixed border-collapse text-[14px]" aria-busy={loading}>
          <caption className="sr-only">Scholars on probationary status</caption>
          <colgroup>
            <col style={{ width: 34 }} />
            <col />
            <col style={{ width: 190 }} />
            <col style={{ width: 220 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 80 }} />
          </colgroup>
          <thead>
            <tr className="bg-[#f8fafd]">
              <th scope="col" className={TH}><span className="sr-only">Open</span></th>
              <SortableTh label="Name" sortKey="name" sortState={sortState} onSort={toggleSort} className={TH} />
              <th scope="col" className={TH}>Course · Year · School</th>
              <SortableTh label="Renewal (INC · study plan)" sortKey="deadline" sortState={sortState} onSort={toggleSort} className={TH} />
              <th scope="col" className={TH}>Study Plan</th>
              <th scope="col" className={TH} title="Academic Contract Update">Contract Update</th>
              <th scope="col" className={`${TH} text-center`}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {skeleton ? (
              Array.from({ length: 8 }, (_, i) => <tr key={i} className="border-t border-[#f0f3f8]" aria-hidden="true">{Array.from({ length: COLS }, (_, j) => <td key={j} className="px-3 py-3"><div className="h-4 animate-pulse rounded bg-slate-200" style={{ width: `${50 + ((i * 7 + j * 11) % 40)}%` }} /></td>)}</tr>)
            ) : (rows ?? []).length === 0 ? (
              <tr><td colSpan={COLS} className="px-4 py-10 text-center text-slate-700">{error ? "" : anyFilter ? <>No probationary scholar matches these filters. <button type="button" onClick={clear} className="font-semibold text-[#00709f] hover:underline">Clear filters</button></> : "No probationary scholars found."}</td></tr>
            ) : (
              (rows ?? []).map(r => {
                const id = r.scholarIdNumber, isOpen = open.has(id), det = details[id];
                const inc = incSummary(r.openIncCount, r.nextDeadline, today);
                return (
                  <Fragment key={id}>
                    <tr className={`border-t border-[#f0f3f8] align-top hover:bg-[#f8fafd] ${loading ? "opacity-60" : ""}`}>
                      <td className="px-1 py-2.5 text-center">
                        <button type="button" onClick={() => toggleOpen(id)} aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} the INC items and study plan files of ${r.name}`} title={isOpen ? "Hide details" : "Show the INC items and study plan files"}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#0077b6] hover:bg-[#e8f3fa]">{isOpen ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}</button>
                      </td>
                      <td className="px-3 py-2.5 font-medium text-[#062444]"><span className="block truncate" title={r.name}>{r.name}</span><span className="block truncate text-[12.5px] font-normal text-slate-600">{id}</span></td>
                      <td className="px-3 py-2.5 text-slate-700">
                        <span className="block truncate" title={r.course || undefined}>{r.course || "—"}</span>
                        <span className="block truncate text-[12.5px] text-slate-600" title={r.school || undefined}>{[r.yearLevel, r.school].filter(Boolean).join(" · ") || "—"}</span>
                      </td>
                      <td className="px-3 py-2.5 text-[13px]">
                        {r.temporary && <span className="mb-1 inline-block rounded-full border border-amber-400 bg-amber-50 px-2 py-0.5 text-[12.5px] font-bold text-amber-900">Temporary — INC</span>}
                        <p className={TONE[inc.tone]}>{inc.text}</p>
                        <p className={r.hasStudyPlan ? "text-green-800" : "text-slate-600"}>{r.hasStudyPlan ? "Study plan uploaded" : "Study plan missing"}</p>
                      </td>
                      <td className="px-2 py-2"><NoteCell label={`Study plan note of ${r.name}`} value={r.studyPlan} onSave={async next => {
                        updateLocal(id, { studyPlan: next });
                        await saveProbationNotes(id, next, r.academicContractUpdate);
                      }} /></td>
                      <td className="px-2 py-2"><NoteCell label={`Academic contract update of ${r.name}`} value={r.academicContractUpdate} onSave={async next => {
                        updateLocal(id, { academicContractUpdate: next });
                        await saveProbationNotes(id, r.studyPlan, next);
                      }} /></td>
                      <td className="px-2 py-2.5 text-center whitespace-nowrap">
                        <button type="button" onClick={() => void handleViewInfo(id)} disabled={viewingInfoId === id} title="View the scholar's information" aria-label={`View information of ${r.name}`}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#0077b6] hover:bg-[#e8f3fa] disabled:opacity-50"><Eye size={17} aria-hidden="true" /></button>
                        <button type="button" onClick={() => setViewingHistoryFor({ scholarIdNumber: id, name: r.name })} title="View the consultation history" aria-label={`View consultation history of ${r.name}`}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#0077b6] hover:bg-[#e8f3fa]"><History size={17} aria-hidden="true" /></button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-[#f7f9fc]">
                        <td />
                        <td colSpan={COLS - 1} className="px-3 py-3 text-[13.5px] text-slate-800">
                          {(!det || det.state === "loading") && <p className="text-slate-600" role="status">Loading the INC items and study plan files…</p>}
                          {det?.state === "error" && <p role="alert" className="text-red-700">Couldn't load them: {det.message} <button type="button" onClick={() => void loadDetail(id)} className="font-semibold text-[#00709f] hover:underline">Try again</button></p>}
                          {det?.state === "ready" && det.infos.length === 0 && <p className="text-slate-700">No INC items or study plan files for the current or the previous term.</p>}
                          {det?.state === "ready" && det.infos.map(info => (
                            <div key={info.recordId} className="mb-2 last:mb-0">
                              <p className="font-semibold text-[#062444]">Renewal {info.termLabel}</p>
                              {info.temporaryInc && <span className="inline-block rounded-full border border-amber-400 bg-amber-50 px-2 py-0.5 text-[13px] font-bold text-amber-900">Temporary — INC</span>}
                              {info.incItems.map(i => (
                                <p key={i.itemId} className="mt-0.5">
                                  {i.subject}: {i.deadline ? <>deadline <strong>{formatDay(i.deadline)}</strong> ({daysLeftText(i.daysLeft)})</> : <strong>Deadline: to be set at consultation</strong>}
                                  {i.deadline && <button type="button" onClick={() => { setExtending({ itemId: i.itemId, subject: i.subject, scholar: r.name, scholarId: id, deadline: i.deadline }); setNewDeadline(""); }} className="ml-2 font-semibold text-[#00709f] hover:underline">Extend</button>}
                                </p>
                              ))}
                              {info.studyPlans.map(d => (
                                <p key={d.storagePath} className="mt-0.5">Study plan: <button type="button" onClick={() => void openStudyPlan(d.storagePath)} className="font-semibold text-[#00709f] hover:underline">{d.fileName}</button></p>
                              ))}
                            </div>
                          ))}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <ServerPagination page={page} pageSize={PROBATION_PAGE_SIZE} total={total} onPageChange={p => setPage(Math.max(1, p))} noun="scholars" disabled={loading} />

      {fileError && <p role="alert" className="mt-2 text-[13px] text-red-700">{fileError}</p>}
      {extending && (
        <ReasonDialog
          title="Extend the INC deadline"
          intro={<>{extending.scholar} — {extending.subject}. The current deadline is {formatDay(extending.deadline)}. The scholar is told the new date and your reason is kept in the history.</>}
          label="Reason" confirmLabel="Extend deadline" extraValid={!!newDeadline && newDeadline > (extending.deadline ?? manilaToday())}
          onCancel={() => setExtending(null)}
          onConfirm={async reason => {
            const x = await extendIncDeadline(extending.itemId, newDeadline, reason);
            if (!x.ok) return x.error;
            const sid = extending.scholarId;
            setExtending(null);
            void loadDetail(sid); void load();      // only this scholar's details and the page are read again
            return null;
          }}
        >
          <label className="block text-[14px] font-semibold text-[#062444] mb-3">New deadline (later than the current one)
            <input type="date" min={extending.deadline ?? manilaToday()} value={newDeadline} onChange={e => setNewDeadline(e.target.value)} className="mt-1 block rounded-lg border border-[#062444]/25 px-3 py-2 text-[14px] font-normal bg-white" />
          </label>
        </ReasonDialog>
      )}
      {viewingScholar && <ScholarProfilePreviewModal scholar={viewingScholar} onClose={() => setViewingScholar(null)} />}
      {viewingHistoryFor && (
        <CounselingHistoryModal scholarIdNumber={viewingHistoryFor.scholarIdNumber} scholarName={viewingHistoryFor.name}
          onClose={() => setViewingHistoryFor(null)} />
      )}
    </div>
  );
}

