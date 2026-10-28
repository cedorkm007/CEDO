import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, CheckCircle2, ChevronDown, ChevronUp, FileUp, Flag, Loader2, Paperclip, RotateCw, Trash2, XCircle } from "lucide-react";
import { RenewalStageBadge } from "@/app/components/RenewalStageBadge";
import { PushSettings } from "@/app/components/PushSettings";
import { NOTIFICATIONS_CHANGED } from "./NotificationBell";
import { ConsultationSection } from "./ConsultationSection";
import { CsrDownload } from "./CsrDownload";
import { RenewalProgressBar } from "./RenewalProgressBar";
import { SelfGradesSection } from "./SelfGradesSection";
import { useLiveReload } from "@/lib/liveUpdates";
import { StudyPlanFormLink } from "./StudyPlanFormLink";
import { buildNextSteps } from "../../renewalSummary";
import {
  DOC_ACCEPT, DOC_LABEL, daysLeftText, daysUntil, formatDateTime, formatDay, renewalBasis, renewalProgress, sdpLackingText, sdpLackingTotal, sdpReconsiderationImplication, termLabelOf,
  type DocKind, type RenewalEvaluation, type WindowState,
} from "@/lib/renewal";
import {
  applyForRenewal, deleteRenewalDocument, fetchMyRenewals, flagRenewalProblem, getRenewalDocumentUrl,
  previewMyRenewal, resubmitRenewal, uploadRenewalDocument,
  type MyRenewalOverview, type MyRenewalWindow, type RenewalDocument,
} from "../../renewalApi";

const WINDOW_NOTE: Record<WindowState, string> = {
  upcoming: "Not open yet",
  open: "Open — apply now",
  late: "Closed — you can still apply, but the evaluator has to accept a late application",
  closed: "Closed",
};

/**
 * The scholar's Renewal tile: the renewal windows, an application in three short steps (confirm details, see what the system has,
 * submit), and then a status tracker with exactly what to do next, the documents the case needs, and the history.
 * Every decision is made by the database; this screen only shows it in plain language.
 */
export function RenewalPanel() {
  const [overview, setOverview] = useState<MyRenewalOverview | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const r = await fetchMyRenewals();
    if (r.ok) { setOverview(r.overview); setError(""); } else setError(r.error);
    window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
  }, []);
  useEffect(() => { void load(); }, [load]);
  useLiveReload(load);      // the evaluator, the school or the office changed something: show it without refreshing

  if (error) return <p role="alert" className="text-[14px] text-red-700">Couldn't load your renewal: {error}</p>;
  if (!overview) return <p className="text-[14px] text-slate-600 flex items-center gap-2"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading your renewal…</p>;
  if (overview.windows.length === 0) {
    return (
      <div className="rounded-xl border border-[#e6ecf5] bg-[#f7f9fc] px-4 py-5 text-[14px] text-slate-700">
        <p className="font-bold text-[#062444] mb-1">No renewal is open right now</p>
        <p>When the CEDO office opens renewal for a term, it will appear here and you will get a notification.</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-[14px] text-slate-700">Renew your scholarship for each term, online. We check your SDP credits and grades for you.</p>
      <PushSettings variant="banner" />
      {overview.windows.map(w => <WindowCard key={w.window.id} data={w} overview={overview} onChanged={load} />)}
    </div>
  );
}

function WindowCard({ data, overview, onChanged }: { data: MyRenewalWindow; overview: MyRenewalOverview; onChanged: () => Promise<void> }) {
  const { window: w, record } = data;
  const [applying, setApplying] = useState(false);
  const basis = renewalBasis(w.schoolYear, w.term);

  return (
    <section className="rounded-xl border border-[#e6ecf5] bg-white shadow-[0_2px_10px_rgba(6,36,68,0.05)]" aria-label={`Renewal for ${termLabelOf(w.schoolYear, w.term)}`}>
      <header className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5 border-b border-[#e6ecf5]">
        <div>
          <h3 className="text-[16px] font-bold text-[#062444]">Renewal for {termLabelOf(w.schoolYear, w.term)}</h3>
          <p className="text-[13.5px] text-slate-600 mt-0.5 flex items-center gap-1.5">
            <CalendarClock size={14} aria-hidden="true" /> {formatDay(w.opensOn)} to {formatDay(w.closesOn)} · {WINDOW_NOTE[data.state]}
          </p>
          {basis && <p className="text-[13.5px] text-slate-600 mt-0.5">We check your SDP and grades for {termLabelOf(basis.schoolYear, basis.term)}.</p>}
        </div>
        {record && <RenewalStageBadge stage={record.stage} full />}
      </header>

      <div className="px-4 py-4">
        {!record && !applying && (
          <div>
            {w.note && <p className="text-[14px] text-slate-700 mb-3">{w.note}</p>}
            <button
              onClick={() => setApplying(true)} disabled={data.state === "upcoming" || data.state === "closed"}
              className="inline-flex items-center gap-2 rounded-lg bg-[#062444] px-4 py-2.5 text-[14px] font-bold text-white hover:bg-[#0a3a6e] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RotateCw size={15} aria-hidden="true" /> {data.state === "late" ? "Apply late" : "Apply for renewal"}
            </button>
            {data.state === "upcoming" && <p className="text-[13.5px] text-slate-600 mt-2">This window opens on {formatDay(w.opensOn)}.</p>}
          </div>
        )}
        {!record && applying && <ApplyFlow data={data} overview={overview} onCancel={() => setApplying(false)} onDone={async () => { setApplying(false); await onChanged(); }} />}
        {record && <Tracker data={data} overview={overview} onChanged={onChanged} />}
      </div>
    </section>
  );
}

// ── Applying: three short steps ──────────────────────────────
function ApplyFlow({ data, overview, onCancel, onDone }: { data: MyRenewalWindow; overview: MyRenewalOverview; onCancel: () => void; onDone: () => Promise<void> }) {
  const { window: w } = data;
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [school, setSchool] = useState(overview.scholar.school);
  const [program, setProgram] = useState(overview.scholar.program);
  const [yearLevel, setYearLevel] = useState(overview.scholar.yearLevel);
  const [note, setNote] = useState("");
  const [askReconsideration, setAskReconsideration] = useState(false);
  const [preview, setPreview] = useState<RenewalEvaluation | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (step !== 2 || preview) return;
    let cancelled = false;
    void previewMyRenewal(w.id).then(r => { if (cancelled) return; if (r.ok) setPreview(r.evaluation); else setPreviewError(r.error); });
    return () => { cancelled = true; };
  }, [step, preview, w.id]);

  async function submit() {
    setBusy(true); setError("");
    const r = await applyForRenewal({ windowId: w.id, school, program, yearLevel, note, requestSdpReconsideration: canAskReconsideration && askReconsideration });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    await onDone();
  }

  // A scholar who lacks SDP credits is told what is lacking and may ask for an SDP reconsideration together with the application.
  const canAskReconsideration = !!preview?.sdp?.applicable && preview.sdp.complied === false && !!preview.sdp.lacking && sdpLackingTotal(preview.sdp.lacking) > 0 && !preview.sdp.reconsideration;
  const inputCls = "w-full rounded-lg border border-[#062444]/25 px-3 py-2 text-[14px] outline-none focus:border-[#062444] bg-white";
  return (
    <div>
      <ol className="flex items-center gap-2 text-[13.5px] font-bold text-slate-700 mb-4" aria-label="Application steps">
        {["Confirm your details", "Check your SDP and grades", "Submit"].map((label, i) => (
          <li key={label} aria-current={step === i + 1 ? "step" : undefined} className={`flex items-center gap-1.5 ${step === i + 1 ? "text-[#062444]" : ""}`}>
            <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[13px] ${step === i + 1 ? "bg-[#062444] text-white" : step > i + 1 ? "bg-green-700 text-white" : "bg-slate-200 text-slate-700"}`}>{step > i + 1 ? "✓" : i + 1}</span>
            <span className="hidden sm:inline">{label}</span>
          </li>
        ))}
      </ol>

      {step === 1 && (
        <div className="space-y-3">
          <p className="text-[14px] text-slate-700">Please check that these are right. If something is wrong, correct it here — and tell us in the note on the next step.</p>
          <label className="block text-[14px] font-semibold text-[#062444]">School<input value={school} onChange={e => setSchool(e.target.value)} className={`${inputCls} mt-1 font-normal`} /></label>
          <label className="block text-[14px] font-semibold text-[#062444]">Program<input value={program} onChange={e => setProgram(e.target.value)} className={`${inputCls} mt-1 font-normal`} /></label>
          <label className="block text-[14px] font-semibold text-[#062444]">Year level<input value={yearLevel} onChange={e => setYearLevel(e.target.value)} className={`${inputCls} mt-1 font-normal`} /></label>
          <p className="text-[14px] text-slate-700">Term you are renewing for: <strong>{termLabelOf(w.schoolYear, w.term)}</strong></p>
          <div className="flex gap-2 pt-1">
            <button onClick={() => setStep(2)} disabled={!school.trim() || !program.trim() || !yearLevel.trim()} className="rounded-lg bg-[#062444] px-4 py-2 text-[14px] font-bold text-white disabled:opacity-50">Next</button>
            <button onClick={onCancel} className="rounded-lg border border-[#062444]/25 px-4 py-2 text-[14px] font-semibold text-[#062444]">Cancel</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          {previewError && <p role="alert" className="text-[14px] text-red-700">{previewError}</p>}
          {!preview && !previewError && <p className="text-[14px] text-slate-600 flex items-center gap-2"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading what we have for you…</p>}
          {preview && <EvaluationSummary ev={preview} />}
          {preview && canAskReconsideration && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-3 text-[14px] text-amber-950">
              <p className="font-bold mb-1">Your SDP is not complete</p>
              <p>Lacking: <strong>{sdpLackingText(preview.sdp!.lacking)}</strong>. Until the credits are recorded, your renewal waits on hold.</p>
              <p className="mt-1.5">You can ask for an <strong>SDP reconsideration</strong> together with this application. It is decided by the SDP reconsideration approver.</p>
              <p className="mt-1.5">{sdpReconsiderationImplication(preview)}</p>
              <label className="mt-2.5 flex cursor-pointer items-start gap-2 font-semibold">
                <input type="checkbox" checked={askReconsideration} onChange={e => setAskReconsideration(e.target.checked)} className="mt-1 h-4 w-4 shrink-0" />
                <span>Yes, I want to ask for an SDP reconsideration. I understand that if it is approved, the lacking credits are added to my SDP requirement for the next semester.</span>
              </label>
            </div>
          )}
          {preview && (preview.required_documents?.length ?? 0) > 0 && (
            <div className="rounded-lg border border-sky-200 bg-sky-50 px-3.5 py-3 text-[14px] text-sky-900">
              <p className="font-bold mb-1">Documents you will need</p>
              <ul className="list-disc pl-5">{preview.required_documents!.map(d => <li key={d.kind}>{d.label}</li>)}</ul>
              <p className="mt-1.5">You can upload them right after you submit.</p>
            </div>
          )}
          <label className="block text-[14px] font-semibold text-[#062444]">
            Something wrong? Tell the evaluator (optional)
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={1000} placeholder="For example: my Science grade should be 1.5, not 2.0." className={`${inputCls} mt-1 font-normal`} />
          </label>
          <div className="flex gap-2 pt-1">
            <button onClick={() => setStep(3)} disabled={!preview} className="rounded-lg bg-[#062444] px-4 py-2 text-[14px] font-bold text-white disabled:opacity-50">Next</button>
            <button onClick={() => setStep(1)} className="rounded-lg border border-[#062444]/25 px-4 py-2 text-[14px] font-semibold text-[#062444]">Back</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          <p className="text-[14px] text-slate-700">You are applying for renewal for <strong>{termLabelOf(w.schoolYear, w.term)}</strong>{data.state === "late" ? ". The window has closed, so the evaluator has to accept your application first." : "."}</p>
          <ul className="text-[14px] text-slate-700 list-disc pl-5">
            <li>School: {school}</li><li>Program: {program}</li><li>Year level: {yearLevel}</li>
            {note.trim() && <li>Your note: {note.trim()}</li>}
            {canAskReconsideration && askReconsideration && <li>SDP reconsideration: <strong>requested</strong> (lacking {sdpLackingText(preview?.sdp?.lacking)})</li>}
          </ul>
          {error && <p role="alert" className="text-[14px] text-red-700">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={() => void submit()} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-[#062444] px-4 py-2 text-[14px] font-bold text-white disabled:opacity-60">
              {busy && <Loader2 size={15} className="animate-spin" aria-hidden="true" />} Submit my application
            </button>
            <button onClick={() => setStep(2)} disabled={busy} className="rounded-lg border border-[#062444]/25 px-4 py-2 text-[14px] font-semibold text-[#062444]">Back</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The SDP result and the grades "as the system has them". Shared by the apply step and the tracker. */
function EvaluationSummary({ ev }: { ev: RenewalEvaluation }) {
  const sdp = ev.sdp, g = ev.grades;
  const basis = ev.basis_school_year && ev.basis_term ? termLabelOf(ev.basis_school_year, ev.basis_term) : "the previous semester";
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-[#e6ecf5] bg-[#f7f9fc] px-3.5 py-3">
        <p className="text-[14px] font-bold text-[#062444] mb-1">SDP for {basis}</p>
        {sdp && !sdp.applicable && <p className="text-[14px] text-slate-700">Summer renewal has no SDP requirement.</p>}
        {sdp?.applicable && sdp.complied && !sdp.by_reconsideration && <p className="text-[14px] text-green-800 flex items-center gap-1.5"><CheckCircle2 size={15} aria-hidden="true" /> Complied — you have the credits needed in each category.</p>}
        {sdp?.applicable && sdp.by_reconsideration && <p className="text-[14px] text-green-800 flex items-center gap-1.5"><CheckCircle2 size={15} aria-hidden="true" /> Complied through your approved SDP reconsideration.</p>}
        {sdp?.applicable && !sdp.complied && <p className="text-[14px] text-amber-900 flex items-center gap-1.5"><XCircle size={15} aria-hidden="true" /> Not complied yet — {sdp.missing ?? "some credits are missing"}.</p>}
        {sdp?.applicable && (
          <p className="text-[13.5px] text-slate-600 mt-1">Institutional Volunteerism {sdp.community_service ?? 0}/{sdp.required?.community_service ?? 3} · Community Volunteerism {sdp.community_volunteerism ?? 0}/{sdp.required?.community_volunteerism ?? 3} · Formation Program {sdp.formation_program ?? 0}/{sdp.required?.formation_program ?? 3}</p>
        )}
        {sdp?.applicable && sdp.reconsideration?.status === "pending" && (
          <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-[14px] text-amber-950"><strong>SDP reconsideration: waiting for a decision.</strong> {sdpReconsiderationImplication(ev)}</p>
        )}
        {sdp?.applicable && sdp.reconsideration?.status === "approved" && (
          <p className="mt-2 rounded-md border border-green-300 bg-green-50 px-2.5 py-2 text-[14px] text-green-950"><strong>SDP reconsideration approved{sdp.reconsideration.decided_at ? ` on ${formatDay(sdp.reconsideration.decided_at)}` : ""}.</strong> The credits that were lacking ({sdpLackingText(sdp.reconsideration.lacking)}) are added to your SDP requirement for {sdp.next_school_year && sdp.next_semester ? termLabelOf(sdp.next_school_year, sdp.next_semester) : "the next semester"}.{sdp.reconsideration.note ? ` Note: ${sdp.reconsideration.note}` : ""}</p>
        )}
        {sdp?.applicable && sdp.reconsideration?.status === "denied" && (
          <p className="mt-2 rounded-md border border-red-300 bg-red-50 px-2.5 py-2 text-[14px] text-red-950"><strong>SDP reconsideration was not approved.</strong>{sdp.reconsideration.note ? ` Reason: ${sdp.reconsideration.note}` : ""} Your renewal stays on hold until the missing credits are recorded.</p>
        )}
      </div>
      <div className="rounded-lg border border-[#e6ecf5] bg-[#f7f9fc] px-3.5 py-3">
        <p className="text-[14px] font-bold text-[#062444] mb-1">Grades for {basis}</p>
        {g?.self_reported && <p className="text-[14px] text-green-900 mb-1">These are the grades you entered, approved by the Grades Approver. They count until your school uploads its own.</p>}
        {g && g.state !== "ready" && <p className="text-[14px] text-slate-700">{g.reason}</p>}
        {g && g.state === "ready" && (
          <>
            <p className="text-[14px] text-slate-700">{g.counts.total} subject{g.counts.total === 1 ? "" : "s"}: {g.counts.passed} passed{g.counts.failed ? `, ${g.counts.failed} failed` : ""}{g.counts.inc ? `, ${g.counts.inc} INC` : ""}{g.counts.review ? `, ${g.counts.review} to review` : ""}.</p>
            {[...g.failed_subjects.map(s => ({ ...s, tag: s.outcome === "drp" ? "DRP (counts as failed)" : "Failed" })), ...g.inc_subjects.map(s => ({ ...s, tag: "INC" }))].length > 0 && (
              <ul className="mt-1 text-[14px] text-slate-700">
                {[...g.failed_subjects.map(s => ({ ...s, tag: s.outcome === "drp" ? "DRP (counts as failed)" : "Failed" })), ...g.inc_subjects.map(s => ({ ...s, tag: "INC" }))].map(s => (
                  <li key={s.code + s.tag}><strong>{s.subject}</strong> — {s.grade} <span className="font-bold text-red-800">({s.tag})</span></li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── After applying: the tracker ──────────────────────────────
function Tracker({ data, overview, onChanged }: { data: MyRenewalWindow; overview: MyRenewalOverview; onChanged: () => Promise<void> }) {
  const record = data.record!;
  const ev = record.evaluation;
  const [showHistory, setShowHistory] = useState(false);
  const [note, setNote] = useState("");
  const [flagging, setFlagging] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const openInc = data.incItems.filter(i => i.state === "open");
  const progress = useMemo(() => renewalProgress(record.stage, ev, { consultState: data.consultState, hasBooking: data.booking !== null, incOpen: openInc.length > 0 }),
    [record.stage, ev, data.consultState, data.booking, openInc.length]);
  const steps = useMemo(() => buildNextSteps(data), [data]);

  async function flag() {
    setBusy(true); setMessage(null);
    const r = await flagRenewalProblem(record.id, note);
    setBusy(false);
    if (!r.ok) { setMessage({ ok: false, text: r.error }); return; }
    setMessage({ ok: true, text: "Thank you — the evaluator will see your note." }); setNote(""); setFlagging(false); await onChanged();
  }
  async function resubmit() {
    setBusy(true); setMessage(null);
    const r = await resubmitRenewal(record.id, note);
    setBusy(false);
    if (!r.ok) { setMessage({ ok: false, text: r.error }); return; }
    setNote(""); await onChanged();
  }

  const canFlag = !["renewed", "removed", "reconsidered", "division_head_approved", "late_declined", "not_required"].includes(record.stage);
  return (
    <div className="space-y-4">
      <RenewalProgressBar steps={progress} />
      <div className="rounded-xl border-2 border-[#062444] bg-white px-4 py-4" aria-label="Your next step">
        <p className="text-[13px] font-bold uppercase tracking-wide text-[#006aa3]">Your next step</p>
        <p className="mt-1 text-[17px] font-bold leading-snug text-[#062444]">{steps[0]}</p>
        {steps.length > 1 && (
          <>
            <p className="mt-3 text-[14px] font-semibold text-slate-800">Then:</p>
            <ul className="mt-1 list-disc pl-5 text-[14px] text-slate-800 space-y-1">{steps.slice(1).map((s, i) => <li key={i}>{s}</li>)}</ul>
          </>
        )}
        {record.stage === "returned" && (
          <div className="mt-3">
            <label className="block text-[14px] font-semibold text-[#062444]">A note for the evaluator (optional)
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={1000} className="mt-1 w-full rounded-lg border border-[#062444]/25 px-3 py-2 text-[14px] font-normal outline-none focus:border-[#062444] bg-white" />
            </label>
            <button onClick={() => void resubmit()} disabled={busy} className="mt-2 inline-flex items-center gap-2 rounded-lg bg-[#062444] px-4 py-2 text-[14px] font-bold text-white disabled:opacity-60">
              {busy && <Loader2 size={15} className="animate-spin" aria-hidden="true" />} Submit again
            </button>
          </div>
        )}
      </div>

      {record.stage === "renewed" && <CsrDownload recordId={record.id} />}

      <ConsultationSection data={data} onChanged={onChanged} />

      {record.isLate && record.stage !== "late_pending" && record.lateReason && <p className="text-[14px] text-slate-700">Late application: {record.lateReason}</p>}
      {ev.grades && ev.sdp && record.stage !== "late_pending" && <EvaluationSummary ev={ev} />}
      {ev.grades && record.stage !== "late_pending" && canFlag && <SelfGradesSection record={record} ev={ev} scholarIdNumber={overview.scholar.scholarIdNumber} onChanged={onChanged} />}
      {record.ruleText && !["late_pending", "waiting_grades", "sdp_on_hold"].includes(record.stage) && (
        <p className="text-[14px] text-slate-700"><strong className="text-[#062444]">How your case is handled:</strong> {record.ruleText}</p>
      )}

      {openInc.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-3 text-[14px] text-amber-950">
          <p className="font-bold mb-1">Your INC subject{openInc.length > 1 ? "s" : ""} (temporary probation)</p>
          <ul>{openInc.map(i => <li key={i.id}><strong>{i.subject}</strong> — {i.deadline ? `deadline ${formatDay(i.deadline)} (${daysLeftText(daysUntil(i.deadline))})` : "Deadline: to be set at consultation"}</li>)}</ul>
        </div>
      )}

      <DocumentsSection data={data} overview={overview} onChanged={onChanged} />

      {canFlag && (
        <div>
          {!flagging ? (
            <button onClick={() => setFlagging(true)} className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-[#00709f] hover:underline"><Flag size={14} aria-hidden="true" /> Something doesn't look right? Tell the evaluator</button>
          ) : (
            <div>
              <label className="block text-[14px] font-semibold text-[#062444]">Describe the problem
                <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={1000} className="mt-1 w-full rounded-lg border border-[#062444]/25 px-3 py-2 text-[14px] font-normal outline-none focus:border-[#062444] bg-white" />
              </label>
              <div className="mt-2 flex gap-2">
                <button onClick={() => void flag()} disabled={busy || note.trim().length < 5} className="rounded-lg bg-[#062444] px-4 py-2 text-[14px] font-bold text-white disabled:opacity-50">Send note</button>
                <button onClick={() => { setFlagging(false); setNote(""); }} className="rounded-lg border border-[#062444]/25 px-4 py-2 text-[14px] font-semibold text-[#062444]">Cancel</button>
              </div>
            </div>
          )}
          {record.scholarNote && !flagging && <p className="text-[14px] text-slate-700 mt-2">Your note to the evaluator: “{record.scholarNote}”</p>}
        </div>
      )}
      {message && <p role={message.ok ? "status" : "alert"} className={`text-[14px] ${message.ok ? "text-green-800" : "text-red-700"}`}>{message.text}</p>}

      <div>
        <button onClick={() => setShowHistory(v => !v)} aria-expanded={showHistory} className="inline-flex items-center gap-1 text-[14px] font-semibold text-[#00709f] hover:underline">
          {showHistory ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />} {showHistory ? "Hide" : "Show"} history
        </button>
        {showHistory && (
          <ol className="mt-2 space-y-2 border-l-2 border-[#e6ecf5] pl-4">
            {data.history.map((h, i) => (
              <li key={i} className="text-[14px] text-slate-700"><span className="font-bold text-[#062444]">{formatDateTime(h.at)}</span> — {h.actor}{h.note ? `: ${h.note}` : ""}</li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

// ── Documents ────────────────────────────────────────────────
function DocumentsSection({ data, overview, onChanged }: { data: MyRenewalWindow; overview: MyRenewalOverview; onChanged: () => Promise<void> }) {
  const record = data.record!;
  const required = record.evaluation.required_documents ?? [];
  const [busyKind, setBusyKind] = useState<DocKind | null>(null);
  const [error, setError] = useState("");
  const refs = useRef<Partial<Record<DocKind, HTMLInputElement | null>>>({});
  const editable = !["renewed", "removed", "reconsidered", "division_head_approved", "late_declined", "not_required", "late_pending"].includes(record.stage);

  if (required.length === 0 && data.documents.length === 0) return null;

  async function onPick(kind: DocKind, file: File | undefined) {
    if (!file) return;
    setBusyKind(kind); setError("");
    const r = await uploadRenewalDocument({ file, scholarIdNumber: overview.scholar.scholarIdNumber, recordId: record.id, kind, existingOfKind: data.documents.filter(d => d.kind === kind).length });
    setBusyKind(null);
    if (refs.current[kind]) refs.current[kind]!.value = "";
    if (!r.ok) { setError(r.error); return; }
    await onChanged();
  }
  async function remove(doc: RenewalDocument) {
    setError("");
    const r = await deleteRenewalDocument(doc);
    if (!r.ok) { setError(r.error); return; }
    await onChanged();
  }
  async function open(doc: RenewalDocument) {
    const r = await getRenewalDocumentUrl(doc.storagePath);
    if (r.ok) window.open(r.url, "_blank", "noopener"); else setError(r.error);
  }

  return (
    <div>
      <h4 className="text-[14px] font-bold text-[#062444] mb-2">Your documents</h4>
      <ul className="space-y-3">
        {required.map(req => {
          const files = data.documents.filter(d => d.kind === req.kind);
          return (
            <li key={req.kind} className="rounded-lg border border-[#e6ecf5] px-3.5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[14px] font-semibold text-[#062444]">{req.label} {!req.satisfied ? <span className="text-amber-900 font-bold">— needed</span> : (req.kind === "study_plan" || req.kind === "inc_letter") && !req.approved ? <span className="text-sky-900 font-bold">— uploaded, waiting for approval</span> : <span className="text-green-800 font-bold">— {req.kind === "study_plan" || req.kind === "inc_letter" ? "approved" : "uploaded"} ✓</span>}</p>
                {editable && (
                  <>
                    <input ref={el => { refs.current[req.kind] = el; }} type="file" accept={DOC_ACCEPT} className="sr-only" id={`up-${req.kind}`} aria-label={`Upload ${DOC_LABEL[req.kind]}`} onChange={e => void onPick(req.kind, e.target.files?.[0])} />
                    <label htmlFor={`up-${req.kind}`} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#062444]/25 px-3 py-1.5 text-[14px] font-semibold text-[#062444] hover:bg-[#f7f9fc]">
                      {busyKind === req.kind ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <FileUp size={14} aria-hidden="true" />} {files.length ? "Add another file" : "Upload file"}
                    </label>
                  </>
                )}
              </div>
              {req.kind === "study_plan" && <StudyPlanFormLink />}
              {files.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {files.map(f => (
                    <li key={f.id} className="flex flex-wrap items-center gap-2 text-[14px] text-slate-700">
                      <Paperclip size={14} aria-hidden="true" />
                      <button onClick={() => void open(f)} className="font-semibold text-[#00709f] hover:underline">{f.fileName}</button>
                      <span>· {f.status === "accepted" ? "accepted" : f.status === "returned" ? "returned — please upload a new one" : "received"}</span>
                      {f.reviewerComment && <span>· “{f.reviewerComment}”</span>}
                      {editable && f.status !== "accepted" && <button onClick={() => void remove(f)} aria-label={`Remove ${f.fileName}`} className="ml-auto inline-flex items-center gap-1 text-red-700 hover:underline"><Trash2 size={13} aria-hidden="true" /> Remove</button>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p role="alert" className="mt-2 text-[14px] text-red-700">{error}</p>}
      <p className="mt-2 text-[13.5px] text-slate-600">PDF, Word, JPG, PNG or WebP · up to 10 MB each · up to 3 files per document.</p>
    </div>
  );
}
