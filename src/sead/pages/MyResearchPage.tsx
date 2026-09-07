import { ClipboardList, FolderCheck } from "lucide-react";
import { MyProposalsSubtab } from "./myresearch/MyProposalsSubtab";
import { MyApprovedProjectsSubtab } from "./myresearch/MyApprovedProjectsSubtab";
import { useUrlState } from "@/app/useUrlState";

type MyResearchTab = "proposals" | "approved";

/**
 * Embedded in the main staff app (src/app/App.tsx) as "My Research" —
 * visible to every staff account EXCEPT evaluators (the
 * "research_project_monitoring" tag), who review submissions from the
 * separate Research Project Monitoring tool instead. See the approved
 * Phase D plan for the full research proposal workflow this is part of.
 */
export function MyResearchPage() {
  const TABS: { key: MyResearchTab; label: string; icon: React.ReactNode }[] = [
    { key: "proposals", label: "My Proposals", icon: <ClipboardList size={14} /> },
    { key: "approved", label: "My Approved Projects", icon: <FolderCheck size={14} /> },
  ];
  const [tab, setTab] = useUrlState<MyResearchTab>("myResearchTab", "proposals", TABS.map(t => t.key));

  return (
    <div>
      <h1 className="text-xl font-bold text-foreground mb-1">My Research</h1>
      <p className="text-sm text-muted-foreground mb-5">Submit research project proposals and track them through review.</p>

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

      {tab === "proposals" && <MyProposalsSubtab />}
      {tab === "approved" && <MyApprovedProjectsSubtab />}
    </div>
  );
}
