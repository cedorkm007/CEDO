import { useState } from "react";
import { X, Lock, Key, ShieldCheck, Info } from "lucide-react";
import { changeOwnPassword } from "../../scholarApi";

export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (next.length < 8) { setError("New password must be at least 8 characters."); return; }
    if (next !== confirm) { setError("New password and confirmation don't match."); return; }

    setBusy(true);
    const result = await changeOwnPassword(current, next);
    setBusy(false);
    if (!result.ok) { setError(result.error || "Couldn't change password."); return; }
    setDone(true);
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center px-4" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-2xl overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4">
          <h3 className="flex items-center gap-2 text-white font-bold text-[15px]">
            <ShieldCheck size={17} className="text-[#F3BC00]" /> Change Password
          </h3>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X size={18} /></button>
        </div>

        <div className="p-6">
          {done ? (
            <div className="text-center py-4">
              <p className="text-sm font-semibold text-[#062444] mb-1">Password updated.</p>
              <p className="text-sm text-slate-500 mb-5">Use your new password next time you sign in.</p>
              <button onClick={onClose} className="bg-[#062444] text-white text-sm font-semibold rounded-lg px-5 py-2.5">Done</button>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="flex items-start gap-2.5 bg-[#0088cc]/8 border border-[#0088cc]/20 rounded-lg px-3.5 py-2.5 text-[12.5px] text-[#062444] mb-5">
                <Info size={14} className="shrink-0 mt-0.5 text-[#0088cc]" />
                Choose a strong password with at least 8 characters, mixing letters and numbers.
              </div>

              <Field icon={<Lock size={15} />} label="Current Password" value={current} onChange={setCurrent} placeholder="Enter current password" />
              <Field icon={<Key size={15} />} label="New Password" value={next} onChange={setNext} placeholder="Enter new password" />
              <Field icon={<ShieldCheck size={15} />} label="Confirm New Password" value={confirm} onChange={setConfirm} placeholder="Re-enter new password" />

              {error && <p className="text-[13px] text-red-600 mb-3">{error}</p>}

              <div className="flex justify-end">
                <button type="submit" disabled={busy}
                  className="bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-60 text-white text-[13px] font-semibold rounded-lg px-5 py-2.5">
                  {busy ? "Updating…" : "Update Password"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ icon, label, value, onChange, placeholder }: { icon: React.ReactNode; label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="mb-4">
      <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">{label}</label>
      <div className="flex items-center border border-[#062444]/15 rounded-lg px-3 py-2.5 gap-2">
        <span className="text-[#0088cc] shrink-0">{icon}</span>
        <input type="password" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
          className="w-full text-sm outline-none placeholder:text-slate-300" />
      </div>
    </div>
  );
}
