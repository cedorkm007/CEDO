import { useEffect, useState } from "react";
import { UserPlus, Building2, KeyRound, Trash2 } from "lucide-react";
import { usePaginatedList, ListSearchBox, ListPagination } from "@/app/components/PaginatedList";
import {
  fetchSchoolsList, createSchoolAccount, fetchSchoolAccountsList, deleteSchoolAccount, resetSchoolPassword,
  type SchoolOption, type SchoolAccountListItem,
} from "./schoolAccountsApi";

/**
 * "School Accounts" subtab of the it.admin1-only Accounts page — creates
 * logins for schools (src/school/, mounted at /school), which schools use
 * to configure their own grading system and enter scholars' grades. Same
 * pattern as Staff Accounts: a real Edge Function (it-create-school-account)
 * does the privileged work, not a client-side admin call.
 */
export function SchoolAccountsPage() {
  const [schools, setSchools] = useState<SchoolOption[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<SchoolAccountListItem[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [confirmAction, setConfirmAction] = useState<{ id: string; kind: "reset" | "delete" } | null>(null);
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  async function loadData() {
    setLoadingAccounts(true);
    const [schoolList, accountList] = await Promise.all([fetchSchoolsList(), fetchSchoolAccountsList()]);
    setSchools(schoolList);
    setAccounts(accountList);
    setLoadingAccounts(false);
  }
  useEffect(() => { loadData(); }, []);

  const accountedSchoolIds = new Set(accounts.map(a => a.schoolId));
  const availableSchools = schools.filter(s => !accountedSchoolIds.has(s.id));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!selectedSchoolId || !email.trim()) {
      setError("Choose a school and enter an email address.");
      return;
    }
    setBusy(true);
    const result = await createSchoolAccount(selectedSchoolId, email.trim());
    setBusy(false);
    if (!result.ok) { setError(result.error || "Failed to create account."); return; }
    setSuccess(`Account for "${result.schoolName}" created. Default password: ${result.defaultPassword}`);
    setSelectedSchoolId("");
    setEmail("");
    loadData();
  }

  async function handleResetPassword(id: string) {
    setRowBusyId(id);
    const result = await resetSchoolPassword(id);
    setRowBusyId(null);
    setConfirmAction(null);
    setToast(result.ok ? `Password reset to 123456 for ${result.name}.` : (result.error || "Failed to reset password."));
    setTimeout(() => setToast(null), 4000);
  }

  async function handleDelete(id: string) {
    setRowBusyId(id);
    const result = await deleteSchoolAccount(id);
    setRowBusyId(null);
    setConfirmAction(null);
    setToast(result.ok ? `${result.name}'s account was deleted.` : (result.error || "Failed to delete account."));
    setTimeout(() => setToast(null), 4000);
    if (result.ok) loadData();
  }

  const { paged, search, setSearch, page, setPage, totalPages, filteredCount, pageSize } =
    usePaginatedList(accounts, { searchKeys: ["schoolName", "email"] });

  return (
    <div>
      {toast && <div className="mb-4 bg-primary text-primary-foreground text-sm rounded-lg px-4 py-2.5">{toast}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] gap-6">
        {/* Create form */}
        <div className="bg-card rounded-2xl border border-border p-6">
          <div className="flex items-center gap-2 mb-5">
            <UserPlus size={16} className="text-accent" />
            <h2 className="text-sm font-bold text-foreground">Add School Account</h2>
          </div>

          {success ? (
            <div className="text-center py-6">
              <p className="text-sm font-semibold text-foreground mb-1">Account created.</p>
              <p className="text-sm text-muted-foreground mb-4">{success}</p>
              <button onClick={() => setSuccess(null)} style={{ cursor: 'pointer' }} className="text-sm font-semibold text-accent hover:opacity-80 transition-opacity">Add another</button>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="mb-4">
                <label className="block text-xs font-semibold text-muted-foreground mb-1.5">School</label>
                <select value={selectedSchoolId} onChange={e => setSelectedSchoolId(e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-input-background">
                  <option value="">Select a school…</option>
                  {availableSchools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                {schools.length > 0 && availableSchools.length === 0 && (
                  <p className="text-[11.5px] text-muted-foreground mt-1.5">Every school already has an account.</p>
                )}
              </div>

              <div className="mb-5">
                <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Email Address</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="e.g., grades.capitoluniversity@example.com"
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-input-background outline-none focus:ring-2 focus:ring-accent/50" />
              </div>

              {error && <p className="text-sm text-destructive mb-3">{error}</p>}

              <button type="submit" disabled={busy || availableSchools.length === 0}
                className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-60">
                {busy ? "Creating…" : "Create Account"}
              </button>
            </form>
          )}
        </div>

        {/* Roster */}
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border">
            <Building2 size={15} className="text-accent" />
            <h2 className="text-sm font-bold text-foreground">Current School Accounts ({accounts.length})</h2>
          </div>
          {accounts.length > 0 && (
            <div className="px-5 py-3 border-b border-border">
              <ListSearchBox value={search} onChange={setSearch} placeholder="Search by school or email…" />
            </div>
          )}
          <div className="max-h-[560px] overflow-y-auto">
            {loadingAccounts ? (
              <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>
            ) : accounts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No school accounts yet.</p>
            ) : filteredCount === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No accounts match your search.</p>
            ) : (
              paged.map(a => (
                <div key={a.id} className="px-5 py-3 border-b border-border/50">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-sm font-medium text-foreground">{a.schoolName}</p>
                      <p className="text-xs text-muted-foreground">{a.email}</p>
                    </div>
                  </div>

                  {confirmAction?.id === a.id ? (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">
                        {confirmAction.kind === "reset" ? "Reset password to 123456?" : `Delete ${a.schoolName}'s account permanently?`}
                      </span>
                      <button
                        onClick={() => confirmAction.kind === "reset" ? handleResetPassword(a.id) : handleDelete(a.id)}
                        disabled={rowBusyId === a.id}
                        style={{ cursor: rowBusyId === a.id ? 'not-allowed' : 'pointer' }}
                        className={`font-bold hover:underline hover:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed ${confirmAction.kind === "delete" ? "text-destructive" : "text-accent"}`}
                      >
                        {rowBusyId === a.id ? "…" : "Confirm"}
                      </button>
                      <button onClick={() => setConfirmAction(null)} style={{ cursor: 'pointer' }} className="text-muted-foreground hover:underline hover:opacity-80 transition-opacity">Cancel</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 text-xs">
                      <button onClick={() => setConfirmAction({ id: a.id, kind: "reset" })} style={{ cursor: 'pointer' }} className="flex items-center gap-1 font-semibold text-accent hover:underline hover:opacity-80 transition-opacity">
                        <KeyRound size={12} /> Reset Password
                      </button>
                      <button onClick={() => setConfirmAction({ id: a.id, kind: "delete" })} style={{ cursor: 'pointer' }} className="flex items-center gap-1 font-semibold text-destructive hover:underline hover:opacity-80 transition-opacity">
                        <Trash2 size={12} /> Delete
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
          {filteredCount > 0 && (
            <div className="px-5 border-t border-border">
              <ListPagination page={page} totalPages={totalPages} onPageChange={setPage} filteredCount={filteredCount} pageSize={pageSize} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
