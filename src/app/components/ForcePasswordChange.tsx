import { useState } from "react";
import { Check, Circle, Eye, EyeOff, KeyRound } from "lucide-react";
import { finishForcedPasswordChange } from "@/lib/passwordGate";
import { passwordChecklist } from "@/lib/passwordPolicy";

/**
 * The screen shown, instead of the site, to a person whose account was given a TEMPORARY password (new account, or a reset by staff): they must choose
 * their own password before anything else. Used by the staff, school and scholar sites (SDP Monitoring update, Phase 6). `avoid` = words the new
 * password may not contain (user name, Scholar ID, name). Plain colours and words; the checklist uses a tick or a circle plus words, never colour alone.
 */
export function ForcePasswordChange({ who, avoid, onDone, onSignOut }: {
  /** What to call the person's sign-in ("your username", "your Scholar ID"): shown in the explanation. */
  who: string;
  avoid: string[];
  onDone: () => void;
  onSignOut: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const checklist = passwordChecklist(password, confirm);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError("The two entries do not match."); return; }
    setBusy(true); setError("");
    const result = await finishForcedPasswordChange(password, avoid);
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    onDone();
  }

  const field = "w-full rounded-lg border border-[#062444]/25 bg-white px-3 py-2.5 text-[14px] text-[#062444] outline-none focus:border-[#0088cc]";
  return (
    <div className="min-h-screen bg-[#eaf3fc] flex items-center justify-center px-4 py-8">
      <main className="w-full max-w-md rounded-2xl bg-white shadow-xl border border-[#e6ecf5] overflow-hidden">
        <div className="bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-5">
          <h1 className="flex items-center gap-2 text-white text-[17px] font-bold"><KeyRound size={18} className="text-[#F3BC00]" aria-hidden="true" /> Choose your own password</h1>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <p className="text-[14px] text-[#062444]">
            You signed in with a temporary password. Before you continue, choose a password that only you know. You will use it, with {who}, from now on.
          </p>

          <div>
            <label htmlFor="force-new-password" className="block text-[13px] font-semibold text-[#062444] mb-1">New password</label>
            <div className="relative">
              <input id="force-new-password" type={show ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" className={`${field} pr-11`} />
              <button type="button" onClick={() => setShow(s => !s)} aria-label={show ? "Hide the passwords" : "Show the passwords"} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-600 hover:text-[#062444]">
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div>
            <label htmlFor="force-confirm-password" className="block text-[13px] font-semibold text-[#062444] mb-1">Type it again</label>
            <input id="force-confirm-password" type={show ? "text" : "password"} value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" className={field} />
          </div>

          <ul className="space-y-1" aria-label="What your password needs">
            {checklist.map(item => (
              <li key={item.label} className="flex items-center gap-2 text-[13px] text-[#062444]">
                {item.met ? <Check size={14} className="text-green-700" aria-hidden="true" /> : <Circle size={12} className="text-slate-500" aria-hidden="true" />}
                <span>{item.label}<span className="sr-only">{item.met ? " (done)" : " (not yet)"}</span></span>
              </li>
            ))}
          </ul>

          {error && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[13px] text-red-800">{error}</p>}

          <div className="flex items-center justify-between gap-3 pt-1">
            <button type="button" onClick={onSignOut} className="text-[13px] font-semibold text-slate-700 hover:text-[#062444] underline underline-offset-2">Sign out</button>
            <button type="submit" disabled={busy} className="rounded-lg bg-[#062444] px-5 py-2.5 text-[14px] font-bold text-white disabled:opacity-60">{busy ? "Saving…" : "Save my password"}</button>
          </div>
        </form>
      </main>
    </div>
  );
}
