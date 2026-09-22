import { useState } from "react";
import { ClipboardList, AlertTriangle, LayoutDashboard } from "lucide-react";
import { ScholarCounselingTab } from "./pages/ScholarCounselingTab";
import { ProbationMonitoringTab } from "./pages/ProbationMonitoringTab";
import { ScholarCounselingDashboardTab } from "./pages/ScholarCounselingDashboardTab";

type ScholarCounselingSubtab = "main-dashboard" | "daily-records" | "probation-monitoring";

/**
 * Gated by the "scholar_counseling" tag (src/app/staffToolTags.ts),
 * granted from it.admin1's Staff Accounts page. Monitors scholars'
 * scholarship status via a counseling-visit log; changing a scholar's
 * status is a separate, later addition. Keeps the same tab-bar shell as
 * ScholarManagementToolsPage.tsx so more subtabs can be added later
 * without restructuring.
 */
export function ScholarCounselingToolPage() {
  const TABS: { key: ScholarCounselingSubtab; label: string; icon: React.ReactNode }[] = [
    { key: "main-dashboard", label: "Main Dashboard", icon: <LayoutDashboard size={14} /> },
    { key: "daily-records", label: "Daily Records", icon: <ClipboardList size={14} /> },
    { key: "probation-monitoring", label: "Probationary Monitoring", icon: <AlertTriangle size={14} /> },
  ];
  const [tab, setTab] = useState<ScholarCounselingSubtab>("main-dashboard");

  return (
    <div>
      <h1 className="text-xl font-bold text-foreground mb-1">Scholar Consultation Tool</h1>
      <p className="text-sm text-muted-foreground mb-5">Monitor scholars' scholarship status and log consultation visits.</p>

      <div className="flex w-full gap-1 border-b border-border mb-5">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-[13.5px] font-bold border-b-2 transition-colors ${
              tab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === "main-dashboard" && <ScholarCounselingDashboardTab />}
      {tab === "daily-records" && <ScholarCounselingTab />}
      {tab === "probation-monitoring" && <ProbationMonitoringTab />}
    </div>
  );
}
