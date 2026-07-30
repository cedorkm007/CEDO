import { useEffect, useState } from "react";
import { UserPlus, Users, KeyRound, Trash2 } from "lucide-react";
import { DIVISION_LIST, type DivisionCode, type UserRole } from "@/app/App";
import { createStaffAccount, fetchStaffList, deleteStaffAccount, resetStaffPassword, type NewStaffInput, type StaffListItem } from "./itAdminApi";

const EMPTY_FORM: NewStaffInput = {
  lastName: "", firstName: "", middleName: "", suffix: "", nickname: "",
  username: "", designation: "", position: "", natureOfWork: "", mobilePhone: "",
  email: "", division: "LITM", role: "staff",
};

/**
 * Embedded in the main staff app (src/app/App.tsx) as "Staff Accounts" —
 * visible only to the account with username IT_ADMIN_USERNAME. Replaces
 * the retired self-registration flow entirely: this is now the only way
 * new staff accounts get created.
 */
export function StaffAccountsPage() {
  const [form, setForm] = useState<NewStaffInput>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffListItem[]>([]);
  const [loadingStaff, setLoadingStaff] = useState(true);
  const [confirmAction, setConfirmAction] = useState<{ id: string; kind: "reset" | "delete" } | null>(null);
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  async function loadStaff() {
    setLoadingStaff(true);
    setStaff(await fetchStaffList());
    setLoadingStaff(false);
  }
  useEffect(() => { loadStaff(); }, []);

  function set<K extends keyof NewStaffInput>(key: K, value: NewStaffInput[K]) {
    setForm(f => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.lastName || !form.firstName || !form.username || !form.email) {
      setError("Last name, first name, username, and email are required.");
      return;
    }
    setBusy(true);
    const result = await createStaffAccount(form);
    setBusy(false);
    if (!result.ok) { setError(result.error || "Failed to create account."); return; }
    setSuccess(`Account "${form.username}" created. Default password: ${result.defaultPassword}`);
    setForm(EMPTY_FORM);
    loadStaff();
  }

  async function handleResetPassword(id: string) {
    setRowBusyId(id);
    const result = await resetStaffPassword(id);
    setRowBusyId(null);
    setConfirmAction(null);
    setToast(result.ok ? `Password reset to 123456 for ${result.name}.` : (result.error || "Failed to reset password."));
    setTimeout(() => setToast(null), 4000);
  }

  async function handleDelete(id: string) {
    setRowBusyId(id);
    const result = await deleteStaffAccount(id);
    setRowBusyId(null);
    setConfirmAction(null);
    setToast(result.ok ? `${result.name}'s account was deleted.` : (result.error || "Failed to delete account."));
    setTimeout(() => setToast(null), 4000);
    if (result.ok) loadStaff();
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-foreground mb-1">Staff Accounts</h1>
      <p className="text-sm text-muted-foreground mb-6">Create new staff logins. Self-registration is retired — this is the only way new accounts get made.</p>

      {toast && <div className="mb-4 bg-primary text-primary-foreground text-sm rounded-lg px-4 py-2.5">{toast}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] gap-6">
        {/* Create form */}
        <div className="bg-card rounded-2xl border border-border p-6">
          <div className="flex items-center gap-2 mb-5">
            <UserPlus size={16} className="text-accent" />
            <h2 className="text-sm font-bold text-foreground">Add Staff Account</h2>
          </div>

          {success ? (
            <div className="text-center py-6">
              <p className="text-sm font-semibold text-foreground mb-1">Account created.</p>
              <p className="text-sm text-muted-foreground mb-4">{success}</p>
              <button onClick={() => setSuccess(null)} className="text-sm font-semibold text-accent">Add another</button>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="mb-4">
                <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Division</label>
                <select value={form.division} onChange={e => set("division", e.target.value as DivisionCode)}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-input-background">
                  {DIVISION_LIST.map(d => <option key={d.code} value={d.code}>{d.fullName}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <F label="Last Name" value={form.lastName} onChange={v => set("lastName", v)} />
                <F label="First Name" value={form.firstName} onChange={v => set("firstName", v)} />
                <F label="Middle Name" value={form.middleName} onChange={v => set("middleName", v)} />
                <F label="Suffix (optional)" value={form.suffix} onChange={v => set("suffix", v)} />
                <F label="Nickname" value={form.nickname} onChange={v => set("nickname", v)} />
                <F label="Username" value={form.username} onChange={v => set("username", v)} placeholder="e.g., jdelacruz" />
                <F label="Designation" value={form.designation} onChange={v => set("designation", v)} />
                <F label="Position" value={form.position} onChange={v => set("position", v)} />
                <F label="Nature of Work" value={form.natureOfWork} onChange={v => set("natureOfWork", v)} />
                <F label="Mobile Phone" value={form.mobilePhone} onChange={v => set("mobilePhone", v)} type="tel" />
              </div>
              <F label="Email Address" value={form.email} onChange={v => set("email", v)} type="email" className="mb-3" />

              <div className="mb-5">
                <label className="block text-xs font-semibold text-muted-foreground mb-1.5">Role</label>
                <select value={form.role} onChange={e => set("role", e.target.value as UserRole)}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-input-background">
                  <option value="staff">Staff</option>
                  <option value="division_admin">Division Admin</option>
                  <option value="super_admin">Super Admin</option>
                </select>
              </div>

              {error && <p className="text-sm text-destructive mb-3">{error}</p>}

              <button type="submit" disabled={busy}
                className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-60">
                {busy ? "Creating…" : "Create Account"}
              </button>
            </form>
          )}
        </div>

        {/* Roster */}
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border">
            <Users size={15} className="text-accent" />
            <h2 className="text-sm font-bold text-foreground">Current Staff ({staff.length})</h2>
          </div>
          <div className="max-h-[560px] overflow-y-auto">
            {loadingStaff ? (
              <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>
            ) : staff.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No staff accounts yet.</p>
            ) : (
              staff.map(s => (
                <div key={s.id} className="px-5 py-3 border-b border-border/50">
                  <div className="flex items-center justify-between mb-1.5">
                    <div>
                      <p className="text-sm font-medium text-foreground">{s.lastName}, {s.firstName}</p>
                      <p className="text-xs text-muted-foreground">@{s.username} · {s.division}</p>
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-wide bg-muted text-muted-foreground rounded-full px-2.5 py-1">{s.role.replace("_", " ")}</span>
                  </div>

                  {confirmAction?.id === s.id ? (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">
                        {confirmAction.kind === "reset" ? "Reset password to 123456?" : `Delete ${s.firstName}'s account permanently?`}
                      </span>
                      <button
                        onClick={() => confirmAction.kind === "reset" ? handleResetPassword(s.id) : handleDelete(s.id)}
                        disabled={rowBusyId === s.id}
                        className={`font-bold hover:underline ${confirmAction.kind === "delete" ? "text-destructive" : "text-accent"}`}
                      >
                        {rowBusyId === s.id ? "…" : "Confirm"}
                      </button>
                      <button onClick={() => setConfirmAction(null)} className="text-muted-foreground hover:underline">Cancel</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 text-xs">
                      <button onClick={() => setConfirmAction({ id: s.id, kind: "reset" })} className="flex items-center gap-1 font-semibold text-accent hover:underline">
                        <KeyRound size={12} /> Reset Password
                      </button>
                      <button onClick={() => setConfirmAction({ id: s.id, kind: "delete" })} className="flex items-center gap-1 font-semibold text-destructive hover:underline">
                        <Trash2 size={12} /> Delete
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function F({ label, value, onChange, type = "text", className = "", placeholder }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; className?: string; placeholder?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-xs font-semibold text-muted-foreground mb-1.5">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-input-background outline-none focus:ring-2 focus:ring-accent/50" />
    </div>
  );
}
