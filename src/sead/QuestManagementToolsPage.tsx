import { BookOpen, BarChart3 } from "lucide-react";
import { QuestionBankTab } from "./pages/QuestionBankTab";
import { QuestsMonitoringTab } from "./pages/QuestsMonitoringTab";
import { useUrlState } from "@/app/useUrlState";
import type { SeadTab } from "./types";

/**
 * Embedded directly in the main staff app (src/app/App.tsx) as the
 * "Quest Management Tools" page — split out of Scholar Management Tools
 * so it can be gated by its own tag ("quest_management") and granted
 * independently from it.admin1's Staff Accounts page.
 */
export function QuestManagementToolsPage() {
  const TABS: { key: SeadTab; label: string; icon: React.ReactNode }[] = [
    { key: "question-bank", label: "Question Bank", icon: <BookOpen size={14} /> },
    { key: "quests-monitoring", label: "Quests Monitoring", icon: <BarChart3 size={14} /> },
  ];
  // "qmtTab" so it's namespaced apart from the other staff-app containers'
  // own URL params — see ScholarManagementToolsPage's "smtTab" for the
  // same reasoning.
  const [tab, setTab] = useUrlState<SeadTab>("qmtTab", "question-bank", TABS.map(t => t.key));
  return (
    <div>
      <h1 className="text-xl font-bold text-foreground mb-1">Quest Management Tools</h1>
      <p className="text-sm text-muted-foreground mb-5">Manage the Quests question bank and monitor scholar quiz scores.</p>

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

      {tab === "question-bank" && <QuestionBankTab />}
      {tab === "quests-monitoring" && <QuestsMonitoringTab />}
    </div>
  );
}
