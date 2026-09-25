import { useState } from "react";
import { Users, Building2 } from "lucide-react";
import { StaffAccountsPage } from "./StaffAccountsPage";
import { SchoolAccountsPage } from "./SchoolAccountsPage";

type AccountsSubtab = "staff" | "schools";

/**
 * Embedded in the main staff app (src/app/App.tsx) as "Staff Accounts" —
 * visible only to it.admin1. Two subtabs: the original Staff Accounts
 * content, and a new School Accounts subtab for creating logins schools
 * use at /school (src/school/) to manage their own grading.
 */
export function AccountsPage() {
  const TABS: { key: AccountsSubtab; label: string; icon: React.ReactNode }[] = [
    { key: "staff", label: "Staff Accounts", icon: <Users size={14} /> },
    { key: "schools", label: "School Accounts", icon: <Building2 size={14} /> },
  ];
  const [tab, setTab] = useState<AccountsSubtab>("staff");

  return (
    <div>
      <h1 className="text-xl font-bold text-foreground mb-1">Accounts</h1>
      <p className="text-sm text-muted-foreground mb-5">Create staff and school logins. Self-registration is retired — this is the only way new accounts get made.</p>

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

      {tab === "staff" && <StaffAccountsPage />}
      {tab === "schools" && <SchoolAccountsPage />}
    </div>
  );
}
