import { useState } from "react";
import { X, ShieldQuestion, Info } from "lucide-react";
import { setScholarSecurityQuestion, SECURITY_QUESTIONS } from "../../scholarApi";

/**
 * Shown once per login (see ScholarPortalPage) when the scholar hasn't set
 * a security question yet — until they do, a "forgot password" reset only
 * needs their Scholar ID + name to match (see
 * scholar-self-reset-password), which is weaker. Dismissible ("Remind me
 * later") rather than a hard gate; it just reappears next login.
 */
export function SecurityQuestionSetupModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!question) { setError("Choose a security question."); return; }
    if (answer.trim().length < 2) { setError("Enter a longer answer."); return; }

    setBusy(true);
    const result = await setScholarSecurityQuestion(question, answer.trim());
    setBusy(false);
    if (!result.ok) { setError(result.error || "Couldn't save your security question."); return; }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-2xl overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4">
          <h3 className="flex items-center gap-2 text-white font-bold text-[15px]">
            <ShieldQuestion size={17} className="text-[#F3BC00]" /> Set a Security Question
          </h3>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          <div className="flex items-start gap-2.5 bg-[#0088cc]/8 border border-[#0088cc]/20 rounded-lg px-3.5 py-2.5 text-[12.5px] text-[#062444] mb-5">
            <Info size={14} className="shrink-0 mt-0.5 text-[#0088cc]" />
            This lets you reset your own password instantly if you ever get locked out, without waiting on staff.
          </div>

          <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">Security Question</label>
          <select value={question} onChange={e => setQuestion(e.target.value)} disabled={busy}
            className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc] bg-white mb-4">
            <option value="" disabled>Choose a question…</option>
            {SECURITY_QUESTIONS.map(q => <option key={q} value={q}>{q}</option>)}
          </select>

          <label className="block text-[12.5px] font-semibold text-slate-500 mb-1.5">Your Answer</label>
          <input value={answer} onChange={e => setAnswer(e.target.value)} disabled={busy} placeholder="Enter your answer"
            className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc] mb-1" />
          <p className="text-[11px] text-slate-400 mb-4">Answers aren't case-sensitive — just remember it the same way each time.</p>

          {error && <p className="text-[13px] text-red-600 mb-3">{error}</p>}

          <div className="flex items-center justify-between gap-3">
            <button type="button" onClick={onClose} disabled={busy} className="text-[13px] font-semibold text-slate-500 hover:text-slate-700">
              Remind me later
            </button>
            <button type="submit" disabled={busy}
              className="bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-60 text-white text-[13px] font-semibold rounded-lg px-5 py-2.5">
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
