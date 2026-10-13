import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, Loader2, Paperclip, XCircle } from "lucide-react";
import { RenewalStageBadge } from "@/app/components/RenewalStageBadge";
import { DOC_LABEL, daysLeftText, daysUntil, formatDateTime, formatDay, formatSlot, termLabelOf } from "@/lib/renewal";
import {
  confirmRenewal, decideLateApplication, endorseRenewal, fetchRenewalDetail, getStaffRenewalDocumentUrl, returnRenewal, type RenewalDetail,
} from "../renewalApi";
import { ReasonDialog } from "./ReasonDialog";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[#e6ecf5] bg-white">
      <h3 className="border-b border-[#e6ecf5] px-4 py-2.5 text-[15px] font-bold text-[#062444]">{title}</h3>
      <div className="px-4 py-3 text-[14px] text-slate-800">{children}</div>
    </section>
  );
}

/** One scholar's renewal for one term: the application, the documents, the SDP result, the grades with failed/INC subjects, probation history, and the rule that was applied. The evaluator's actions are at the top. */
export function RenewalDetailView({ recordId, canAct, onBack, onChanged }: { recordId: string; canAct: boolean; onBack: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<RenewalDetail | null>(null);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<"confirm" | "endorse" | "return" | "accept" | "decline" | null>(null);
  const [fileError, setFileError] = useState("");

  const load = useCallback(async () => {
    const r = await fetchRenewalDetail(recordId);
    if (r.ok) { setDetail(r.detail); setError(""); } else setError(r.error);
  }, [recordId]);
  useEffect(() => { setDetail(null); void load(); }, [load]);

  async function openFile(path: string) {
    const r = await getStaffRenewalDocumentUrl(path);
    if (r.ok) { setFileError(""); window.open(r.url, "_blank", "noopener"); } else setFileError(r.error);
  }
  async function after() { onChanged(); await load(); }

  if (error) return <div><button onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-[14px] font-semibold text-[#00709f] hover:underline"><ArrowLeft size={15} aria-hidden="true" /> Back</button><p role="alert" className="text-[14px] text-red-700">{error}</p></div>;
  if (!detail) return <p className="text-[14px] text-slate-700 flex items-center gap-2"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…</p>;

  const { record: r, scholar: s, evaluation: ev } = detail;
  const g = ev.grades;
  const basis = r.basisSchoolYear && r.basisTerm ? termLabelOf(r.basisSchoolYear, r.basisTerm) : "—";
  const flagged = [
    ...(g?.failed_subjects ?? []).map(x => ({ ...x, tag: x.outcome === "drp" ? "DRP (counts as failed)" : "Failed" })),
    ...(g?.inc_subjects ?? []).map(x => ({ ...x, tag: x.state === "counted_failed" ? "INC (counted as failed)" : x.state === "decided" ? "INC (decided)" : "INC" })),
    ...(g?.review_subjects ?? []).map(x => ({ ...x, tag: "Needs review" })),
  ];
  const active = !["renewed", "removed", "reconsidered", "late_declined", "not_required", "returned", "late_pending", "endorsed_division_head"].includes(r.stage);

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-[14px] font-semibold text-[#00709f] hover:underline"><ArrowLeft size={15} aria-hidden="true" /> Back to the list</button>

      <div className="rounded-xl border border-[#e6ecf5] bg-white px-4 py-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-[18px] font-bold text-[#062444]">{s.name}</h2>
          <p className="text-[14px] text-slate-700">{s.scholarIdNumber} · {s.school} · {r.confirmedProgram ?? s.program} · {r.confirmedYearLevel ?? s.yearLevel}</p>
          <p className="text-[14px] text-slate-700 mt-0.5">Renewal for <strong>{termLabelOf(r.schoolYear, r.term)}</strong> · scholar status now: <strong>{s.status}</strong>{r.tempProbation ? " (temporary — INC)" : ""}</p>
          <div className="mt-2"><RenewalStageBadge stage={r.stage} full /></div>
        </div>
        {canAct && (
          <div className="flex flex-wrap gap-2">
            {r.stage === "late_pending" && <>
              <button onClick={() => setDialog("accept")} className="rounded-lg bg-[#062444] px-4 py-2 text-[14px] font-bold text-white hover:bg-[#0a3a6e]">Accept late application</button>
              <button onClick={() => setDialog("decline")} className="rounded-lg border border-red-700 px-4 py-2 text-[14px] font-bold text-red-800 hover:bg-red-50">Decline</button>
            </>}
            {r.stage === "ready_for_confirmation" && <button onClick={() => setDialog("confirm")} className="inline-flex items-center gap-1.5 rounded-lg bg-green-800 px-4 py-2 text-[14px] font-bold text-white hover:bg-green-900"><CheckCircle2 size={15} aria-hidden="true" /> Confirm renewal</button>}
            {r.stage === "ready_to_endorse" && <button onClick={() => setDialog("endorse")} className="inline-flex items-center gap-1.5 rounded-lg bg-green-800 px-4 py-2 text-[14px] font-bold text-white hover:bg-green-900"><CheckCircle2 size={15} aria-hidden="true" /> Endorse to Division Head</button>}
            {(active || r.stage === "ready_for_confirmation") && <button onClick={() => setDialog("return")} className="rounded-lg border border-[#062444]/40 px-4 py-2 text-[14px] font-bold text-[#062444] hover:bg-[#f7f9fc]">Return with comments</button>}
          </div>
        )}
      </div>
      {!canAct && <p className="text-[13.5px] text-slate-600">You can view this renewal, but only the Scholar Renewal Evaluator can confirm or return it.</p>}

      {r.scholarNote && <Section title="Note from the scholar"><p>“{r.scholarNote}”</p><p className="text-[13.5px] text-slate-600 mt-1">{formatDateTime(r.scholarNoteAt)}</p></Section>}
      {r.evaluatorComment && <Section title={r.stage === "returned" ? "Why it was returned" : "Evaluator's note"}><p>{r.evaluatorComment}</p></Section>}
      {r.isLate && <Section title="Late application"><p>Applied {formatDateTime(r.appliedAt)}, after the window closed. {r.lateDecision === "accepted" ? "Accepted" : r.lateDecision === "declined" ? "Declined" : "Waiting for your decision"}{r.lateReason ? `: ${r.lateReason}` : "."}</p></Section>}

      <Section title="The rule that was applied">
        <p><strong>{ev.rule_code ?? r.ruleCode ?? "—"}</strong> — {ev.rule_text ?? r.ruleText ?? "Not decided yet."}</p>
        <p className="text-[13.5px] text-slate-600 mt-1">Checked against {basis}. Previous (regular) probation: <strong>{ev.previous_probation ? "Yes" : "No"}</strong>.{r.consultationRequired ? " A face-to-face consultation is required." : ""}</p>
        {(r.consultationRequired || r.consultationDoneAt) && <p className="text-[13.5px] text-slate-600">Consultation done: {r.consultationDoneAt ? formatDay(r.consultationDoneAt) : "not yet"}{r.term === "Summer" ? ` · Prospectus hard copy received: ${r.hardCopyReceivedAt ? formatDay(r.hardCopyReceivedAt) : "not yet"}` : ""}{r.noShow ? " · Flagged: no-show" : ""}</p>}
      </Section>

      {(detail.nextConsultation || detail.appointments.length > 0 || r.consultationRequired) && (
        <Section title="Consultation appointments">
          {detail.nextConsultation ? <p><strong>Booked:</strong> {formatSlot(detail.nextConsultation.startsAt)} with {detail.nextConsultation.staff}.</p>
            : <p>{r.consultationDoneAt ? <>Consultation done on {formatDay(r.consultationDoneAt)}.</> : <>No consultation is booked yet{r.noShow ? " (the scholar missed the last one)" : ""}.</>}</p>}
          {detail.appointments.length > 0 && (
            <ul className="mt-2 space-y-1">
              {detail.appointments.map((a, i) => <li key={i}>{formatDateTime(a.at)} — {a.action.replace(/_/g, " ")}{a.startsAt ? ` (slot ${formatSlot(a.startsAt)})` : ""}{a.note ? ` — ${a.note}` : ""} · {a.actor}</li>)}
            </ul>
          )}
        </Section>
      )}

      <Section title="SDP result">
        {ev.sdp && !ev.sdp.applicable && <p>Not checked — Summer has no SDP requirement.</p>}
        {ev.sdp?.applicable && (
          <>
            <p className="flex items-center gap-1.5 font-semibold">{ev.sdp.complied ? <><CheckCircle2 size={15} className="text-green-700" aria-hidden="true" /> Complied</> : <><XCircle size={15} className="text-red-700" aria-hidden="true" /> Not complied — {ev.sdp.missing}</>}</p>
            <p className="text-[13.5px] text-slate-600 mt-1">Institutional Volunteerism {ev.sdp.community_service ?? 0} · Community Volunteerism {ev.sdp.community_volunteerism ?? 0} · Formation Program {ev.sdp.formation_program ?? 0} (3 needed in each; credit above 3 carries over)</p>
          </>
        )}
      </Section>

      <Section title={`Grades — ${basis}`}>
        {g && g.state !== "ready" && <p>{g.reason}</p>}
        {g && g.state === "ready" && (
          <>
            <p>{g.counts.total} subjects: {g.counts.passed} passed · {g.counts.failed} failed (DRP counts as failed){g.counts.inc ? ` · ${g.counts.inc} INC` : ""}{g.counts.review ? ` · ${g.counts.review} to review` : ""}.</p>
            {flagged.length > 0 && (
              <ul className="mt-2 space-y-1">{flagged.map(f => <li key={f.code + f.tag}><strong>{f.subject}</strong> ({f.code}) — grade {f.grade} · <span className="font-bold text-red-800">{f.tag}</span></li>)}</ul>
            )}
          </>
        )}
      </Section>

      {detail.incItems.length > 0 && (
        <Section title="INC subjects and deadlines">
          <ul className="space-y-3">
            {detail.incItems.map(i => (
              <li key={i.id}>
                <p><strong>{i.subject}</strong> — {i.state === "open" ? (i.deadline ? `deadline ${formatDay(i.deadline)} (${daysLeftText(daysUntil(i.deadline))})` : "Deadline: to be set at consultation") : i.state.replace(/_/g, " ")}</p>
                {i.consultationDate && <p className="text-[13.5px] text-slate-600">Consultation {formatDay(i.consultationDate)} · {i.daysGiven} days given</p>}
                {i.decisionReason && <p className="text-[13.5px] text-slate-700">Decision ({i.decision}): {i.decisionReason}</p>}
                {i.extensions.map((e, k) => <p key={k} className="text-[13.5px] text-slate-700">Deadline changed {e.oldDeadline ? `from ${formatDay(e.oldDeadline)} ` : ""}to {formatDay(e.newDeadline)} by {e.by || "staff"} on {formatDay(e.at)}: {e.reason}</p>)}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Documents">
        {(ev.required_documents ?? []).length === 0 && detail.documents.length === 0 && <p>No documents are needed for this case.</p>}
        {(ev.required_documents ?? []).map(d => <p key={d.kind}>{d.label}: {d.satisfied ? <strong className="text-green-800">uploaded</strong> : <strong className="text-amber-900">still needed</strong>}</p>)}
        {detail.documents.length > 0 && (
          <ul className="mt-2 space-y-1">
            {detail.documents.map(d => (
              <li key={d.id} className="flex flex-wrap items-center gap-2">
                <Paperclip size={14} aria-hidden="true" /> <span className="text-slate-700">{DOC_LABEL[d.kind]}:</span>
                <button onClick={() => void openFile(d.storagePath)} className="font-semibold text-[#00709f] hover:underline">{d.fileName}</button>
                <span className="text-slate-600">· {formatDay(d.uploadedAt)} · {d.status}</span>
              </li>
            ))}
          </ul>
        )}
        {fileError && <p role="alert" className="mt-2 text-red-700">{fileError}</p>}
      </Section>

      <Section title="Scholarship status history (probation history)">
        {detail.statusHistory.length === 0 ? <p>No status changes recorded yet.</p> : (
          <ul className="space-y-1">
            {detail.statusHistory.map((h, i) => (
              <li key={i}>{formatDay(h.changedAt)} — <strong>{h.status}{h.isTemporary ? " (temporary — INC)" : ""}</strong>{h.previousStatus ? ` (from ${h.previousStatus})` : ""}{h.note ? ` — ${h.note}` : ""}</li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="History of this application">
        <ol className="space-y-1.5">
          {detail.history.map((h, i) => <li key={i}><span className="font-bold text-[#062444]">{formatDateTime(h.at)}</span> — {h.actor}: {h.note || h.toStage}</li>)}
        </ol>
      </Section>

      {dialog === "endorse" && (
        <ReasonDialog title="Endorse to the Division Head" intro={<>You are endorsing {s.name} for <strong>Probationary</strong> status for {termLabelOf(r.schoolYear, r.term)} (one failed subject; study plan and consultation done). The Division Head decides; the scholar is told it was sent.</>}
          label="Note for the Division Head" required={false} confirmLabel="Endorse" onCancel={() => setDialog(null)}
          onConfirm={async note => { const x = await endorseRenewal(r.id, note); if (!x.ok) return x.error; setDialog(null); await after(); return null; }} />
      )}
      {dialog === "confirm" && (
        <ReasonDialog title="Confirm this renewal" intro={<>{s.name} will be <strong>Renewed</strong> for {termLabelOf(r.schoolYear, r.term)} and will be notified.</>}
          label="Note (kept in the history)" required={false} confirmLabel="Confirm renewal" onCancel={() => setDialog(null)}
          onConfirm={async note => { const x = await confirmRenewal(r.id, note); if (!x.ok) return x.error; setDialog(null); await after(); return null; }} />
      )}
      {dialog === "return" && (
        <ReasonDialog title="Return with comments" intro="The scholar will see your comment and can submit again." label="Comment for the scholar" confirmLabel="Return application" minLength={5} onCancel={() => setDialog(null)}
          onConfirm={async c => { const x = await returnRenewal(r.id, c); if (!x.ok) return x.error; setDialog(null); await after(); return null; }} />
      )}
      {(dialog === "accept" || dialog === "decline") && (
        <ReasonDialog title={dialog === "accept" ? "Accept the late application" : "Decline the late application"} intro="The scholar will be told your reason." label="Reason" confirmLabel={dialog === "accept" ? "Accept" : "Decline"} danger={dialog === "decline"} onCancel={() => setDialog(null)}
          onConfirm={async reason => { const x = await decideLateApplication(r.id, dialog === "accept", reason); if (!x.ok) return x.error; setDialog(null); await after(); return null; }} />
      )}
    </div>
  );
}
