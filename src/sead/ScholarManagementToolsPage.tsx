import { useState } from "react";
import { Users, BookOpen, BarChart3, History, CalendarDays, FileText } from "lucide-react";
import { ScholarsTab } from "./pages/ScholarsTab";
import { QuestionBankTab } from "./pages/QuestionBankTab";
import { ScholarAccountHistoryTab } from "./pages/ScholarAccountHistoryTab";
import { QuestsMonitoringTab } from "./pages/QuestsMonitoringTab";
import { FormationActivitiesTab } from "./pages/FormationActivitiesTab";
import { FormsManagementTab } from "./pages/FormsManagementTab";
import type { SeadTab } from "./types";

/**
 * Embedded directly in the main staff app (src/app/App.tsx) as the
 * "Scholar Management Tools" page — not a separate site/login. Visibility
 * is gated in App.tsx to a set of accounts (SCHOLAR_MANAGEMENT_USERNAMES);
 * the underlying database writes are separately enforced by the
 * is_sead_staff flag + RLS policies (supabase_migration_sead_staff.sql),
 * so the real security boundary doesn't depend on this UI gate alone.
 *
 * `tags` is the signed-in staff account's tool tags (see
 * src/app/staffToolTags.ts) — used here only to further gate the Forms
 * Management sub-tab, which needs its own "forms_management" tag on top
 * of whatever already got the account into this page.
 */
export function ScholarManagementToolsPage({ tags }: { tags: string[] }) {
  const [tab, setTab] = useState<SeadTab>("scholars");

  const TABS: { key: SeadTab; label: string; icon: React.ReactNode }[] = [
    { key: "scholars", label: "Scholars", icon: <Users size={14} /> },
    { key: "question-bank", label: "Question Bank", icon: <BookOpen size={14} /> },
    { key: "quests-monitoring", label: "Quests Monitoring", icon: <BarChart3 size={14} /> },
    { key: "formation-activities", label: "Formation Activities", icon: <CalendarDays size={14} /> },
    { key: "history", label: "Account History", icon: <History size={14} /> },
  ];
  if (tags.includes("forms_management")) {
    TABS.push({ key: "forms-management", label: "Forms Management", icon: <FileText size={14} /> });
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-foreground mb-1">Scholar Management Tools</h1>
      <p className="text-sm text-muted-foreground mb-5">Manage scholar accounts and the Quests question bank.</p>

      <div className="flex gap-1 overflow-x-auto border-b border-border mb-5">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`shrink-0 flex items-center gap-2 px-4 py-2.5 text-[13.5px] font-bold border-b-2 transition-colors ${
              tab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === "scholars" && <ScholarsTab />}
      {tab === "question-bank" && <QuestionBankTab />}
      {tab === "quests-monitoring" && <QuestsMonitoringTab />}
      {tab === "formation-activities" && <FormationActivitiesTab />}
      {tab === "history" && <ScholarAccountHistoryTab />}
      {tab === "forms-management" && tags.includes("forms_management") && <FormsManagementTab />}
    </div>
  );
}
