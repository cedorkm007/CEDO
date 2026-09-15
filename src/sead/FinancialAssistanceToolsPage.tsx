import { FinancialAssistanceTab } from "./pages/FinancialAssistanceTab";

/**
 * Own top-level page, gated by the "financial_assistance" tag — mirrors
 * ScholarManagementToolsPage.tsx's own thin-wrapper shape, minus an inner
 * tab bar since there's only one piece of content here (Periods/
 * Applicants/QR/Bulk Import). Deliberately separate from Scholarship
 * Program Information's own "Financial Assistance" tab, which is a
 * read-only summary for scholarship_program_info-tagged staff — this page
 * is the actual management surface, for the financial_assistance tag.
 */
export function FinancialAssistanceToolsPage() {
  return (
    <div>
      <h1 className="text-xl font-bold text-foreground mb-1">Financial Assistance Tools</h1>
      <p className="text-sm text-muted-foreground mb-5">Register, monitor, and manage Financial Assistance applicants per academic period.</p>
      <FinancialAssistanceTab />
    </div>
  );
}
