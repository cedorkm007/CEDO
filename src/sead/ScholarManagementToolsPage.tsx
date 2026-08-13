import { useState } from "react";
import { Users, BookOpen, BarChart3, History, Trophy } from "lucide-react";
import { ScholarsTab } from "./pages/ScholarsTab";
import { QuestionBankTab } from "./pages/QuestionBankTab";
import { ScoresTab } from "./pages/ScoresTab";
import { ScholarAccountHistoryTab } from "./pages/ScholarAccountHistoryTab";
import { RankingsTab } from "./pages/RankingsTab";
import type { SeadTab } from "./types";

/**
 * Embedded directly in the main staff app (src/app/App.tsx) as the
 * "Scholar Management Tools" page — not a separate site/login. Visibility
 * is gated in App.tsx to a set of accounts (SCHOLAR_MANAGEMENT_USERNAMES);
 * the underlying database writes are separately enforced by the
 * is_sead_staff flag + RLS policies (supabase_migration_sead_staff.sql),
 * so the real security boundary doesn't depend on this UI gate alone.
 */
export function ScholarManagementToolsPage() {
  const [tab, setTab] = useState<SeadTab>("scholars");

  const TABS: { key: SeadTab; label: string; icon: React.ReactNode }[] = [
    { key: "scholars", label: "Scholars", icon: <Users size={14} /> },
    { key: "question-bank", label: "Question Bank", icon: <BookOpen size={14} /> },
    { key: "scores", label: "Scores & Progress", icon: <BarChart3 size={14} /> },
    { key: "rankings", label: "Rankings", icon: <Trophy size={14} /> },
    { key: "history", label: "Account History", icon: <History size={14} /> },
  ];

  return (
    <div>
      <h1 className="text-xl font-bold text-foreground mb-1">Scholar Management Tools</h1>
      <p className="text-sm text-muted-foreground mb-5">Manage scholar accounts and the Quests question bank.</p>

      <div className="flex gap-1 border-b border-border mb-5">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-[13.5px] font-bold border-b-2 transition-colors ${
              tab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === "scholars" && <ScholarsTab />}
      {tab === "question-bank" && <QuestionBankTab />}
      {tab === "scores" && <ScoresTab />}
      {tab === "rankings" && <RankingsTab />}
      {tab === "history" && <ScholarAccountHistoryTab />}
    </div>
  );
}
