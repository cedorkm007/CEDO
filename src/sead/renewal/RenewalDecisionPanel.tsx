import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RotateCcw, ShieldCheck, UserX } from "lucide-react";
import { DIVISION_HEAD_DECISION_LABEL, DIVISION_HEAD_OPTION_INFO, formatDay } from "@/lib/renewal";
import { SignatureUploadPanel } from "../components/SignatureUploadPanel";
import { decideRenewalCase, returnRenewalCaseToEvaluator, type RenewalReferralInfo } from "../divisionHeadApi";

type Choice = "approve_probationary" | "removed" | "reconsidered" | "return";

/** "Oct 14, 2026" from a timestamp. */
const dayOf = (iso: string) => formatDay(iso.slice(0, 10));

/**
 * The Division Head's decision on a renewal case, shown inside the Referral Form screen of a renewal-linked referral. The Division Head signs the
 * form as always (signature image + the printed name, which is the only thing they may change) and chooses what the case needs:
 *   an endorsed 1-failed case    -> Approve Probationary, or send back
 *   a 2+ failed case             -> Removed or Reconsidered, or send back
 * The database applies the outcome (status, login, renewal result); nothing here changes a status by itself.
 */
export function RenewalDecisionPanel({ info, canDecide, onDone }: { info: RenewalReferralInfo; canDecide: boolean; onDone: () => void }) {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [signaturePath, setSignaturePath] = useState<string | null>(null);
  const [printedName, setPrintedName] = useState(info.myName);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);

  const waiting = info.options.length > 0 && info.referralStatus === "forwarded_to_division_head";
  const needsSignature = choice !== null && choice !== "return";
  const ready = choice !== null && (choice === "return" ? note.trim().length >= 5 : !!signaturePath && printedName.trim().length > 0) && !busy;

  async function submit() {
    if (!choice) return;
    setBusy(true); setError("");
    const r = choice === "return"
      ? await returnRenewalCaseToEvaluator(info.recordId, note.trim())
      : await decideRenewalCase({ recordId: info.recordId, decision: choice, signaturePath: signaturePath ?? "", signatoryName: printedName.trim(), note: note.trim() });
    setBusy(false);
    if (!r.ok) { setError(r.error); setConfirmRemove(false); return; }
    onDone();
  }

  return (
    <section aria-label="Renewal decision" className="rounded-xl border-2 border-[#062444]/20 bg-white p-4 space-y-3">
      <div className="flex items-start gap-2">
        <ShieldCheck size={18} className="mt-0.5 shrink-0 text-[#062444]" aria-hidden="true" />
        <div>
          <h3 className="text-[15px] font-extrabold text-[#062444]">Renewal for {info.termLabel}</h3>
          <p className="text-[14px] text-slate-700">{info.ruleText}</p>
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-[14px] sm:grid-cols-2">
        <div><dt className="font-semibold text-[#062444]">Grades checked</dt><dd className="text-slate-700">{info.basisLabel}</dd></div>
        <div><dt className="font-semibold text-[#062444]">Earlier probation</dt><dd className="text-slate-700">{info.previousProbation ? "Yes" : "No"}</dd></div>
        <div><dt className="font-semibold text-[#062444]">Consultation</dt>
          <dd className="text-slate-700">{info.consultationDoneAt ? `Attended on ${dayOf(info.consultationDoneAt)}${info.counselor ? ` with ${info.counselor}` : ""}` : "Has not taken place"}{info.noShowCount > 0 ? ` · missed ${info.noShowCount} time${info.noShowCount === 1 ? "" : "s"}` : ""}</dd></div>
        <div><dt className="font-semibold text-[#062444]">Failed subjects</dt>
          <dd className="text-slate-700">{info.failedSubjects.length === 0 ? "—" : info.failedSubjects.map(s => `${s.code ? s.code + " " : ""}${s.subject} (${s.grade})`).join("; ")}</dd></div>
        {info.incSubjects.length > 0 && <div><dt className="font-semibold text-[#062444]">INC subjects</dt><dd className="text-slate-700">{info.incSubjects.map(s => s.subject).join("; ")}</dd></div>}
        {info.evaluatorNote && <div className="sm:col-span-2"><dt className="font-semibold text-[#062444]">Evaluator's note</dt><dd className="text-slate-700">{info.evaluatorNote}</dd></div>}
      </dl>

      {info.sentBackReason && info.referralStatus === "reconsideration_requested" && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[14px] text-amber-950">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> <span><strong>Sent back to the evaluator:</strong> {info.sentBackReason}</span>
        </p>
      )}

      {info.decided && (
        <p className="flex items-start gap-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-[14px] text-green-950">
          <CheckCircle2 size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span><strong>Decided: {DIVISION_HEAD_DECISION_LABEL[info.decided]}</strong>{info.decidedAt ? ` on ${dayOf(info.decidedAt)}` : ""}{info.decisionNote ? ` — ${info.decisionNote}` : ""}</span>
        </p>
      )}

      {waiting && canDecide && (
        <div className="space-y-3 border-t border-[#e6ecf5] pt-3">
          <fieldset>
            <legend className="text-[14px] font-bold text-[#062444] mb-1.5">Your decision</legend>
            <div className="space-y-2">
              {info.options.map(o => {
                const meta = DIVISION_HEAD_OPTION_INFO[o];
                return (
                  <label key={o} className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[14px] ${choice === o ? "border-[#062444] bg-[#f4f8fd]" : "border-[#062444]/20 bg-white"}`}>
                    <input type="radio" name="dh-choice" className="mt-1" checked={choice === o} onChange={() => { setChoice(o); setConfirmRemove(false); setError(""); }} />
                    <span>
                      <span className={`font-bold ${o === "removed" ? "text-red-800" : "text-[#062444]"}`}>{meta.label}</span>
                      <span className="block text-slate-700">{meta.effect}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {needsSignature && (
            <div className="space-y-3">
              <SignatureUploadPanel onReady={setSignaturePath} />
              <label className="block text-[14px] font-semibold text-[#062444]">
                Name printed on the form
                <input value={printedName} onChange={e => setPrintedName(e.target.value)} maxLength={120}
                  className="mt-1 w-full rounded-lg border border-[#062444]/25 px-3 py-2 text-[14px] font-normal outline-none focus:border-[#062444] bg-white" />
                <span className="block text-[13px] font-normal text-slate-700">The signature stays yours; only the printed name can be changed.</span>
              </label>
            </div>
          )}

          {choice && (
            <label className="block text-[14px] font-semibold text-[#062444]">
              {choice === "return" ? "Reason for the evaluator" : "Note (optional)"}
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={500}
                className="mt-1 w-full rounded-lg border border-[#062444]/25 px-3 py-2 text-[14px] font-normal outline-none focus:border-[#062444] bg-white" />
              {choice === "return" && <span className="block text-[13px] font-normal text-slate-700">At least 5 characters.</span>}
            </label>
          )}

          {choice === "removed" && confirmRemove && (
            <p role="alert" className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[14px] text-red-950">
              <UserX size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> <span>This switches off the scholar's login and ends the scholarship. Press “Yes, remove the scholar” to confirm.</span>
            </p>
          )}
          {error && <p role="alert" className="text-[14px] text-red-700">{error}</p>}

          <div className="flex justify-end">
            <button type="button" disabled={!ready}
              onClick={() => { if (choice === "removed" && !confirmRemove) { setConfirmRemove(true); return; } void submit(); }}
              className={`inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-[14px] font-bold text-white disabled:opacity-50 ${choice === "removed" ? "bg-red-700 hover:bg-red-800" : choice === "return" ? "bg-slate-700 hover:bg-slate-800" : "bg-green-700 hover:bg-green-800"}`}>
              {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : choice === "return" ? <RotateCcw size={14} aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}
              {!choice ? "Choose a decision" : choice === "return" ? "Send back" : choice === "removed" ? (confirmRemove ? "Yes, remove the scholar" : "Sign and remove") : choice === "reconsidered" ? "Sign and reconsider" : "Sign and approve"}
            </button>
          </div>
        </div>
      )}
      {waiting && !canDecide && <p className="text-[14px] text-slate-700">Waiting for the Division Head's decision.</p>}
      {info.referralStatus === "division_head_approved" && <p className="text-[14px] text-sky-900"><strong>Approved and signed.</strong> The consulting staff member who consulted the scholar now makes the final decision; the scholar's status has not changed yet.</p>}
    </section>
  );
}
