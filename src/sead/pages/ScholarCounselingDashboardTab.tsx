import { useEffect, useState } from "react";
import { Users, Home, AlertTriangle, Clock, CalendarDays, ChevronRight, CheckCircle2, Printer } from "lucide-react";
import { fetchDashboardSummary, fetchReferralQueue, fetchApprovedReferrals, fetchFinalDecisions, finalizeDecision, type DashboardSummary, type FinalDecisionItem, type QueuedReferral } from "../referralApi";
import { ReferralFormModal } from "../components/ReferralFormModal";
import { printApprovedReferral } from "../referralPrint";

function SummaryCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-[#e6ecf5] p-4">
      <div className="flex items-center gap-2 mb-3 text-[#0088cc]">{icon}<p className="text-[11px] font-bold uppercase tracking-wide">{title}</p></div>
      {children}
    </div>
  );
}
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-2xl font-bold text-[#062444]">{value}</p>
      <p className="text-[11.5px] text-slate-500">{label}</p>
    </div>
  );
}

/**
 * "Main Dashboard" — the Scholar Counseling Tool's landing subtab: a
 * summary of office-wide monitoring counts plus the signed-in staff
 * member's own personal referral queue (Pending / Reconsideration counts,
 * clients served this month, and the actual list of scholars to counsel —
 * oldest first, only the first entry actionable).
 */
export function ScholarCounselingDashboardTab() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [queue, setQueue] = useState<QueuedReferral[]>([]);
  const [approved, setApproved] = useState<QueuedReferral[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<QueuedReferral | null>(null);
  const [viewing, setViewing] = useState<QueuedReferral | null>(null);
  const [printingId, setPrintingId] = useState<string | null>(null);
  // cases the Division Head approved and signed: the consulting staff member who consulted the scholar makes the final decision
  const [finals, setFinals] = useState<FinalDecisionItem[]>([]);
  const [finalBusy, setFinalBusy] = useState<string | null>(null);
  const [finalError, setFinalError] = useState("");

  async function load() {
    setLoading(true);
    const [s, q, a, fd] = await Promise.all([fetchDashboardSummary(), fetchReferralQueue(), fetchApprovedReferrals(), fetchFinalDecisions()]);
    setFinals(fd);
    setSummary(s);
    setQueue(q);
    setApproved(a);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

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
    await load();
  }

  if (loading) return <p className="text-center text-slate-400 py-10">Loading…</p>;

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <SummaryCard icon={<Home size={14} />} title="KSB Client / Home Visited">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="KSB Client" value={summary?.ksbClientCount ?? 0} />
            <Stat label="Home Visited" value={summary?.homeVisitedCount ?? 0} />
          </div>
        </SummaryCard>

        <SummaryCard icon={<Users size={14} />} title="Scholarship Status">
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <Stat label="Probationary" value={summary?.probationaryCount ?? 0} />
            <Stat label="On Leave" value={summary?.onLeaveCount ?? 0} />
            <Stat label="Reconsidered" value={summary?.reconsideredCount ?? 0} />
            <Stat label="Removed" value={summary?.removedCount ?? 0} />
          </div>
        </SummaryCard>

        <SummaryCard icon={<Clock size={14} />} title="Referral Queue">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Pending" value={summary?.pendingCount ?? 0} />
            <Stat label="For Reconsideration" value={summary?.reconsiderationCount ?? 0} />
          </div>
        </SummaryCard>

        <SummaryCard icon={<CalendarDays size={14} />} title={summary?.monthLabel || "This Month"}>
          <Stat label="Clients Served" value={summary?.clientsServedThisMonth ?? 0} />
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

      <div className="bg-white rounded-2xl border border-[#e6ecf5] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#f0f3f8] flex items-center gap-2">
          <AlertTriangle size={14} className="text-[#0088cc]" />
          <p className="text-[13px] font-bold text-[#062444]">Scholars to be Consulted</p>
        </div>
        {queue.length === 0 ? (
          <p className="px-4 py-8 text-center text-slate-400 text-sm">No scholars are currently queued for consultation.</p>
        ) : (
          <div>
            {queue.map((r, i) => (
              <button key={r.id} type="button" disabled={i !== 0} onClick={() => setWorking(r)}
                className={`w-full flex items-center justify-between gap-3 px-4 py-3 border-t border-[#f0f3f8] text-left first:border-t-0 ${
                  i === 0 ? "hover:bg-[#f8fafd] cursor-pointer" : "opacity-50 cursor-not-allowed"
                }`}>
                <div>
                  <p className="text-[13.5px] font-semibold text-[#062444]">{r.name}</p>
                  <p className="text-[12px] text-slate-500">{r.course} · {r.yearLevel} · {r.school}</p>
                  {r.status === "reconsideration_requested" && (
                    <p className="text-[11.5px] font-semibold text-amber-600 mt-0.5">Sent back for reconsideration</p>
                  )}
                </div>
                {i === 0 && <ChevronRight size={16} className="text-[#0088cc] shrink-0" />}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-[#e6ecf5] overflow-hidden mt-4">
        <div className="px-4 py-3 border-b border-[#f0f3f8] flex items-center gap-2">
          <CheckCircle2 size={14} className="text-[#0088cc]" />
          <p className="text-[13px] font-bold text-[#062444]">Approved Referrals</p>
        </div>
        {approved.length === 0 ? (
          <p className="px-4 py-8 text-center text-slate-400 text-sm">No approved referrals yet.</p>
        ) : (
          <div>
            {approved.map(r => (
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
      </div>

      {working && (
        <ReferralFormModal mode="counsel" referralId={working.id}
          onClose={() => setWorking(null)}
          onDone={() => { setWorking(null); load(); }} />
      )}
      {viewing && (
        <ReferralFormModal mode="view" referralId={viewing.id}
          onClose={() => setViewing(null)}
          onDone={() => setViewing(null)} />
      )}
    </div>
  );
}
