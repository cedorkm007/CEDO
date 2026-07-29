import { useState } from "react";
import { X, UserPlus } from "lucide-react";
import { createScholarAccount, type NewScholarInput } from "../seadApi";

const CIVIL_STATUS_OPTIONS = ["Single", "Single Parent", "Married", "Widow", "Separated"];

export function AddScholarModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState<NewScholarInput>({
    scholarIdNumber: "", firstName: "", lastName: "", middleName: "", birthday: "",
    address: "", school: "", course: "", civilStatus: "", contactNo: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<string | null>(null);

  function set<K extends keyof NewScholarInput>(key: K, value: string) {
    setForm(f => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.scholarIdNumber || !form.firstName || !form.lastName || !form.birthday) {
      setError("Scholar ID, first name, last name, and birthday are required.");
      return;
    }
    setBusy(true);
    const result = await createScholarAccount(form);
    setBusy(false);
    if (!result.ok) { setError(result.error || "Failed to create account."); return; }
    setSuccess(`Account created. Default password: ${result.defaultPassword}`);
    onCreated();
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center px-4 py-8 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4 rounded-t-2xl">
          <h3 className="flex items-center gap-2 text-white font-bold text-[15px]"><UserPlus size={16} className="text-[#F3BC00]" /> Add Scholar</h3>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X size={18} /></button>
        </div>

        <div className="p-6">
          {success ? (
            <div className="text-center py-4">
              <p className="text-sm font-semibold text-[#062444] mb-1">Scholar account created.</p>
              <p className="text-sm text-slate-500 mb-5">{success}</p>
              <button onClick={onClose} className="bg-[#062444] text-white text-sm font-semibold rounded-lg px-5 py-2.5">Done</button>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <F label="Scholar ID Number" value={form.scholarIdNumber} onChange={v => set("scholarIdNumber", v)} required />
                <F label="Birthday" type="date" value={form.birthday} onChange={v => set("birthday", v)} required />
              </div>
              <div className="grid grid-cols-3 gap-3 mb-3">
                <F label="First Name" value={form.firstName} onChange={v => set("firstName", v)} required />
                <F label="Middle Name" value={form.middleName} onChange={v => set("middleName", v)} />
                <F label="Last Name" value={form.lastName} onChange={v => set("lastName", v)} required />
              </div>
              <F label="Address" value={form.address} onChange={v => set("address", v)} className="mb-3" />
              <div className="grid grid-cols-2 gap-3 mb-3">
                <F label="School" value={form.school} onChange={v => set("school", v)} />
                <F label="Course" value={form.course} onChange={v => set("course", v)} />
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">Civil Status</label>
                  <select value={form.civilStatus} onChange={e => set("civilStatus", e.target.value)}
                    className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none">
                    <option value="">-- Select --</option>
                    {CIVIL_STATUS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <F label="Contact No." value={form.contactNo} onChange={v => set("contactNo", v)} />
              </div>

              {error && <p className="text-[13px] text-red-600 mb-3">{error}</p>}

              <div className="flex justify-end">
                <button type="submit" disabled={busy}
                  className="bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-60 text-white text-[13px] font-semibold rounded-lg px-5 py-2.5">
                  {busy ? "Creating…" : "Create Account"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function F({ label, value, onChange, type = "text", required, className = "" }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean; className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} required={required}
        className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc]" />
    </div>
  );
}
