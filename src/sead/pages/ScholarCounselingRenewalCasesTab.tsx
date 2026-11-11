import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Clock, Loader2, Paperclip, RotateCcw } from "lucide-react";
import { useLiveReload } from "@/lib/liveUpdates";
import { DOC_LABEL, formatDateTime, formatDay, formatSlot } from "@/lib/renewal";
import { getStaffRenewalDocumentUrl, reviewDocument } from "../renewalApi";
import { ENDORSE_STATUSES, ENDORSE_STATUS_INFO, endorseStatus, fetchConsultCases, type ConsultCase, type ConsultCaseDocument, type EndorseStatus } from "../consultRenewalApi";
import { ReasonDialog } from "../renewal/ReasonDialog";
import { ModalShell } from "../components/SeadUiShell";

const DOC_KINDS = ["inc_letter", "study_plan", "clearance"] as const;

function DocChip({ status }: { status: ConsultCaseDocument["status"] }) {
  const base = "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[13px] font-bold";
  if (status === "accepted") return <span className={`${base} border-green-300 bg-green-50 text-green-900`}><CheckCircle2 size={13} aria-hidden="true" /> Approved</span>;
  if (status === "returned") return <span className={`${base} border-red-300 bg-red-50 text-red-900`}><RotateCcw size={13} aria-hidden="true" /> Returned</span>;
  return <span className={`${base} border-sky-400 bg-sky-50 text-sky-900`}><Clock size={13} aria-hidden="true" /> Waiting for you</span>;
}

/** The choice of the new scholarship status, with a written reason (needed for every status except Regular). */
function EndorseDialog({ c, onCancel, onDone }: { c: ConsultCase; onCancel: () => void; onDone: () => void }) {
  const [status, setStatus] = useState<EndorseStatus | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const needsReason = status !== "" && ENDORSE_STATUS_INFO[status].needsReason;
  const ok = status !== "" && (!needsReason || note.trim().length >= 5);
  async function go() {
    if (status === "") return;
    setBusy(true); setError("");
    const r = await endorseStatus(c.recordId, status, note.trim());
    setBusy(false);
    if (r.ok) onDone(); else setError(r.error);
  }
  return (
    <ModalShell title={`Endorse the new status of ${c.name}`} onClose={onCancel} wide>
      <p className="text-[14px] text-slate-700 mb-3">The consultation was attended and the three documents are approved. Choose the scholarship status you endorse for the renewal of {c.termLabel}. The Scholar Renewal evaluator approves it; only then is the scholar renewed.</p>
      <fieldset className="space-y-2">
        <legend className="text-[14px] font-semibold text-[#062444] mb-1">New scholarship status</legend>
        {ENDORSE_STATUSES.map(s => (
          <label key={s} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-[14px] ${status === s ? "border-[#062444] bg-[#f7f9fc]" : "border-[#062444]/20"}`}>
            <input type="radio" name="endorse-status" checked={status === s} onChange={() => setStatus(s)} className="mt-1" />
            <span><strong className="text-[#062444]">{s}</strong><span className="block text-slate-700">{ENDORSE_STATUS_INFO[s].effect}</span></span>
          </label>
        ))}
      </fieldset>
      <label className="mt-3 block text-[14px] font-semibold text-[#062444]">
        Reason{needsReason ? "" : " (optional)"}
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={500}
          className="mt-1 w-full rounded-lg border border-[#062444]/25 px-3 py-2 text-[14px] font-normal outline-none focus:border-[#062444] bg-white" />
      </label>
      {needsReason && <p className="text-[13px] text-slate-600 mt-1">At least 5 characters.</p>}
      {error && <p role="alert" className="mt-2 text-[14px] text-red-700">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onCancel} disabled={busy} className="rounded-lg border border-[#062444]/25 px-4 py-2 text-[14px] font-semibold text-[#062444]">Cancel</button>
        <button onClick={() => void go()} disabled={!ok || busy} className="inline-flex items-center gap-1.5 rounded-lg bg-green-800 px-4 py-2 text-[14px] font-bold text-white hover:bg-green-900 disabled:opacity-50">
          {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />} Endorse{status ? ` ${status}` : ""}
        </button>
      </div>
    </ModalShell>
  );
}

/**
 * Consultation Tool > Renewal Cases. For scholars with a failed subject / DRP (and the INC letter of an INC case): the consultation staff approve or return the letter from the dean,
 * the study plan and the clearance, and — once the consultation was attended AND the three documents are approved — endorse the new scholarship status
 * (Regular, Probationary, Reconsidered or Removed). The Scholar Renewal evaluator then approves the endorsement. The database checks every step again.
 */
export function ScholarCounselingRenewalCasesTab() {
  const [rows, setRows] = useState<ConsultCase[] | null>(null);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  const [fileError, setFileError] = useState("");
  const [reviewing, setReviewing] = useState<{ doc: ConsultCaseDocument; approve: boolean } | null>(null);
  const [endorsing, setEndorsing] = useState<ConsultCase | null>(null);
  const [busyDoc, setBusyDoc] = useState("");

  const load = useCallback(async () => {
    const r = await fetchConsultCases();
    if (!r.ok) { if (r.missing) setMissing(true); else setError(r.error); return; }
    setError(""); setRows(r.rows);
  }, []);
  useEffect(() => { if (!missing) void load(); }, [load, missing]);
  useLiveReload(async () => { if (!missing) await load(); });

  async function open(d: ConsultCaseDocument) {
    setFileError("");
    const r = await getStaffRenewalDocumentUrl(d.storagePath);
    if (r.ok) window.open(r.url, "_blank", "noopener"); else setFileError(r.error);
  }
  async function approve(d: ConsultCaseDocument) {
    setBusyDoc(d.id); setFileError("");
    const r = await reviewDocument(d.id, true, "");
    setBusyDoc("");
    if (!r.ok) setFileError(r.error);
    await load();
  }

  if (missing) return <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[14px] text-amber-950">This tab needs the latest database update (supabase_migration_renewal_consultation_endorse.sql). Ask the IT admin to run it.</p>;
  if (error) return <p role="alert" className="text-[14px] text-red-700">{error}</p>;
  if (!rows) return <p className="text-[14px] text-slate-700 flex items-center gap-2"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…</p>;

  const groups: { key: string; title: string; hint: string; list: ConsultCase[] }[] = [
    { key: "ready", title: "Ready to endorse", hint: "The consultation was attended and the three documents are approved. Choose the new scholarship status.", list: rows.filter(c => c.canEndorse) },
    { key: "work", title: "Documents and consultation", hint: "Approve or return the documents the scholars sent. A scholar books the consultation without waiting for them.", list: rows.filter(c => !c.canEndorse && c.stage !== "endorsed_for_approval") },
    { key: "sent", title: "Endorsed — waiting for the evaluator", hint: "The Scholar Renewal evaluator approves the endorsement, then the scholar is renewed. The evaluator may send it back to you.", list: rows.filter(c => c.stage === "endorsed_for_approval") },
  ];

  return (
    <div className="space-y-6">
      <p className="text-[14px] text-slate-700">Renewal cases of scholars with a failed subject, a DRP or an INC. You approve the three documents (letter from the dean, study plan, clearance) and endorse the new scholarship status after the consultation.</p>
      {fileError && <p role="alert" className="text-[14px] text-red-700">{fileError}</p>}
      {groups.map(g => (
        <section key={g.key} aria-label={g.title}>
          <h2 className="text-[16px] font-bold text-[#062444]">{g.title} <span className="ml-1 text-[#006aa3]">{g.list.length}</span></h2>
          <p className="text-[13.5px] text-slate-600 mb-2">{g.hint}</p>
          {g.list.length === 0 ? <p className="rounded-xl border border-dashed border-[#e6ecf5] px-4 py-6 text-center text-[14px] text-slate-700">Nothing here.</p> : (
            <div className="space-y-3">
              {g.list.map(c => (
                <article key={c.recordId} className="rounded-xl border border-[#e6ecf5] bg-white px-4 py-3 text-[14px] text-slate-800">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-[16px] font-bold text-[#062444]">{c.name}</h3>
                      <p className="text-slate-700">{c.scholarIdNumber} · {c.school} · {c.program} · {c.yearLevel}</p>
                      <p className="text-slate-700">Renewal for <strong>{c.termLabel}</strong> · status now: <strong>{c.scholarStatus}</strong></p>
                    </div>
                    {c.canEndorse && <button onClick={() => setEndorsing(c)} className="inline-flex items-center gap-1.5 rounded-lg bg-green-800 px-4 py-2 text-[14px] font-bold text-white hover:bg-green-900"><CheckCircle2 size={15} aria-hidden="true" /> Endorse the new status</button>}
                  </div>
                  <p className="mt-2 text-slate-800">
                    {[...c.failedSubjects.map(f => `${f.subject || f.code}: ${f.grade}${f.outcome === "drp" ? " (DRP)" : " (failed)"}`), ...c.incSubjects.map(f => `${f.subject || f.code}: INC`)].join(" · ") || "—"}
                  </p>
                  <p className="mt-1 text-slate-800">
                    <strong>Consultation:</strong>{" "}
                    {c.consultationDoneAt ? `attended on ${formatDay(c.consultationDoneAt)}` : c.nextConsultation ? `booked for ${formatSlot(c.nextConsultation.startsAt)} with ${c.nextConsultation.staff}` : "not booked yet"}
                  </p>
                  <ul className="mt-2 space-y-1.5" aria-label={`Documents of ${c.name}`}>
                    {DOC_KINDS.filter(k => c.requiredDocuments.some(d => d.kind === k) || c.documents.some(d => d.kind === k)).map(k => {
                      const docs = c.documents.filter(d => d.kind === k);
                      const current = docs.find(d => d.status !== "returned") ?? docs[0];
                      return (
                        <li key={k} className="flex flex-wrap items-center gap-2">
                          <span className="min-w-[8.5rem] font-semibold text-slate-900">{DOC_LABEL[k]}</span>
                          {!current ? <span className="text-slate-700">Not uploaded yet</span> : (
                            <>
                              <button onClick={() => void open(current)} className="inline-flex items-center gap-1 font-semibold text-[#00709f] hover:underline"><Paperclip size={14} aria-hidden="true" /> {current.fileName}</button>
                              <DocChip status={current.status} />
                              <span className="text-[13px] text-slate-600">sent {formatDateTime(current.uploadedAt)}</span>
                              {current.status === "returned" && current.comment && <span className="text-[13.5px] text-slate-800">“{current.comment}”</span>}
                              {current.status === "submitted" && (
                                <span className="flex gap-2">
                                  <button onClick={() => void approve(current)} disabled={busyDoc === current.id} className="rounded-md bg-green-800 px-2.5 py-1 text-[13px] font-bold text-white hover:bg-green-900 disabled:opacity-60">Approve</button>
                                  <button onClick={() => setReviewing({ doc: current, approve: false })} className="rounded-md border border-red-700 px-2.5 py-1 text-[13px] font-bold text-red-800 hover:bg-red-50">Return</button>
                                </span>
                              )}
                            </>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {c.stage === "endorsed_for_approval" && c.endorsedStatus && (
                    <p className="mt-2 rounded-md border border-sky-300 bg-sky-50 px-2.5 py-2 text-sky-950">
                      <strong>Endorsed: {c.endorsedStatus}</strong>{c.endorsedBy ? ` by ${c.endorsedBy}` : ""}{c.endorsedAt ? ` on ${formatDay(c.endorsedAt)}` : ""}{c.endorsedNote ? ` — ${c.endorsedNote}` : ""}
                    </p>
                  )}
                  {!c.canEndorse && c.stage === "needs_study_plan_consultation" && <p className="mt-2 text-[13.5px] text-slate-600">You can endorse the status after the consultation is attended and all three documents are approved.</p>}
                  {c.legacy && <p className="mt-2 text-[13.5px] text-amber-900">This case was already sent to the Division Head, so it follows the Division Head route.</p>}
                </article>
              ))}
            </div>
          )}
        </section>
      ))}

      {reviewing && (
        <ReasonDialog title={`Return the ${DOC_LABEL[reviewing.doc.kind].toLowerCase()}`} intro={<>Tell the scholar what to fix. The scholar uploads a new one; the consultation is not affected.</>} label="What should the scholar fix?" confirmLabel="Return it" minLength={5} danger
          onCancel={() => setReviewing(null)}
          onConfirm={async reason => { const r = await reviewDocument(reviewing.doc.id, false, reason); if (!r.ok) return r.error; setReviewing(null); await load(); return null; }} />
      )}
      {endorsing && <EndorseDialog c={endorsing} onCancel={() => setEndorsing(null)} onDone={() => { setEndorsing(null); void load(); }} />}
    </div>
  );
}
