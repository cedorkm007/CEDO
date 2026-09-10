import { useState } from "react";
import { X, IdCard, User, KeyRound, ShieldQuestion, CheckCircle2 } from "lucide-react";
import { selfResetScholarPassword } from "../scholarApi";

/**
 * Instant self-service password reset. Two steps, both handled by
 * scholar-self-reset-password:
 *   1. Scholar ID + Last Name + First Name — if that scholar has no
 *      security question set yet, resets immediately.
 *   2. If they DO have a security question, this step's response carries
 *      it back instead of resetting; the scholar answers it here and
 *      resubmits (still along with the same ID/name) to complete the reset.
 */
export function ScholarPasswordResetRequestModal({ onClose }: { onClose: () => void }) {
  const [scholarId, setScholarId] = useState("");
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [securityQuestion, setSecurityQuestion] = useState<string | null>(null);
  const [securityAnswer, setSecurityAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resetPassword, setResetPassword] = useState<string | null>(null);

  async function submitIdentity(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!scholarId.trim() || !lastName.trim() || !firstName.trim()) {
      setError("Please fill in your Scholar ID, Last Name, and First Name.");
      return;
    }
    setBusy(true);
    const result = await selfResetScholarPassword({ scholarIdNumber: scholarId.trim(), lastName: lastName.trim(), firstName: firstName.trim() });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    if (result.reset) { setResetPassword(result.newPassword); return; }
    if (result.needsAnswer) { setSecurityQuestion(result.question); return; }
  }

  async function submitAnswer(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!securityAnswer.trim()) { setError("Enter your answer."); return; }
    setBusy(true);
    const result = await selfResetScholarPassword({
      scholarIdNumber: scholarId.trim(), lastName: lastName.trim(), firstName: firstName.trim(), securityAnswer: securityAnswer.trim(),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      if (result.needsAnswer && result.question) setSecurityQuestion(result.question);
      return;
    }
    if (result.reset) setResetPassword(result.newPassword);
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center px-4" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-2xl overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4">
          <h3 className="flex items-center gap-2 text-white font-bold text-[15px]">
            <KeyRound size={17} className="text-[#F3BC00]" /> Reset Password
          </h3>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X size={18} /></button>
        </div>

        <div className="p-6">
          {resetPassword ? (
            <div className="text-center py-4">
              <CheckCircle2 size={36} className="mx-auto text-green-600 mb-3" />
              <p className="text-sm font-semibold text-[#062444] mb-1">Your password has been reset.</p>
              <p className="text-sm text-slate-500 mb-5">
                Log in again using the default password "{resetPassword}". You can change it from your profile once you're signed in.
              </p>
              <button onClick={onClose} className="bg-[#062444] text-white text-sm font-semibold rounded-lg px-5 py-2.5">Done</button>
            </div>
          ) : securityQuestion ? (
            <form onSubmit={submitAnswer}>
              <p className="text-[12.5px] text-slate-500 mb-4">Answer your security question to finish resetting your password.</p>
              <div className="flex items-start gap-2.5 bg-[#0088cc]/8 border border-[#0088cc]/20 rounded-lg px-3.5 py-2.5 text-[12.5px] font-semibold text-[#062444] mb-4">
                <ShieldQuestion size={14} className="shrink-0 mt-0.5 text-[#0088cc]" /> {securityQuestion}
              </div>
              <Field icon={<ShieldQuestion size={15} />} label="Your Answer" value={securityAnswer} onChange={setSecurityAnswer} placeholder="Enter your answer" />
              {error && <p className="text-[13px] text-red-600 mb-3">{error}</p>}
              <div className="flex justify-end">
                <button type="submit" disabled={busy}
                  className="bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-60 text-white text-[13px] font-semibold rounded-lg px-5 py-2.5">
                  {busy ? "Verifying…" : "Reset Password"}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={submitIdentity}>
              <p className="text-[12.5px] text-slate-500 mb-5">
                Enter your details below. If they match your account, your password resets instantly.
              </p>

              <Field icon={<IdCard size={15} />} label="Scholar ID" value={scholarId} onChange={setScholarId} placeholder="20180000" />
              <Field icon={<User size={15} />} label="Last Name" value={lastName} onChange={setLastName} placeholder="Enter your last name" />
              <Field icon={<User size={15} />} label="First Name" value={firstName} onChange={setFirstName} placeholder="Enter your first name" />

              {error && <p className="text-[13px] text-red-600 mb-3">{error}</p>}

              <div className="flex justify-end">
                <button type="submit" disabled={busy}
                  className="bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-60 text-white text-[13px] font-semibold rounded-lg px-5 py-2.5">
                  {busy ? "Checking…" : "Continue"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ icon, label, value, onChange, placeholder }: {
  icon: React.ReactNode; label: string; value: string; onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <div className="mb-4">
      <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">{label}</label>
      <div className="flex items-center border border-[#062444]/15 rounded-lg px-3 py-2.5 gap-2">
        <span className="text-[#0088cc] shrink-0">{icon}</span>
        <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
          className="w-full text-sm outline-none placeholder:text-slate-300" />
      </div>
    </div>
  );
}
