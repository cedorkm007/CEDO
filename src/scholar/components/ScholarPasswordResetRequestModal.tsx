import { useState } from "react";
import { X, IdCard, User, KeyRound, ShieldQuestion, CheckCircle2, Info } from "lucide-react";
import { selfResetScholarPassword } from "../scholarApi";
import { passwordChecklist, validateNewPassword } from "@/lib/passwordPolicy";

/**
 * "I forgot my password" (SDP Monitoring update, Phase 6, Option A). Two steps, both handled by scholar-self-reset-password:
 *   1. Scholar ID + Last Name + First Name: the security question is shown (for any ID, real or not, so nothing reveals which IDs exist).
 *   2. The answer AND the scholar's own new password. No fixed password is ever created or shown.
 * A scholar who never set a security question cannot reset this way: they ask the SEAD office. At most 5 wrong answers per hour for one Scholar ID.
 */
export function ScholarPasswordResetRequestModal({ onClose }: { onClose: () => void }) {
  const [scholarId, setScholarId] = useState("");
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [securityQuestion, setSecurityQuestion] = useState<string | null>(null);
  const [securityAnswer, setSecurityAnswer] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

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
    if ("needsAnswer" in result) setSecurityQuestion(result.question);
  }

  async function submitAnswer(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!securityAnswer.trim()) { setError("Enter your answer."); return; }
    const problem = validateNewPassword(newPassword, { avoid: [scholarId, firstName, lastName] });
    if (problem) { setError(problem); return; }
    if (newPassword !== confirmPassword) { setError("The two passwords do not match."); return; }
    setBusy(true);
    const result = await selfResetScholarPassword({
      scholarIdNumber: scholarId.trim(), lastName: lastName.trim(), firstName: firstName.trim(), securityAnswer: securityAnswer.trim(), newPassword,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      if (result.needsAnswer && result.question) setSecurityQuestion(result.question);
      return;
    }
    if ("reset" in result) setDone(true);
  }

  const checklist = passwordChecklist(newPassword, confirmPassword);
  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center px-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Reset password" className="w-full max-w-md max-h-[92vh] overflow-y-auto bg-white rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4">
          <h3 className="flex items-center gap-2 text-white font-bold text-[15px]">
            <KeyRound size={17} className="text-[#F3BC00]" /> Reset Password
          </h3>
          <button onClick={onClose} aria-label="Close" className="text-white/70 hover:text-white"><X size={18} /></button>
        </div>

        <div className="p-6">
          {done ? (
            <div className="text-center py-4">
              <CheckCircle2 size={36} className="mx-auto text-green-600 mb-3" />
              <p className="text-sm font-semibold text-[#062444] mb-1">Your password has been changed.</p>
              <p className="text-sm text-slate-700 mb-5">Log in again with the new password you just chose.</p>
              <button onClick={onClose} className="bg-[#062444] text-white text-sm font-semibold rounded-lg px-5 py-2.5">Done</button>
            </div>
          ) : securityQuestion ? (
            <form onSubmit={submitAnswer}>
              <p className="text-[13px] text-slate-700 mb-4">Answer your security question, then choose a new password.</p>
              <div className="flex items-start gap-2.5 bg-[#0088cc]/8 border border-[#0088cc]/20 rounded-lg px-3.5 py-2.5 text-[13px] font-semibold text-[#062444] mb-4">
                <ShieldQuestion size={14} className="shrink-0 mt-0.5 text-[#0088cc]" aria-hidden="true" /> {securityQuestion}
              </div>
              <Field id="reset-answer" icon={<ShieldQuestion size={15} />} label="Your Answer" value={securityAnswer} onChange={setSecurityAnswer} placeholder="Enter your answer" />
              <Field id="reset-new" type="password" icon={<KeyRound size={15} />} label="New password" value={newPassword} onChange={setNewPassword} placeholder="At least 10 characters" />
              <Field id="reset-confirm" type="password" icon={<KeyRound size={15} />} label="Type the new password again" value={confirmPassword} onChange={setConfirmPassword} placeholder="Re-enter the new password" />
              <ul className="mb-4 space-y-1" aria-label="What your password needs">
                {checklist.map(item => <li key={item.label} className="text-[12.5px] text-[#062444]">{item.met ? "✓" : "○"} {item.label}<span className="sr-only">{item.met ? " (done)" : " (not yet)"}</span></li>)}
              </ul>
              <div className="flex items-start gap-2 text-[12px] text-slate-700 mb-4"><Info size={13} className="shrink-0 mt-0.5 text-[#0088cc]" aria-hidden="true" /> If you never set a security question, the SEAD office has to reset your password for you.</div>
              {error && <p role="alert" className="text-[13px] text-red-700 mb-3">{error}</p>}
              <div className="flex justify-end">
                <button type="submit" disabled={busy}
                  className="bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-60 text-white text-[13px] font-semibold rounded-lg px-5 py-2.5">
                  {busy ? "Checking…" : "Change my password"}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={submitIdentity}>
              <p className="text-[13px] text-slate-700 mb-5">
                Enter your details. You will answer the security question you chose and then pick a new password yourself.
              </p>

              <Field id="reset-id" icon={<IdCard size={15} />} label="Scholar ID" value={scholarId} onChange={setScholarId} placeholder="20180000" />
              <Field id="reset-last" icon={<User size={15} />} label="Last Name" value={lastName} onChange={setLastName} placeholder="Enter your last name" />
              <Field id="reset-first" icon={<User size={15} />} label="First Name" value={firstName} onChange={setFirstName} placeholder="Enter your first name" />

              {error && <p role="alert" className="text-[13px] text-red-700 mb-3">{error}</p>}

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

function Field({ id, icon, label, value, onChange, placeholder, type = "text" }: {
  id: string; icon: React.ReactNode; label: string; value: string; onChange: (v: string) => void; placeholder: string; type?: string;
}) {
  return (
    <div className="mb-4">
      <label htmlFor={id} className="block text-[12.5px] font-semibold text-slate-700 mb-1.5">{label}</label>
      <div className="flex items-center border border-[#062444]/25 rounded-lg px-3 py-2.5 gap-2">
        <span className="text-[#0088cc] shrink-0" aria-hidden="true">{icon}</span>
        <input id={id} type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
          autoComplete={type === "password" ? "new-password" : "off"} className="w-full text-sm outline-none placeholder:text-slate-500" />
      </div>
    </div>
  );
}
