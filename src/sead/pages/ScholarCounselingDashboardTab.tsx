import { useCallback, useEffect, useRef, useState } from "react";
import { Users, Home, AlertTriangle, Clock, CalendarDays, ChevronRight, CheckCircle2, Printer, Search } from "lucide-react";
import { downloadRemovalForm, fetchConsultRemovalForms, type RemovalFormItem } from "@/lib/removalFormApi";
import { TerminationFormsModal } from "../components/TerminationFormsModal";
import { DASHBOARD_PAGE_SIZE, fetchApprovedPage, fetchDashboardCounts, fetchFinalDecisions, fetchQueuePage, finalizeDecision, type DashboardCounts, type FinalDecisionItem, type ListPage, type QueuedReferral } from "../referralApi";
import { ReferralFormModal } from "../components/ReferralFormModal";
import { printApprovedReferral } from "../referralPrint";
import { ServerPagination } from "@/app/components/ServerPagination";
import { pageCount } from "@/lib/dailyRecordsView";
import { dashboardTarget, type DashboardKind, type DashboardTarget } from "@/lib/dashboardLinks";
import { manilaToday } from "@/lib/renewal";

function SummaryCard({ icon, title, note, children }: { icon: React.ReactNode; title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-[#e6ecf5] p-4">
      <div className="flex items-center gap-2 mb-3 text-[#0088cc]">{icon}<p className="text-[11px] font-bold uppercase tracking-wide">{title}</p></div>
      {children}
      {note && <p className="mt-2 text-[11.5px] text-slate-500">{note}</p>}
    </div>
  );
}
/** A number on a card. With `onOpen` it is a button that takes you to the tab that lists what the number counts. */
function Stat({ label, value, onOpen, hint }: { label: string; value: number | null; onOpen?: () => void; hint?: string }) {
  const body = (
    <>
      {value === null ? <span className="my-1 block h-7 w-12 animate-pulse rounded bg-slate-200" aria-hidden="true" /> : <p className="text-2xl font-bold text-[#062444]">{value.toLocaleString("en-US")}</p>}
      <p className="text-[11.5px] text-slate-500 break-words [overflow-wrap:anywhere]">{label}</p>
    </>
  );
  return onOpen && value !== null
    ? <button type="button" onClick={onOpen} title={hint} aria-label={`${label}: ${value}. ${hint ?? "Open the list"}`} className="rounded-lg text-left hover:bg-[#f0f6fc] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0077b6] -mx-1 px-1">{body}</button>
    : <div>{body}</div>;
}

const EMPTY_PAGE: ListPage = { rows: [], total: 0, paged: true };

/**
 * "Main Dashboard" — the Scholar Counseling Tool's landing subtab: a summary of office-wide monitoring counts plus the signed-in staff
 * member's own personal referral queue (Pending / Reconsideration counts, clients served this month, and the actual list of scholars to counsel —
 * oldest first, only the first entry actionable) and their approved referrals.
 *
 * Each number is counted by the database with the same rule as the tab it belongs to, and pressing it opens that tab with the filters already set (so the total you land on is the number you pressed).
 * The two lists that grow — Scholars to be Consulted and Approved Referrals — are read page by page (20 a page, with the true total); each part of the page loads on its own, with grey placeholders meanwhile.
 */
export function ScholarCounselingDashboardTab({ onOpenTarget }: { onOpenTarget?: (t: DashboardTarget) => void } = {}) {
  const [counts, setCounts] = useState<DashboardCounts | null>(null);
  const [countsFailed, setCountsFailed] = useState(false);
  const [queue, setQueue] = useState<ListPage>(EMPTY_PAGE);
  const [queuePage, setQueuePage] = useState(1);
  const [queueLoading, setQueueLoading] = useState(true);
  const [approved, setApproved] = useState<ListPage>(EMPTY_PAGE);
  const [approvedPage, setApprovedPage] = useState(1);
  const [approvedLoading, setApprovedLoading] = useState(true);
  const [typed, setTyped] = useState("");
  const [approvedSearch, setApprovedSearch] = useState("");
  const [working, setWorking] = useState<QueuedReferral | null>(null);
  const [viewing, setViewing] = useState<QueuedReferral | null>(null);
  const [printingId, setPrintingId] = useState<string | null>(null);
  // cases the Division Head approved and signed: the consulting staff member who consulted the scholar makes the final decision
  const [finals, setFinals] = useState<FinalDecisionItem[]>([]);
  const [finalBusy, setFinalBusy] = useState<string | null>(null);
  const [finalError, setFinalError] = useState("");
  // the termination forms of the removals the Division Head approved (to download, print and have signed by the scholar and the parent or guardian)
  const [forms, setForms] = useState<RemovalFormItem[]>([]);
  const [formBusy, setFormBusy] = useState<string | null>(null);
  const [formError, setFormError] = useState("");
  const [formsOpen, setFormsOpen] = useState(false);      // the pop-up with the list of the termination forms
  const queueRef = useRef<HTMLDivElement>(null);
  const reqQueue = useRef(0), reqApproved = useRef(0);

  const loadCounts = useCallback(async () => {
    const r = await fetchDashboardCounts();
    setCounts(r.counts); setCountsFailed(!r.counts);
  }, []);
  const loadQueue = useCallback(async () => {
    const mine = ++reqQueue.current;
    setQueueLoading(true);
    const r = await fetchQueuePage(queuePage);
    if (mine !== reqQueue.current) return;
    setQueueLoading(false);
    if (r.paged && r.rows.length === 0 && r.total > 0 && queuePage > 1) { setQueuePage(pageCount(r.total, DASHBOARD_PAGE_SIZE)); return; }      // fewer pages now: go to the last one
    setQueue(r);
  }, [queuePage]);
  const loadApproved = useCallback(async () => {
    const mine = ++reqApproved.current;
    setApprovedLoading(true);
    const r = await fetchApprovedPage(approvedSearch, approvedPage);
    if (mine !== reqApproved.current) return;
    setApprovedLoading(false);
    if (r.paged && r.rows.length === 0 && r.total > 0 && approvedPage > 1) { setApprovedPage(pageCount(r.total, DASHBOARD_PAGE_SIZE)); return; }
    setApproved(r);
  }, [approvedSearch, approvedPage]);
  const loadOthers = useCallback(async () => {
    const [fd, rf] = await Promise.all([fetchFinalDecisions(), fetchConsultRemovalForms()]);
    setFinals(fd); setForms(rf);
  }, []);

  useEffect(() => { void loadCounts(); void loadOthers(); }, [loadCounts, loadOthers]);
  useEffect(() => { void loadQueue(); }, [loadQueue]);
  useEffect(() => { void loadApproved(); }, [loadApproved]);

  // the search of the approved referrals waits until the person stops typing (300 ms), then starts again from page 1
  useEffect(() => {
    if (typed === approvedSearch) return;
    const t = window.setTimeout(() => { setApprovedSearch(typed); setApprovedPage(1); }, 300);
    return () => window.clearTimeout(t);
  }, [typed, approvedSearch]);

  const reloadAll = () => { void loadCounts(); void loadQueue(); void loadApproved(); void loadOthers(); };

  async function handlePrint(r: QueuedReferral, e: React.MouseEvent) {
    e.stopPropagation();
    if (printingId) return;
    setPrintingId(r.id);
    try { await printApprovedReferral(r); } finally { setPrintingId(null); }
  }

  async function proceed(item: FinalDecisionItem) {
    const what = item.decisionLabel === "Removed" ? "The scholar will be marked Removed" + (item.recordId ? " and the login will be switched off." : ".") : `The scholar's scholarship status will become ${item.decisionLabel}.`;
    if (!window.confirm(`Proceed with the final decision for ${item.name}?\n\n${what}\n\nThe Division Head has approved and signed it. This is the last step before the scholarship status changes.`)) return;
    setFinalBusy(item.referralId); setFinalError("");
    const r = await finalizeDecision(item.referralId);
    setFinalBusy(null);
    if (!r.ok) { setFinalError(r.error || "The final decision could not be made."); return; }
    reloadAll();
  }

  async function downloadForm(id: string) {
    setFormBusy(id); setFormError("");
    const r = await downloadRemovalForm(id);
    setFormBusy(null);
    if (!r.ok) setFormError(r.error);
  }

  const today = manilaToday();
  const open = (kind: DashboardKind) => {
    const t = dashboardTarget(kind, today, counts?.me ?? null);
    return t && onOpenTarget ? () => onOpenTarget(t) : undefined;
  };
  const c = counts, num = (v: number | undefined) => (c ? v ?? 0 : null);
  const scrollToQueue = () => queueRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  const queueSkeleton = queueLoading && queue.rows.length === 0, approvedSkeleton = approvedLoading && approved.rows.length === 0;
  const Skel = () => (
    <div className="space-y-0" aria-hidden="true">
      {Array.from({ length: 3 }, (_, i) => <div key={i} className="border-t border-[#f0f3f8] px-4 py-3 first:border-t-0"><div className="h-4 w-48 animate-pulse rounded bg-slate-200" /><div className="mt-2 h-3.5 w-72 animate-pulse rounded bg-slate-200" /></div>)}
    </div>
  );

  return (
    <div>
      {countsFailed && <p role="alert" className="mb-3 text-[13.5px] text-red-700">The numbers could not be loaded. <button type="button" onClick={() => void loadCounts()} className="font-semibold text-[#00709f] hover:underline">Try again</button></p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <SummaryCard icon={<Home size={14} />} title="KSB Client / Home Visited" note="All visits of that type. Press a number to see them in Daily Records.">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="KSB Client" value={num(c?.ksbClientCount)} onOpen={open("ksb")} hint="Open these visits in Daily Records" />
            <Stat label="Home Visited" value={num(c?.homeVisitedCount)} onOpen={open("home")} hint="Open these visits in Daily Records" />
          </div>
        </SummaryCard>

        <SummaryCard icon={<Users size={14} />} title="Scholarship Status" note="Scholars with this status now. Press Probationary to see them.">
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <Stat label="Probationary" value={num(c?.probationaryCount)} onOpen={open("probationary")} hint="Open the Probationary Monitoring tab" />
            <Stat label="On Leave" value={num(c?.onLeaveCount)} />
            <Stat label="Reconsidered" value={num(c?.reconsideredCount)} />
            <Stat label="Removed" value={num(c?.removedCount)} />
          </div>
        </SummaryCard>

        <SummaryCard icon={<Clock size={14} />} title="Referral Queue" note="Your own queue. Press a number to go to the list below.">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Pending" value={num(c?.pendingCount)} onOpen={scrollToQueue} hint="Go to Scholars to be Consulted" />
            <Stat label="For Reconsideration" value={num(c?.reconsiderationCount)} onOpen={scrollToQueue} hint="Go to Scholars to be Consulted" />
          </div>
        </SummaryCard>

        <SummaryCard icon={<CalendarDays size={14} />} title={c?.monthLabel || "This Month"} note="Your visits from the 1st of the month to today. Press the number to see them in Daily Records.">
          <Stat label="Clients Served" value={num(c?.clientsServedThisMonth)} onOpen={open("served")} hint="Open your visits this month in Daily Records" />
        </SummaryCard>
      </div>

      {finals.length > 0 && (
        <div className="bg-white rounded-2xl border-2 border-green-300 overflow-hidden mb-4" aria-label="Waiting for your final decision">
          <div className="px-4 py-3 border-b border-green-200 bg-green-50 flex items-center gap-2">
            <CheckCircle2 size={14} className="text-green-700" />
            <p className="text-[13px] font-bold text-green-950">Waiting for your final decision ({finals.length})</p>
          </div>
          <p className="px-4 pt-2 text-[12.5px] text-slate-600">The Division Head approved and signed these. You consulted these scholars, so the final decision is yours: the scholarship status changes only when you proceed.</p>
          {finalError && <p role="alert" className="px-4 pt-2 text-[13px] text-red-700">{finalError}</p>}
          <div>
            {finals.map(item => (
              <div key={item.referralId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-[#f0f3f8] first:border-t-0">
                <div>
                  <p className="text-[13.5px] font-semibold text-[#062444]">{item.name}</p>
                  <p className="text-[12px] text-slate-500">{item.course} · {item.yearLevel} · {item.school}</p>
                  <p className="text-[12.5px] text-slate-800 mt-0.5">Approved by the Division Head: <strong>{item.decisionLabel}</strong>{item.termLabel ? ` · renewal for ${item.termLabel}` : ""}{item.signedBy ? ` · signed by ${item.signedBy}` : ""}</p>
                </div>
                <button type="button" onClick={() => void proceed(item)} disabled={finalBusy === item.referralId}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-green-800 px-4 py-2 text-[13px] font-bold text-white hover:bg-green-900 disabled:opacity-60">
                  <CheckCircle2 size={14} /> {finalBusy === item.referralId ? "Working…" : "Proceed with the final decision"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {forms.length > 0 && (
        <button type="button" onClick={() => setFormsOpen(true)} aria-label="Open the list of scholarship termination forms"
          className="mb-4 flex w-full flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-red-300 bg-red-50 px-4 py-3 text-left hover:bg-red-100">
          <span>
            <span className="block text-[13px] font-bold text-red-950">Scholarship termination forms ({forms.length})</span>
            <span className="block text-[12.5px] text-slate-700">{forms.filter(f => f.state !== "waiting").length} ready to download · {forms.filter(f => f.state === "waiting").length} waiting for the Division Head. Open the list.</span>
          </span>
          <Printer size={16} className="text-red-900" aria-hidden="true" />
        </button>
      )}
      {formsOpen && <TerminationFormsModal items={forms} busyId={formBusy} error={formError} onDownload={id => void downloadForm(id)} onClose={() => setFormsOpen(false)} />}

      <div ref={queueRef} className="bg-white rounded-2xl border border-[#e6ecf5] overflow-hidden scroll-mt-4">
        <div className="px-4 py-3 border-b border-[#f0f3f8] flex items-center gap-2">
          <AlertTriangle size={14} className="text-[#0088cc]" />
          <p className="text-[13px] font-bold text-[#062444]">Scholars to be Consulted{queue.total > 0 ? ` (${queue.total.toLocaleString("en-US")})` : ""}</p>
        </div>
        {queueSkeleton ? <Skel /> : queue.rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-slate-400 text-sm">No scholars are currently queued for consultation.</p>
        ) : (
          <div className={queueLoading ? "opacity-60" : ""}>
            {queue.rows.map((r, i) => {
              const first = (queuePage - 1) * DASHBOARD_PAGE_SIZE + i === 0;      // only the oldest in the whole queue can be taken
              return (
                <button key={r.id} type="button" disabled={!first} onClick={() => setWorking(r)}
                  className={`w-full flex items-center justify-between gap-3 px-4 py-3 border-t border-[#f0f3f8] text-left first:border-t-0 ${
                    first ? "hover:bg-[#f8fafd] cursor-pointer" : "opacity-50 cursor-not-allowed"
                  }`}>
                  <div>
                    <p className="text-[13.5px] font-semibold text-[#062444]">{r.name}</p>
                    <p className="text-[12px] text-slate-500">{r.course} · {r.yearLevel} · {r.school}</p>
                    {r.status === "reconsideration_requested" && (
                      <p className="text-[11.5px] font-semibold text-amber-600 mt-0.5">Sent back for reconsideration</p>
                    )}
                  </div>
                  {first && <ChevronRight size={16} className="text-[#0088cc] shrink-0" />}
                </button>
              );
            })}
          </div>
        )}
        {queue.paged && queue.total > DASHBOARD_PAGE_SIZE && <div className="border-t border-[#f0f3f8] px-4"><ServerPagination page={queuePage} pageSize={DASHBOARD_PAGE_SIZE} total={queue.total} onPageChange={p => setQueuePage(Math.max(1, p))} noun="scholars" disabled={queueLoading} /></div>}
      </div>

      <div className="bg-white rounded-2xl border border-[#e6ecf5] overflow-hidden mt-4">
        <div className="px-4 py-3 border-b border-[#f0f3f8] flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <CheckCircle2 size={14} className="text-[#0088cc]" />
            <p className="text-[13px] font-bold text-[#062444]">Approved Referrals{approved.total > 0 ? ` (${approved.total.toLocaleString("en-US")})` : ""}</p>
          </span>
          {(approved.total > 0 || approvedSearch !== "" || typed !== "") && approved.paged && (
            <span className="relative w-full max-w-[16rem]">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-600" aria-hidden="true" />
              <input value={typed} onChange={e => setTyped(e.target.value)} placeholder="Search by name or Scholar ID…" aria-label="Search the approved referrals"
                className="w-full rounded-lg border border-[#e6ecf5] bg-white py-1.5 pl-8 pr-2 text-[13px] outline-none focus:border-[#062444]" />
            </span>
          )}
        </div>
        {approvedSkeleton ? <Skel /> : approved.rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-slate-400 text-sm">{approvedSearch !== "" ? "No approved referral matches this search." : "No approved referrals yet."}</p>
        ) : (
          <div className={approvedLoading ? "opacity-60" : ""}>
            {approved.rows.map(r => (
              <div key={r.id} role="button" tabIndex={0} onClick={() => setViewing(r)}
                onKeyDown={e => { if (e.key === "Enter") setViewing(r); }}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 border-t border-[#f0f3f8] text-left first:border-t-0 hover:bg-[#f8fafd] cursor-pointer">
                <div>
                  <p className="text-[13.5px] font-semibold text-[#062444]">{r.name}</p>
                  <p className="text-[12px] text-slate-500">{r.course} · {r.yearLevel} · {r.school}</p>
                </div>
                <button type="button" onClick={e => handlePrint(r, e)} disabled={printingId === r.id}
                  className="flex items-center gap-1.5 rounded-lg border border-[#062444]/15 text-[#062444] text-[12px] font-semibold px-3 py-1.5 hover:bg-white disabled:opacity-60 shrink-0">
                  <Printer size={12} className="text-[#0088cc]" /> {printingId === r.id ? "Preparing…" : "Print"}
                </button>
              </div>
            ))}
          </div>
        )}
        {approved.paged && approved.total > DASHBOARD_PAGE_SIZE && <div className="border-t border-[#f0f3f8] px-4"><ServerPagination page={approvedPage} pageSize={DASHBOARD_PAGE_SIZE} total={approved.total} onPageChange={p => setApprovedPage(Math.max(1, p))} noun="referrals" disabled={approvedLoading} /></div>}
      </div>

      {working && (
        <ReferralFormModal mode="counsel" referralId={working.id}
          onClose={() => setWorking(null)}
          onDone={() => { setWorking(null); reloadAll(); }} />
      )}
      {viewing && (
        <ReferralFormModal mode="view" referralId={viewing.id}
          onClose={() => setViewing(null)}
          onDone={() => setViewing(null)} />
      )}
    </div>
  );
}
