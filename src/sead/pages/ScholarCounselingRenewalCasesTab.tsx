import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Clock, Loader2, Paperclip, RotateCcw, Search } from "lucide-react";
import { useLiveReload } from "@/lib/liveUpdates";
import { DOC_LABEL, docIndicatorText, formatDateTime, formatDay, formatSlot } from "@/lib/renewal";
import { reviewDocument } from "../renewalApi";
import {
  ENDORSE_STATUSES, ENDORSE_STATUS_INFO, allowResubmission, endorseStatus, fetchConsultCaseCounts, fetchConsultCaseDocs, fetchConsultCaseOne, fetchConsultCasesPage, fetchConsultCaseTerms,
  type ConsultCase, type ConsultCaseDocs, type ConsultCaseDocument, type EndorseStatus,
} from "../consultRenewalApi";
import { ReasonDialog } from "../renewal/ReasonDialog";
import { RenewalDocumentViewer } from "../renewal/RenewalDocumentViewer";
import { ModalShell } from "../components/SeadUiShell";
import { ServerPagination } from "@/app/components/ServerPagination";
import { pageCount } from "@/lib/dailyRecordsView";
import { useTabActive } from "@/lib/keepAlive";
import { casesFromSearch, casesToParams } from "@/lib/consultUrl";
import { ctReplace } from "../consultUrl";
import {
  ALL_TERMS, CASE_GROUPS, CASE_GROUP_LABEL, CASES_PAGE_SIZE, CASES_REMEMBER_KEY, casesFiltersActive, docsSummary, EMPTY_CASES_FILTERS, mergeLive, otherTermsOpen, pickTerm, readRememberedCases, splitTermKey,
  termKey, type CaseGroup, type CasesFilters, type CaseTermInfo,
} from "@/lib/consultCasesView";

const DOC_KINDS = ["inc_letter", "study_plan", "clearance"] as const;
const FIELD = "rounded-lg border border-[#062444]/25 bg-white px-2.5 py-2 text-[14px] text-slate-900";
const GROUP_CHIP: Record<string, string> = { ready: "border-green-400 bg-green-50 text-green-900", work: "border-sky-400 bg-sky-50 text-sky-900", sent: "border-slate-300 bg-slate-50 text-slate-800" };

function DocChip({ status }: { status: ConsultCaseDocument["status"] }) {
  const base = "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[13px] font-bold";
  if (status === "accepted") return <span className={`${base} border-green-300 bg-green-50 text-green-900`}><CheckCircle2 size={13} aria-hidden="true" /> Approved</span>;
  if (status === "returned") return <span className={`${base} border-red-300 bg-red-50 text-red-900`}><RotateCcw size={13} aria-hidden="true" /> Returned</span>;
  return <span className={`${base} border-sky-400 bg-sky-50 text-sky-900`}><Clock size={13} aria-hidden="true" /> Waiting for you</span>;
}

/** The choice of the new scholarship status, with a written reason (needed for every status except Regular). */
function EndorseDialog({ c, onCancel, onDone }: { c: ConsultCase; onCancel: () => void; onDone: () => void }) {
  const [status, setStatus] = useState<EndorseStatus | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const needsReason = status !== "" && ENDORSE_STATUS_INFO[status].needsReason;
  const ok = status !== "" && (!needsReason || note.trim().length >= 5);
  async function go() {
    if (status === "") return;
    setBusy(true); setError("");
    const r = await endorseStatus(c.recordId, status, note.trim());
    setBusy(false);
    if (r.ok) onDone(); else setError(r.error);
  }
  return (
    <ModalShell title={`Endorse the new status of ${c.name}`} onClose={onCancel} wide>
      <p className="text-[14px] text-slate-700 mb-3">The consultation was attended and the three documents are approved. Choose the scholarship status you endorse for the renewal of {c.termLabel}. The Scholar Renewal evaluator approves it; only then is the scholar renewed.</p>
      <fieldset className="space-y-2">
        <legend className="text-[14px] font-semibold text-[#062444] mb-1">New scholarship status</legend>
        {ENDORSE_STATUSES.map(s => (
          <label key={s} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-[14px] ${status === s ? "border-[#062444] bg-[#f7f9fc]" : "border-[#062444]/20"}`}>
            <input type="radio" name="endorse-status" checked={status === s} onChange={() => setStatus(s)} className="mt-1" />
            <span><strong className="text-[#062444]">{s}</strong><span className="block text-slate-700">{ENDORSE_STATUS_INFO[s].effect}</span></span>
          </label>
        ))}
      </fieldset>
      <label className="mt-3 block text-[14px] font-semibold text-[#062444]">
        Reason{needsReason ? "" : " (optional)"}
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={500}
          className="mt-1 w-full rounded-lg border border-[#062444]/25 px-3 py-2 text-[14px] font-normal outline-none focus:border-[#062444] bg-white" />
      </label>
      {needsReason && <p className="text-[13px] text-slate-600 mt-1">At least 5 characters.</p>}
      {error && <p role="alert" className="mt-2 text-[14px] text-red-700">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onCancel} disabled={busy} className="rounded-lg border border-[#062444]/25 px-4 py-2 text-[14px] font-semibold text-[#062444]">Cancel</button>
        <button onClick={() => void go()} disabled={!ok || busy} className="inline-flex items-center gap-1.5 rounded-lg bg-green-800 px-4 py-2 text-[14px] font-bold text-white hover:bg-green-900 disabled:opacity-50">
          {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />} Endorse{status ? ` ${status}` : ""}
        </button>
      </div>
    </ModalShell>
  );
}

function readStored(): ReturnType<typeof readRememberedCases> {
  try { return readRememberedCases(window.sessionStorage.getItem(CASES_REMEMBER_KEY)); } catch { return null; }
}
type DocsState = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; docs: ConsultCaseDocs };

/**
 * Consultation Tool > Renewal Cases. For scholars with a failed subject / DRP (and the INC letter of an INC case): the consultation staff approve or return the letter from the dean,
 * the study plan and the clearance, and — once the consultation was attended AND the three documents are approved — endorse the new scholarship status
 * (Regular, Probationary, Reconsidered or Removed). The Scholar Renewal evaluator then approves the endorsement. The database checks every step again.
 *
 * The cases are read PAGE BY PAGE from the database (25 a page, with the true total), for ONE term at a time (the current term first; the selector reaches the older terms and "All terms").
 * A case shows a summary; its documents are read when the case is opened: a case with documents waiting for you opens on its own, the others when you press "Show the documents". When someone else changes something, only the cases that changed are replaced (a case that came or went
 * is offered as "Refresh" instead of moving the list under your hand). The page, the term, the group and the search are remembered.
 */
export function ScholarCounselingRenewalCasesTab() {
  const stored = useMemo(() => casesFromSearch(window.location.search) ?? readStored(), []);      // the address first, the choices remembered in this browser tab second
  const active = useTabActive();
  const [filters, setFilters] = useState<CasesFilters>(stored?.filters ?? EMPTY_CASES_FILTERS);
  const [typed, setTyped] = useState(stored?.filters.search ?? "");
  const [page, setPage] = useState(stored?.page ?? 1);
  const [terms, setTerms] = useState<CaseTermInfo[] | null>(null);
  const [counts, setCounts] = useState<{ ready: number; work: number; sent: number } | null>(null);
  const [rows, setRows] = useState<ConsultCase[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  const [fileError, setFileError] = useState("");
  const [reviewing, setReviewing] = useState<{ doc: ConsultCaseDocument; approve: boolean; recordId: string } | null>(null);
  const [endorsing, setEndorsing] = useState<ConsultCase | null>(null);
  const [busyDoc, setBusyDoc] = useState("");
  const [viewer, setViewer] = useState<{ doc: ConsultCaseDocument; recordId: string; name: string } | null>(null);      // a document opened in the pop-up
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [docs, setDocs] = useState<Record<string, DocsState>>({});
  const [newUpdates, setNewUpdates] = useState(0);
  const request = useRef(0);

  // the term shown: the remembered / chosen one when it still exists, else the current term
  const termValue = terms ? pickTerm(filters.term, terms) : filters.term;
  const termParts = termValue === ALL_TERMS ? null : splitTermKey(termValue);
  const query = useMemo(() => ({ schoolYear: termParts?.schoolYear ?? null, term: termParts?.term ?? null, group: filters.group, search: filters.search }), [termParts?.schoolYear, termParts?.term, filters.group, filters.search]);

  useEffect(() => {
    try { window.sessionStorage.setItem(CASES_REMEMBER_KEY, JSON.stringify({ filters: { ...filters, term: termValue }, page })); } catch { /* private window: it just is not remembered */ }
  }, [filters, termValue, page]);
  // the address says the same (it only REPLACES the current step of the history)
  useEffect(() => { if (active) ctReplace(casesToParams({ filters: { ...filters, term: termValue }, page })); }, [active, filters, termValue, page]);

  // the search waits until the person stops typing (300 ms), then starts again from page 1
  useEffect(() => {
    if (typed === filters.search) return;
    const t = window.setTimeout(() => { setFilters(f => ({ ...f, search: typed })); setPage(1); }, 300);
    return () => window.clearTimeout(t);
  }, [typed, filters.search]);

  const loadTerms = useCallback(async () => {
    const r = await fetchConsultCaseTerms();
    if (!r.ok) { if (r.missing) setMissing(true); else setError(r.error); return; }
    setTerms(r.terms);
  }, []);
  useEffect(() => { void loadTerms(); }, [loadTerms]);

  const loadCounts = useCallback(async () => {
    const r = await fetchConsultCaseCounts({ schoolYear: query.schoolYear, term: query.term, search: query.search });
    if (r.ok) setCounts({ ready: r.ready, work: r.work, sent: r.sent });
  }, [query.schoolYear, query.term, query.search]);

  /** The cases with documents WAITING FOR YOU open on their own (their documents are read now, for those cases only); the other cases open when you press "Show the documents". */
  function autoOpen(list: ConsultCase[]) {
    const toOpen = list.filter(c => c.docsSubmitted > 0 && !open.has(c.recordId));
    if (toOpen.length === 0) return;
    setOpen(prev => { const n = new Set(prev); for (const c of toOpen) n.add(c.recordId); return n; });
    for (const c of toOpen) void loadDocs(c.recordId);
  }

  /** Reads the page. `quiet` (a live update): nothing is cleared; the cases that changed are replaced and a case that came or went is offered as "Refresh". */
  const load = useCallback(async (quiet = false) => {
    if (!terms) return;      // the term is known once the terms have arrived
    const mine = ++request.current;
    if (!quiet) { setLoading(true); setNewUpdates(0); }
    const r = await fetchConsultCasesPage(query, page, CASES_PAGE_SIZE);
    if (mine !== request.current) return;          // a newer question was asked meanwhile
    if (!quiet) setLoading(false);
    if (!r.ok) { if (r.missing) setMissing(true); else if (!quiet) setError(r.error); if (!quiet) setRows([]); return; }
    setError("");
    const last = pageCount(r.total, CASES_PAGE_SIZE);
    if (!quiet && r.total > 0 && page > last) { setPage(last); return; }      // fewer pages now: go to the last one
    if (quiet && rows) {
      const m = mergeLive(rows, r.rows);
      if (m.listChanged > 0) { setNewUpdates(m.listChanged); return; }
      setRows(m.rows); setTotal(r.total);
      for (const id of m.changedIds) if (open.has(id)) void loadDocs(id);      // a case that is open: its documents are read again too
      autoOpen(m.rows.filter(c => m.changedIds.includes(c.recordId)));      // a case that now has documents waiting opens on its own
      return;
    }
    setRows(r.rows); setTotal(r.total);
    autoOpen(r.rows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terms, query, page, rows, open]);
  useEffect(() => { if (!terms || missing) return; void load(); void loadCounts(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [terms, query, page, missing]);

  // a live update: the counts, the terms and the cases that changed are read again quietly (no "Loading…", no list moved under the hand)
  useLiveReload(async () => { if (!missing && terms) { await Promise.all([load(true), loadCounts(), loadTerms()]); } });

  const change = (patch: Partial<CasesFilters>) => { setFilters(f => ({ ...f, term: termValue, ...patch })); setPage(1); };
  const clear = () => { setTyped(""); setFilters({ ...EMPTY_CASES_FILTERS, term: termValue }); setPage(1); };
  const refreshNow = () => { setNewUpdates(0); void load(); void loadCounts(); void loadTerms(); };

  async function loadDocs(id: string) {
    setDocs(d => ({ ...d, [id]: d[id]?.state === "ready" ? d[id] : { state: "loading" } }));      // an open case keeps showing its documents while they are read again
    const r = await fetchConsultCaseDocs(id);
    setDocs(d => ({ ...d, [id]: r.ok ? { state: "ready", docs: r.docs } : { state: "error", message: r.error } }));
  }
  function toggleOpen(id: string) {
    const isOpen = open.has(id);
    setOpen(prev => { const n = new Set(prev); if (isOpen) n.delete(id); else n.add(id); return n; });
    if (!isOpen) void loadDocs(id);      // the documents are read now, not for every case up front
  }
  /** After approving, returning or endorsing: only THIS case (and the numbers) are read again. */
  async function refreshCase(id: string) {
    const [one] = await Promise.all([fetchConsultCaseOne(id), loadCounts(), loadTerms()]);
    if (one.ok && one.row) { const row = one.row; setRows(prev => (prev ?? []).map(c => c.recordId === id ? row : c)); }
    else if (one.ok && !one.row) { setRows(prev => (prev ?? []).filter(c => c.recordId !== id)); setTotal(t => Math.max(0, t - 1)); }
    if (open.has(id)) await loadDocs(id);
  }

  async function reopen(recordId: string, d: ConsultCaseDocument) {
    if (!window.confirm(`Allow the scholar to send a new ${DOC_LABEL[d.kind].toLowerCase()}? This approved document will count as NOT approved until the new one is approved. When the scholar uploads the new file, the old one is deleted.`)) return;
    setBusyDoc(d.id); setFileError("");
    const r = await allowResubmission(d.id);
    setBusyDoc("");
    if (!r.ok) setFileError(r.error);
    await refreshCase(recordId);
  }
  async function approve(recordId: string, d: ConsultCaseDocument) {
    setBusyDoc(d.id); setFileError("");
    const r = await reviewDocument(d.id, true, "");
    setBusyDoc("");
    if (!r.ok) setFileError(r.error);
    await refreshCase(recordId);
  }

  if (missing) return <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[14px] text-amber-950">This tab needs the latest database update (supabase_migration_consultation_renewal_cases_paging.sql). Ask the IT admin to run it.</p>;
  if (error && !rows) return <p role="alert" className="text-[14px] text-red-700">{error}</p>;

  const activeGroup = CASE_GROUPS.find(g => g.key === filters.group) ?? CASE_GROUPS[0];
  const countOf = (k: CaseGroup): number | null => (!counts ? null : k === "" ? counts.ready + counts.work + counts.sent : counts[k]);
  const anyFilter = casesFiltersActive(filters) || typed.trim() !== "";
  const older = terms ? otherTermsOpen(termValue, terms) : 0;
  const skeleton = loading && (rows === null || rows.length === 0);

  return (
    <div className="space-y-4">
      <p className="text-[14px] text-slate-700">Renewal cases of scholars with a failed subject, a DRP or an INC. You approve the three documents (letter from the dean, study plan, clearance) and endorse the new scholarship status after the consultation.</p>

      <div className="flex flex-wrap items-end gap-x-3 gap-y-2" role="group" aria-label="Filters">
        <div className="relative w-full max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" aria-hidden="true" />
          <input value={typed} onChange={e => setTyped(e.target.value)} placeholder="Search by name or Scholar ID…" aria-label="Search by name or Scholar ID"
            className="w-full rounded-lg border border-[#e6ecf5] bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[#062444]" />
        </div>
        <label className="text-[13px] font-semibold text-slate-700">Term
          <select value={termValue} onChange={e => change({ term: e.target.value })} aria-label="Renewal term" className={`${FIELD} mt-0.5 block w-[22rem] max-w-full font-normal`}>
            {(terms ?? []).map(t => <option key={termKey(t.schoolYear, t.term)} value={termKey(t.schoolYear, t.term)}>{t.label}{t.isCurrent ? " (current)" : ""} · {t.openCount} open</option>)}
            <option value={ALL_TERMS}>All terms</option>
          </select>
        </label>
        {anyFilter && <button type="button" onClick={clear} className="pb-2 text-[13.5px] font-semibold text-[#00709f] hover:underline">Clear filters</button>}
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Show">
        {CASE_GROUPS.map(g => {
          const n = countOf(g.key), on = filters.group === g.key;
          return (
            <button key={g.key || "all"} type="button" onClick={() => change({ group: g.key })} aria-pressed={on}
              className={`rounded-full border px-3.5 py-1.5 text-[14px] font-semibold ${on ? "border-[#062444] bg-[#062444] text-white" : "border-[#062444]/25 bg-white text-[#062444] hover:bg-[#f7f9fc]"}`}>
              {g.label}{n === null ? "" : <span className={`ml-1.5 ${on ? "text-[#F3BC00]" : "text-[#006aa3]"}`}>{n.toLocaleString("en-US")}</span>}
            </button>
          );
        })}
      </div>
      <p className="text-[13.5px] text-slate-600 -mt-2">{activeGroup.hint}</p>
      {older > 0 && termValue !== ALL_TERMS && (
        <p role="status" className="text-[13.5px] text-slate-800">{older.toLocaleString("en-US")} more open case{older === 1 ? " is" : "s are"} in older terms. <button type="button" onClick={() => change({ term: ALL_TERMS })} className="font-semibold text-[#00709f] hover:underline">Show all terms</button></p>
      )}

      {newUpdates > 0 && (
        <p role="status" className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-[14px] text-sky-950">
          {newUpdates} new update{newUpdates === 1 ? "" : "s"} — cases came or left this page.
          <button type="button" onClick={refreshNow} className="rounded-md border border-sky-700 px-2.5 py-0.5 font-bold text-sky-900 hover:bg-sky-100">Refresh</button>
        </p>
      )}
      {error && <p role="alert" className="text-[14px] text-red-700">Couldn't load the cases: {error}</p>}
      {fileError && <p role="alert" className="text-[14px] text-red-700">{fileError}</p>}

      {skeleton ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading the cases">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="rounded-xl border border-[#e6ecf5] bg-white px-4 py-4"><div className="h-5 w-56 animate-pulse rounded bg-slate-200" /><div className="mt-2 h-4 w-80 animate-pulse rounded bg-slate-200" /><div className="mt-2 h-4 w-64 animate-pulse rounded bg-slate-200" /></div>
          ))}
        </div>
      ) : (rows ?? []).length === 0 ? (
        <p className="rounded-xl border border-dashed border-[#e6ecf5] px-4 py-8 text-center text-[14px] text-slate-700">
          {anyFilter ? <>No renewal case matches these filters. <button type="button" onClick={clear} className="font-semibold text-[#00709f] hover:underline">Clear filters</button></> : "No open renewal cases in this term."}
        </p>
      ) : (
        <div className={`space-y-3 ${loading ? "opacity-60" : ""}`}>
          {(rows ?? []).map(c => {
            const isOpen = open.has(c.recordId), ds = docs[c.recordId];
            return (
              <article key={c.recordId} className="rounded-xl border border-[#e6ecf5] bg-white px-4 py-3 text-[14px] text-slate-800">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-[16px] font-bold text-[#062444]">{c.name} <span className={`ml-1 inline-block rounded-full border px-2 py-0.5 align-middle text-[12.5px] font-bold ${GROUP_CHIP[c.group]}`}>{CASE_GROUP_LABEL[c.group]}</span></h3>
                    <p className="text-slate-700">{c.scholarIdNumber} · {c.school} · {c.program} · {c.yearLevel}</p>
                    <p className="text-slate-700">Renewal for <strong>{c.termLabel}</strong> · status now: <strong>{c.scholarStatus}</strong></p>
                  </div>
                  {c.canEndorse && <button onClick={() => setEndorsing(c)} className="inline-flex items-center gap-1.5 rounded-lg bg-green-800 px-4 py-2 text-[14px] font-bold text-white hover:bg-green-900"><CheckCircle2 size={15} aria-hidden="true" /> Endorse the new status</button>}
                </div>
                <p className="mt-2 text-slate-800">
                  {[...c.failedSubjects.map(f => `${f.subject || f.code}: ${f.grade}${f.outcome === "drp" ? " (DRP)" : " (failed)"}`), ...c.incSubjects.map(f => `${f.subject || f.code}: INC`)].join(" · ") || "—"}
                </p>
                <p className="mt-1 text-slate-800">
                  <strong>Consultation:</strong>{" "}
                  {c.consultationDoneAt ? `attended on ${formatDay(c.consultationDoneAt)}` : c.nextConsultation ? `booked for ${formatSlot(c.nextConsultation.startsAt)} with ${c.nextConsultation.staff}` : "not booked yet"}
                </p>
                <p className="mt-1 text-slate-800"><strong>Documents:</strong> {docsSummary(c)}</p>
                {c.documents.length === 0 && !c.legacy && ["ready_for_endorsement", "needs_study_plan_consultation", "endorsed_for_approval"].includes(c.stage) && (
                  <p className="mt-1 text-[13.5px] text-slate-600">No document is needed yet. The study plan and the clearance (and the letter from the dean when there is an INC) are asked after the evaluator approves the status; the “Waiting for … upload” lines then appear here.</p>
                )}
                {c.documents.length > 0 && (
                  <ol className="mt-1 list-decimal space-y-0.5 pl-5" aria-label={`Documents ${c.name} must send`}>
                    {c.documents.map(d => (
                      <li key={d.kind} className={d.state === "accepted" ? "text-green-900" : d.state === "submitted" ? "text-sky-900" : "text-amber-900"}>
                        <span className="font-semibold">{docIndicatorText(d.kind, d.state)}</span>
                      </li>
                    ))}
                  </ol>
                )}
                <button type="button" onClick={() => toggleOpen(c.recordId)} aria-expanded={isOpen}
                  className="mt-2 inline-flex items-center gap-1 text-[13.5px] font-semibold text-[#00709f] hover:underline">
                  {isOpen ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />} {isOpen ? "Hide the documents" : "Show the documents"}
                </button>
                {isOpen && (
                  <div className="mt-2">
                    {(!ds || ds.state === "loading") && <p className="text-slate-600" role="status">Loading the documents…</p>}
                    {ds?.state === "error" && <p role="alert" className="text-red-700">Couldn't load them: {ds.message} <button type="button" onClick={() => void loadDocs(c.recordId)} className="font-semibold text-[#00709f] hover:underline">Try again</button></p>}
                    {ds?.state === "ready" && (
                      <ul className="space-y-1.5" aria-label={`Documents of ${c.name}`}>
                        {DOC_KINDS.filter(k => ds.docs.requiredDocuments.some(d => d.kind === k) || ds.docs.documents.some(d => d.kind === k)).map(k => {
                          const list = ds.docs.documents.filter(d => d.kind === k);
                          const current = list.find(d => d.status !== "returned") ?? list[0];
                          return (
                            <li key={k} className="flex flex-wrap items-center gap-2">
                              <span className="min-w-[8.5rem] font-semibold text-slate-900">{DOC_LABEL[k]}</span>
                              {!current ? <span className="text-slate-700">Not uploaded yet</span> : (
                                <>
                                  <button onClick={() => setViewer({ doc: current, recordId: c.recordId, name: c.name })} className="inline-flex items-center gap-1 font-semibold text-[#00709f] hover:underline"><Paperclip size={14} aria-hidden="true" /> {current.fileName}</button>
                                  <DocChip status={current.status} />
                                  <span className="text-[13px] text-slate-600">sent {formatDateTime(current.uploadedAt)}</span>
                                  {current.status === "returned" && current.comment && <span className="text-[13.5px] text-slate-800">“{current.comment}”</span>}
                                  {current.status === "accepted" && (
                                    <button type="button" onClick={() => void reopen(c.recordId, current)} disabled={busyDoc === current.id} className="rounded-md border border-[#062444]/40 bg-white px-2.5 py-1 text-[13px] font-bold text-[#062444] hover:bg-[#f7f9fc] disabled:opacity-60">Allow resubmission</button>
                                  )}
                                  {current.status === "submitted" && (
                                    <span className="flex gap-2">
                                      <button onClick={() => void approve(c.recordId, current)} disabled={busyDoc === current.id} className="rounded-md bg-green-800 px-2.5 py-1 text-[13px] font-bold text-white hover:bg-green-900 disabled:opacity-60">Approve</button>
                                      <button onClick={() => setReviewing({ doc: current, approve: false, recordId: c.recordId })} className="rounded-md border border-red-700 px-2.5 py-1 text-[13px] font-bold text-red-800 hover:bg-red-50">Return</button>
                                    </span>
                                  )}
                                </>
                              )}
                            </li>
                          );
                        })}
                        {ds.docs.requiredDocuments.length === 0 && ds.docs.documents.length === 0 && <li className="text-slate-700">No documents are needed or sent yet.</li>}
                      </ul>
                    )}
                  </div>
                )}
                {c.stage === "endorsed_for_approval" && c.endorsedStatus && (
                  <p className="mt-2 rounded-md border border-sky-300 bg-sky-50 px-2.5 py-2 text-sky-950">
                    <strong>Endorsed: {c.endorsedStatus}</strong>{c.endorsedBy ? ` by ${c.endorsedBy}` : ""}{c.endorsedAt ? ` on ${formatDay(c.endorsedAt)}` : ""}{c.endorsedNote ? ` — ${c.endorsedNote}` : ""}
                  </p>
                )}
                {!c.canEndorse && c.stage === "needs_study_plan_consultation" && <p className="mt-2 text-[13.5px] text-slate-600">You can endorse the status after the consultation is attended. No document is needed before that.</p>}
                {c.stage === "awaiting_documents" && <p className="mt-2 rounded-md border border-sky-300 bg-sky-50 px-2.5 py-2 text-sky-950"><strong>Approved by the evaluator: {c.endorsedStatus}.</strong> Waiting for the scholar's documents (the study plan and the clearance, and the letter from the dean when there is an INC). Approve each one when it arrives; the scholar is renewed when the last one is approved.</p>}
                {c.legacy && <p className="mt-2 text-[13.5px] text-amber-900">This case was already sent to the Division Head, so it follows the Division Head route.</p>}
              </article>
            );
          })}
        </div>
      )}
      <ServerPagination page={page} pageSize={CASES_PAGE_SIZE} total={total} onPageChange={p => setPage(Math.max(1, p))} noun="cases" disabled={loading} />

      {viewer && (
        <RenewalDocumentViewer doc={viewer.doc} scholarName={viewer.name} onClose={() => setViewer(null)}
          onApprove={async () => { const r = await reviewDocument(viewer.doc.id, true, ""); if (!r.ok) return r.error; const id = viewer.recordId; setViewer(null); await refreshCase(id); return null; }}
          onReject={async reason => { const r = await reviewDocument(viewer.doc.id, false, reason); if (!r.ok) return r.error; const id = viewer.recordId; setViewer(null); await refreshCase(id); return null; }}
          onAllowResubmission={async () => { const r = await allowResubmission(viewer.doc.id); if (!r.ok) return r.error; const id = viewer.recordId; setViewer(null); await refreshCase(id); return null; }} />
      )}
      {reviewing && (
        <ReasonDialog title={`Return the ${DOC_LABEL[reviewing.doc.kind].toLowerCase()}`} intro={<>Tell the scholar what to fix. The scholar uploads a new one; the consultation is not affected.</>} label="What should the scholar fix?" confirmLabel="Return it" minLength={5} danger
          onCancel={() => setReviewing(null)}
          onConfirm={async reason => { const r = await reviewDocument(reviewing.doc.id, false, reason); if (!r.ok) return r.error; const id = reviewing.recordId; setReviewing(null); await refreshCase(id); return null; }} />
      )}
      {endorsing && <EndorseDialog c={endorsing} onCancel={() => setEndorsing(null)} onDone={() => { const id = endorsing.recordId; setEndorsing(null); void refreshCase(id); }} />}
    </div>
  );
}
