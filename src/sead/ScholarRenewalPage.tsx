import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarClock, CalendarRange, CheckCheck, ClipboardCheck, ClipboardList, FileCheck2, FileText, Scale, ShieldCheck, Tag, UserX } from "lucide-react";
import { formatDay, termLabelOf, windowState } from "@/lib/renewal";
import { fetchRenewalWindows, type RenewalWindowRow } from "./renewalApi";
import { RenewalListTab } from "./renewal/RenewalListTab";
import { RenewalDocumentsTab } from "./renewal/RenewalDocumentsTab";
import { RenewalSdpReconsiderationTab } from "./renewal/RenewalSdpReconsiderationTab";
import { RenewalEnteredGradesTab } from "./renewal/RenewalEnteredGradesTab";
import { LiveProvider, useLiveReload } from "@/lib/liveUpdates";
import { RenewalWindowsTab } from "./renewal/RenewalWindowsTab";
import { RenewalDetailView } from "./renewal/RenewalDetailView";
import { AppointmentsTab } from "./appointments/AppointmentsTab";
import { RenewalDivisionHeadTab } from "./renewal/RenewalDivisionHeadTab";
import { RenewalDashboardTab } from "./renewal/RenewalDashboardTab";
import { RenewalCertificateTab } from "./renewal/RenewalCertificateTab";
import { RenewalTaggingTab } from "./renewal/RenewalTaggingTab";

type Tab = "applications" | "renewed" | "notApplied" | "sdpReconsideration" | "enteredGrades" | "documents" | "calendar" | "windows" | "divisionHead" | "dashboard" | "certificate" | "tagging";

/**
 * "Scholar Renewal" — the evaluator's tool. Gated by the "scholar_renewal_evaluator" tag (src/app/staffToolTags.ts). The Division Head
 * (tag "sead_division_head") opens the same page and sees only the "Division Head" tab, where the cases wait for their decision.
 * Three lists, each with sub-tabs by the scholar's grades (Applications and Not applied) or status (Renewed), whose Actions column shows what waits on staff (late applications and INC decisions
 * included); then the Dashboard, the approvers' tabs, the Consultations calendar, the Division Head tab, the renewal windows, and a detail page per scholar. The rules are decided by the database; this page shows them and records the evaluator's decisions.
 * The IT admin (it.admin1) opens it only for the "Certificate" tab (the signatories of the Certificate of Scholarship Renewal).
 */
type ScholarRenewalPageProps = { canAct?: boolean; isEvaluator?: boolean; isDivisionHead?: boolean; isSeadHead?: boolean; isItAdmin?: boolean; isSdpApprover?: boolean; isGradesApprover?: boolean; isDocumentsApprover?: boolean; isTagger?: boolean };

/** Scholar Renewal, kept up to date while it is open: when a scholar applies, a document is reviewed, a booking is made, the school uploads grades... every tab shows it without refreshing (src/lib/liveUpdates.tsx). */
export function ScholarRenewalPage(props: ScholarRenewalPageProps) {
  return <LiveProvider kind="staff"><ScholarRenewalPageInner {...props} /></LiveProvider>;
}

function ScholarRenewalPageInner({ canAct = true, isEvaluator = true, isDivisionHead = false, isSeadHead = false, isItAdmin = false, isSdpApprover = false, isGradesApprover = false, isDocumentsApprover = false, isTagger = false }: { canAct?: boolean; isEvaluator?: boolean; isDivisionHead?: boolean; isSeadHead?: boolean; isItAdmin?: boolean; isSdpApprover?: boolean; isGradesApprover?: boolean; isDocumentsApprover?: boolean; isTagger?: boolean }) {
  const seesRenewals = isEvaluator || isDivisionHead || isSeadHead;   // a lone IT admin sees only the Certificate tab
  const seesList = isEvaluator || isDivisionHead || isSdpApprover || isGradesApprover || isDocumentsApprover;      // the three lists: the evaluator and the people who act on them
  const viewer = useMemo(() => ({ evaluator: isEvaluator, gradesApprover: isGradesApprover, sdpApprover: isSdpApprover, documentsApprover: isDocumentsApprover, divisionHead: isDivisionHead }), [isEvaluator, isGradesApprover, isSdpApprover, isDocumentsApprover, isDivisionHead]);
  const [windows, setWindows] = useState<RenewalWindowRow[] | null>(null);
  const [error, setError] = useState("");
  const [windowId, setWindowId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(isEvaluator ? "applications" : isDivisionHead ? "divisionHead" : seesRenewals ? "dashboard" : isSdpApprover ? "sdpReconsideration" : isGradesApprover ? "enteredGrades" : isDocumentsApprover ? "documents" : isTagger ? "tagging" : "certificate");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadWindows = useCallback(async () => {
    if (!seesRenewals && !seesList) return;
    const r = await fetchRenewalWindows();
    if (r.ok) { setWindows(r.rows); setError(""); } else setError(r.error);
  }, [seesRenewals, seesList]);
  useEffect(() => { void loadWindows(); }, [loadWindows]);
  useLiveReload(loadWindows);

  // Default to a window that is open now, else the newest.
  const current = useMemo(() => {
    if (!windows || windows.length === 0) return null;
    const picked = windows.find(w => w.id === windowId);
    if (picked) return picked;
    return windows.find(w => windowState(w.opensOn, w.closesOn, w.lateAllowed) === "open") ?? windows[0];
  }, [windows, windowId]);

  const bump = useCallback(() => setRefreshKey(k => k + 1), []);

  const ALL_TABS: { key: Tab; label: string; icon: React.ReactNode; evaluatorOnly?: boolean }[] = [
    { key: "applications", label: "Applications", icon: <ClipboardList size={14} aria-hidden="true" /> },
    { key: "renewed", label: "Renewed", icon: <CheckCheck size={14} aria-hidden="true" /> },
    { key: "notApplied", label: "Not applied", icon: <UserX size={14} aria-hidden="true" /> },
    { key: "dashboard", label: "Dashboard", icon: <BarChart3 size={14} aria-hidden="true" /> },
    { key: "enteredGrades", label: "Entered grades", icon: <ClipboardCheck size={14} aria-hidden="true" />, evaluatorOnly: true },
    { key: "sdpReconsideration", label: "SDP Reconsideration", icon: <Scale size={14} aria-hidden="true" />, evaluatorOnly: true },
    { key: "documents", label: "Documents", icon: <FileText size={14} aria-hidden="true" />, evaluatorOnly: true },
    { key: "calendar", label: "Consultations", icon: <CalendarClock size={14} aria-hidden="true" />, evaluatorOnly: true },
    { key: "divisionHead", label: "Division Head", icon: <ShieldCheck size={14} aria-hidden="true" /> },
    { key: "windows", label: "Windows", icon: <CalendarRange size={14} aria-hidden="true" />, evaluatorOnly: true },
    { key: "certificate", label: "Certificate", icon: <FileCheck2 size={14} aria-hidden="true" /> },
    { key: "tagging", label: "Scholar tagging", icon: <Tag size={14} aria-hidden="true" /> },
  ];
  // The heads of SEAD (neither evaluator nor Division Head) see only the Dashboard; the Division Head tab is for the Division Head and the evaluator.
  // The Certificate tab is for the evaluator and the IT admin; the Division Head and the heads of SEAD never see it.
  // The SDP Reconsideration tab is for the evaluator (read-only) and for the people who decide (it.admin1 and the accounts he appoints).
  // The Scholar tagging tab is for the accounts that tag (it.admin1 and the accounts he appoints); the evaluator reads it. An account that only tags sees nothing else.
  const TABS = ALL_TABS.filter(t => t.key === "tagging" ? (isEvaluator || isTagger)
    : t.key === "certificate" ? (isEvaluator || isItAdmin)
    : (t.key === "applications" || t.key === "renewed" || t.key === "notApplied") ? seesList
    : t.key === "dashboard" ? (seesRenewals || isSdpApprover)        // the SDP Reconsideration Approver reads the numbers (not the Excel file)
    : t.key === "sdpReconsideration" ? (isEvaluator || isSdpApprover)
    : t.key === "enteredGrades" ? (isEvaluator || isGradesApprover)
    : t.key === "documents" ? (isEvaluator || isDocumentsApprover)
    : seesRenewals && (isEvaluator || !t.evaluatorOnly) && (t.key !== "divisionHead" || isEvaluator || isDivisionHead));
  const termBarNeeded = tab !== "divisionHead" && tab !== "certificate" && tab !== "sdpReconsideration" && tab !== "enteredGrades" && tab !== "documents" && tab !== "tagging";   // the dashboard and the lists work on the chosen term (the tagging tab has its own term choice)

  return (
    <div>
      <h1 className="text-xl font-bold text-foreground mb-1">Scholar Renewal</h1>
      <p className="text-sm text-slate-700 mb-4">{!seesRenewals ? (isSdpApprover ? "Requests from scholars who lack SDP credits and ask, with their renewal application, to be treated as complied." : isGradesApprover ? "Grades that scholars entered themselves during renewal, waiting for your approval." : isDocumentsApprover ? "The study plans, INC letters and clearances that scholars sent for their renewal, waiting for your approval." : isTagger && !isItAdmin ? "Tag scholars for automatic renewal: a tagged scholar who applies is renewed once their grades and SDP are approved." : "The signatories and the on/off switch of the Certificate of Scholarship Renewal.") : isEvaluator ? "Review renewal applications, accept late ones, track INC subjects, send cases to the Division Head, and confirm every renewal." : isDivisionHead ? "The renewal cases that wait for your decision, and how each term is going." : "How each renewal term is going, and the Excel report."}</p>
      {error && <p role="alert" className="mb-3 text-[14px] text-red-700">Couldn't load the renewal windows: {error}</p>}

      {detailId ? (
        <RenewalDetailView recordId={detailId} canAct={canAct && isEvaluator} canReviewDocuments={false} onBack={() => setDetailId(null)} onChanged={bump} />
      ) : (
        <>
          {termBarNeeded && <div className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-[#f7f9fc] border border-[#e6ecf5] rounded-xl px-4 py-3 mb-4 text-[14px]">
            <label className="font-bold text-[#062444]" htmlFor="renewal-term">Renewal term</label>
            {windows && windows.length > 0 ? (
              <select id="renewal-term" value={current?.id ?? ""} onChange={e => setWindowId(e.target.value)} className="rounded-lg border border-[#062444]/25 px-3 py-2 text-[14px] bg-white outline-none focus:border-[#062444]">
                {/* one entry per TERM: a term can have several windows (one per group of schools), and the lists below cover the whole term */}
                {windows.filter((w, i) => windows.findIndex(x => x.schoolYear === w.schoolYear && x.term === w.term) === i).map(w => <option key={w.id} value={w.id}>{termLabelOf(w.schoolYear, w.term)}</option>)}
              </select>
            ) : <span className="text-slate-700">No renewal window yet — open one in the Windows tab.</span>}
            {current && <span className="text-slate-700">{formatDay(current.opensOn)} to {formatDay(current.closesOn)}</span>}
          </div>}

          <div className="flex w-full gap-1 border-b border-border mb-5 overflow-x-auto">
            {TABS.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)} aria-current={tab === t.key ? "page" : undefined}
                className={`flex-1 min-w-[96px] flex items-center justify-center gap-1.5 px-2 sm:px-4 py-2.5 text-[14px] font-bold border-b-2 transition-colors ${tab === t.key ? "border-primary text-foreground" : "border-transparent text-slate-700 hover:text-foreground"}`}>
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          {tab === "certificate" && <RenewalCertificateTab />}
          {tab === "tagging" && <RenewalTaggingTab canManage={isTagger} refreshKey={refreshKey} onChanged={bump} />}
          {tab === "sdpReconsideration" && <RenewalSdpReconsiderationTab refreshKey={refreshKey} onChanged={bump} />}
          {tab === "enteredGrades" && <RenewalEnteredGradesTab refreshKey={refreshKey} onChanged={bump} />}
          {tab === "documents" && <RenewalDocumentsTab canApprove={false} refreshKey={refreshKey} onChanged={bump} />}
          {tab === "divisionHead" && <RenewalDivisionHeadTab canDecide={isDivisionHead} onOpenRecord={setDetailId} onChanged={bump} refreshKey={refreshKey} />}
          {tab === "calendar" && <AppointmentsTab readOnly onOpenRecord={setDetailId} />}
          {tab === "dashboard" && current && <RenewalDashboardTab schoolYear={current.schoolYear} term={current.term} refreshKey={refreshKey} canExport={seesRenewals} />}
          {tab === "windows" && <RenewalWindowsTab windows={windows ?? []} onChanged={async () => { await loadWindows(); bump(); }} />}
          {tab !== "windows" && tab !== "calendar" && tab !== "divisionHead" && tab !== "certificate" && tab !== "sdpReconsideration" && tab !== "enteredGrades" && tab !== "documents" && tab !== "tagging" && !current && <p className="rounded-xl border border-dashed border-[#e6ecf5] px-4 py-8 text-center text-[14px] text-slate-700">{isEvaluator ? "Open a renewal window first (Windows tab)." : "No renewal window has been opened yet."}</p>}
          {tab !== "windows" && tab !== "calendar" && tab !== "divisionHead" && tab !== "certificate" && tab !== "dashboard" && tab !== "sdpReconsideration" && tab !== "enteredGrades" && tab !== "documents" && current && (
            <>
              {tab === "applications" && <RenewalListTab tab="applications" schoolYear={current.schoolYear} term={current.term} refreshKey={refreshKey} viewer={viewer} onOpenRecord={setDetailId} onChanged={bump} onGoToDocuments={() => setTab("documents")} />}
              {tab === "renewed" && <RenewalListTab tab="renewed" schoolYear={current.schoolYear} term={current.term} refreshKey={refreshKey} viewer={viewer} onOpenRecord={setDetailId} onChanged={bump} onGoToDocuments={() => setTab("documents")} />}
              {tab === "notApplied" && <RenewalListTab tab="not_applied" schoolYear={current.schoolYear} term={current.term} refreshKey={refreshKey} viewer={viewer} onOpenRecord={setDetailId} onChanged={bump} onGoToDocuments={() => setTab("documents")} />}
            </>
          )}
        </>
      )}
    </div>
  );
}
