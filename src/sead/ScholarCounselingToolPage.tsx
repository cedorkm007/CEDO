import { useState } from "react";
import { LiveProvider } from "@/lib/liveUpdates";
import { ClipboardList, AlertTriangle, LayoutDashboard, CalendarClock, FileCheck2 } from "lucide-react";
import { ScholarCounselingTab } from "./pages/ScholarCounselingTab";
import { ProbationMonitoringTab } from "./pages/ProbationMonitoringTab";
import { ScholarCounselingDashboardTab } from "./pages/ScholarCounselingDashboardTab";
import { AppointmentsTab } from "./appointments/AppointmentsTab";
import { ScholarCounselingRenewalCasesTab } from "./pages/ScholarCounselingRenewalCasesTab";
import { KeepAlivePane, TAB_STALE_MS } from "@/lib/keepAlive";
import type { DashboardTarget } from "@/lib/dashboardLinks";

type ScholarCounselingSubtab = "main-dashboard" | "daily-records" | "probation-monitoring" | "appointments" | "renewal-cases";

/**
 * Gated by the "scholar_counseling" tag (src/app/staffToolTags.ts),
 * granted from it.admin1's Staff Accounts page. Monitors scholars'
 * scholarship status via a counseling-visit log; changing a scholar's
 * status is a separate, later addition. Keeps the same tab-bar shell as
 * ScholarManagementToolsPage.tsx so more subtabs can be added later
 * without restructuring.
 */
/** The Consultation Tool, kept up to date while it is open (bookings and referrals made by scholars show without refreshing: src/lib/liveUpdates.tsx). */
export function ScholarCounselingToolPage() {
  return <LiveProvider kind="staff"><ScholarCounselingToolPageInner /></LiveProvider>;
}

function ScholarCounselingToolPageInner() {
  const TABS: { key: ScholarCounselingSubtab; label: string; icon: React.ReactNode }[] = [
    { key: "main-dashboard", label: "Main Dashboard", icon: <LayoutDashboard size={14} /> },
    { key: "appointments", label: "Appointments", icon: <CalendarClock size={14} /> },
    { key: "renewal-cases", label: "Renewal Cases", icon: <FileCheck2 size={14} /> },
    { key: "daily-records", label: "Daily Records", icon: <ClipboardList size={14} /> },
    { key: "probation-monitoring", label: "Probationary Monitoring", icon: <AlertTriangle size={14} /> },
  ];
  const [tab, setTab] = useState<ScholarCounselingSubtab>("main-dashboard");
  // a number on the Main Dashboard opens the tab that lists what it counts: the tab's remembered page / filters are set first and the tab is started again so it reads them
  const [dailyKey, setDailyKey] = useState(0), [probationKey, setProbationKey] = useState(0);
  function openTarget(t: DashboardTarget) {
    try { window.sessionStorage.setItem(t.storageKey, t.value); } catch { /* private window: the tab then opens as it was */ }
    if (t.tab === "daily-records") setDailyKey(k => k + 1); else setProbationKey(k => k + 1);
    setTab(t.tab);
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-foreground mb-1">Scholar Consultation Tool</h1>
      <p className="text-sm text-muted-foreground mb-5">Monitor scholars' scholarship status and log consultation visits.</p>

      {/* every tab name stays on ONE line: the tabs share the width, and on a narrow screen the bar scrolls sideways instead of wrapping a name onto a second line */}
      <div className="flex w-full gap-1 overflow-x-auto border-b border-border mb-5" role="tablist" aria-label="Consultation Tool">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            role="tab" aria-selected={tab === t.key}
            className={`flex-1 shrink-0 whitespace-nowrap flex items-center justify-center gap-2 px-3 py-2.5 text-[13.5px] font-bold border-b-2 transition-colors ${
              tab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <KeepAlivePane active={tab === "main-dashboard"} staleAfterMs={TAB_STALE_MS}>{() => <ScholarCounselingDashboardTab onOpenTarget={openTarget} />}</KeepAlivePane>
      {/* these two follow the live updates, so they stay alive while another tab is open: coming back shows them at once and they read again only if something changed meanwhile */}
      <KeepAlivePane active={tab === "appointments"}>{() => <AppointmentsTab />}</KeepAlivePane>
      <KeepAlivePane active={tab === "renewal-cases"}>{() => <ScholarCounselingRenewalCasesTab />}</KeepAlivePane>
      <KeepAlivePane active={tab === "daily-records"} staleAfterMs={TAB_STALE_MS}>{() => <ScholarCounselingTab key={dailyKey} />}</KeepAlivePane>
      <KeepAlivePane active={tab === "probation-monitoring"} staleAfterMs={TAB_STALE_MS}>{() => <ProbationMonitoringTab key={probationKey} />}</KeepAlivePane>
    </div>
  );
}
