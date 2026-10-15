import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarClock, CalendarRange, ClipboardList, Clock, FileCheck2, Hourglass, ShieldCheck, UserX } from "lucide-react";
import { formatDay, termLabelOf, windowState } from "@/lib/renewal";
import { fetchRenewalWindows, type RenewalWindowRow } from "./renewalApi";
import { RenewalBoardTab } from "./renewal/RenewalBoardTab";
import { RenewalLateTab } from "./renewal/RenewalLateTab";
import { RenewalNotAppliedTab } from "./renewal/RenewalNotAppliedTab";
import { RenewalIncTab } from "./renewal/RenewalIncTab";
import { RenewalWindowsTab } from "./renewal/RenewalWindowsTab";
import { RenewalDetailView } from "./renewal/RenewalDetailView";
import { AppointmentsTab } from "./appointments/AppointmentsTab";
import { RenewalDivisionHeadTab } from "./renewal/RenewalDivisionHeadTab";
import { RenewalDashboardTab } from "./renewal/RenewalDashboardTab";
import { RenewalCertificateTab } from "./renewal/RenewalCertificateTab";

type Tab = "applications" | "late" | "notApplied" | "inc" | "calendar" | "windows" | "divisionHead" | "dashboard" | "certificate";

/**
 * "Scholar Renewal" — the evaluator's tool. Gated by the "scholar_renewal_evaluator" tag (src/app/staffToolTags.ts). The Division Head
 * (tag "sead_division_head") opens the same page and sees only the "Division Head" tab, where the cases wait for their decision.
 * Applications board by stage, Late and Not applied lists, INC compliance and "deadline passed — decision needed", renewal windows,
 * and a detail page per scholar. The rules are decided by the database; this page shows them and records the evaluator's decisions.
 * The IT admin (it.admin1) opens it only for the "Certificate" tab (the signatories of the Certificate of Scholarship Renewal).
 */
export function ScholarRenewalPage({ canAct = true, isEvaluator = true, isDivisionHead = false, isSeadHead = false, isItAdmin = false }: { canAct?: boolean; isEvaluator?: boolean; isDivisionHead?: boolean; isSeadHead?: boolean; isItAdmin?: boolean }) {
  const seesRenewals = isEvaluator || isDivisionHead || isSeadHead;   // a lone IT admin sees only the Certificate tab
  const [windows, setWindows] = useState<RenewalWindowRow[] | null>(null);
  const [error, setError] = useState("");
  const [windowId, setWindowId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(isEvaluator ? "applications" : isDivisionHead ? "divisionHead" : seesRenewals ? "dashboard" : "certificate");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadWindows = useCallback(async () => {
    if (!seesRenewals) return;
    const r = await fetchRenewalWindows();
    if (r.ok) { setWindows(r.rows); setError(""); } else setError(r.error);
  }, [seesRenewals]);
  useEffect(() => { void loadWindows(); }, [loadWindows]);

  // Default to a window that is open now, else the newest.
  const current = useMemo(() => {
    if (!windows || windows.length === 0) return null;
    const picked = windows.find(w => w.id === windowId);
    if (picked) return picked;
    return windows.find(w => windowState(w.opensOn, w.closesOn, w.lateAllowed) === "open") ?? windows[0];
  }, [windows, windowId]);

  const bump = useCallback(() => setRefreshKey(k => k + 1), []);

  const ALL_TABS: { key: Tab; label: string; icon: React.ReactNode; evaluatorOnly?: boolean }[] = [
    { key: "dashboard", label: "Dashboard", icon: <BarChart3 size={14} aria-hidden="true" /> },
    { key: "applications", label: "Applications", icon: <ClipboardList size={14} aria-hidden="true" />, evaluatorOnly: true },
    { key: "late", label: "Late", icon: <Clock size={14} aria-hidden="true" />, evaluatorOnly: true },
    { key: "notApplied", label: "Not applied", icon: <UserX size={14} aria-hidden="true" />, evaluatorOnly: true },
    { key: "inc", label: "INC", icon: <Hourglass size={14} aria-hidden="true" />, evaluatorOnly: true },
    { key: "calendar", label: "Consultations", icon: <CalendarClock size={14} aria-hidden="true" />, evaluatorOnly: true },
    { key: "divisionHead", label: "Division Head", icon: <ShieldCheck size={14} aria-hidden="true" /> },
    { key: "windows", label: "Windows", icon: <CalendarRange size={14} aria-hidden="true" />, evaluatorOnly: true },
    { key: "certificate", label: "Certificate", icon: <FileCheck2 size={14} aria-hidden="true" /> },
  ];
  // The heads of SEAD (neither evaluator nor Division Head) see only the Dashboard; the Division Head tab is for the Division Head and the evaluator.
  // The Certificate tab is for the evaluator and the IT admin; the Division Head and the heads of SEAD never see it.
  const TABS = ALL_TABS.filter(t => t.key === "certificate" ? (isEvaluator || isItAdmin)
    : seesRenewals && (isEvaluator || !t.evaluatorOnly) && (t.key !== "divisionHead" || isEvaluator || isDivisionHead));
  const termBarNeeded = tab !== "divisionHead" && tab !== "certificate";   // the dashboard and the lists work on the chosen term

  return (
    <div>
      <h1 className="text-xl font-bold text-foreground mb-1">Scholar Renewal</h1>
      <p className="text-sm text-slate-700 mb-4">{!seesRenewals ? "The signatories and the on/off switch of the Certificate of Scholarship Renewal." : isEvaluator ? "Review renewal applications, accept late ones, track INC subjects, send cases to the Division Head, and confirm every renewal." : isDivisionHead ? "The renewal cases that wait for your decision, and how each term is going." : "How each renewal term is going, and the Excel report."}</p>
      {error && <p role="alert" className="mb-3 text-[14px] text-red-700">Couldn't load the renewal windows: {error}</p>}

      {detailId ? (
        <RenewalDetailView recordId={detailId} canAct={canAct && isEvaluator} onBack={() => setDetailId(null)} onChanged={bump} />
      ) : (
        <>
          {termBarNeeded && <div className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-[#f7f9fc] border border-[#e6ecf5] rounded-xl px-4 py-3 mb-4 text-[14px]">
            <label className="font-bold text-[#062444]" htmlFor="renewal-term">Renewal term</label>
            {windows && windows.length > 0 ? (
              <select id="renewal-term" value={current?.id ?? ""} onChange={e => setWindowId(e.target.value)} className="rounded-lg border border-[#062444]/25 px-3 py-2 text-[14px] bg-white outline-none focus:border-[#062444]">
                {windows.map(w => <option key={w.id} value={w.id}>{termLabelOf(w.schoolYear, w.term)}</option>)}
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
          {tab === "divisionHead" && <RenewalDivisionHeadTab canDecide={isDivisionHead} onOpenRecord={setDetailId} onChanged={bump} refreshKey={refreshKey} />}
          {tab === "calendar" && <AppointmentsTab readOnly onOpenRecord={setDetailId} />}
          {tab === "dashboard" && current && <RenewalDashboardTab schoolYear={current.schoolYear} term={current.term} refreshKey={refreshKey} />}
          {tab === "windows" && <RenewalWindowsTab windows={windows ?? []} onChanged={async () => { await loadWindows(); bump(); }} />}
          {tab !== "windows" && tab !== "calendar" && tab !== "divisionHead" && tab !== "certificate" && !current && <p className="rounded-xl border border-dashed border-[#e6ecf5] px-4 py-8 text-center text-[14px] text-slate-700">Open a renewal window first (Windows tab).</p>}
          {tab !== "windows" && tab !== "calendar" && tab !== "divisionHead" && tab !== "certificate" && tab !== "dashboard" && current && (
            <>
              {tab === "applications" && <RenewalBoardTab schoolYear={current.schoolYear} term={current.term} onOpen={setDetailId} refreshKey={refreshKey} />}
              {tab === "late" && <RenewalLateTab schoolYear={current.schoolYear} term={current.term} onOpen={setDetailId} onChanged={bump} refreshKey={refreshKey} />}
              {tab === "notApplied" && <RenewalNotAppliedTab schoolYear={current.schoolYear} term={current.term} onChanged={bump} refreshKey={refreshKey} />}
              {tab === "inc" && <RenewalIncTab schoolYear={current.schoolYear} term={current.term} onOpen={setDetailId} onChanged={bump} refreshKey={refreshKey} />}
            </>
          )}
        </>
      )}
    </div>
  );
}
