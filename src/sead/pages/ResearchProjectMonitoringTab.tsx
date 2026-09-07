import { LayoutDashboard, ClipboardList, BarChart3 } from "lucide-react";
import { MonitoringSubtab } from "./research/MonitoringSubtab";
import { SurveyToolsSubtab } from "./research/SurveyToolsSubtab";
import { SurveyResultsSubtab } from "./research/SurveyResultsSubtab";
import { useUrlState } from "@/app/useUrlState";

type ResearchTab = "monitoring" | "survey-tools" | "survey-results";

/**
 * Embedded in the main staff app (src/app/App.tsx) as "Research Project
 * Monitoring" — gated by the "research_project_monitoring" tag (see
 * src/app/staffToolTags.ts), same pattern as every other staff tool tab.
 *
 * Monitoring is a UI-only shell for now (no research_projects backend
 * yet, per the approved plan's Phase A scope). Survey Tools and Survey
 * Results are full-stack, landing in Phase B.
 */
export function ResearchProjectMonitoringTab() {
  const TABS: { key: ResearchTab; label: string; icon: React.ReactNode }[] = [
    { key: "monitoring", label: "Monitoring", icon: <LayoutDashboard size={14} /> },
    { key: "survey-tools", label: "Survey Tools", icon: <ClipboardList size={14} /> },
    { key: "survey-results", label: "Survey Results", icon: <BarChart3 size={14} /> },
  ];
  // "rpmTab" namespaces this container's URL param apart from the other
  // staff-app containers' own (smtTab, etc.) — see useUrlState's doc comment.
  const [tab, setTab] = useUrlState<ResearchTab>("rpmTab", "monitoring", TABS.map(t => t.key));

  return (
    <div>
      <h1 className="text-xl font-bold text-foreground mb-1">Research Project Monitoring</h1>
      <p className="text-sm text-muted-foreground mb-5">Track research projects and monitor survey results for SDP and Formation activities.</p>

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

      {tab === "monitoring" && <MonitoringSubtab />}
      {tab === "survey-tools" && <SurveyToolsSubtab />}
      {tab === "survey-results" && <SurveyResultsSubtab />}
    </div>
  );
}
