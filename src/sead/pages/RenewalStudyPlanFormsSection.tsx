import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Eye, FileText, Loader2, Trash2, Upload } from "lucide-react";
import {
  fetchStudyPlanFormSetup, fetchStudyPlanTemplateUrl, removeStudyPlanTemplate, uploadStudyPlanTemplate,
  type StudyPlanTemplate,
} from "../studyPlanFormsApi";

/**
 * "Renewal study plan": ONE generic blank study plan form for every scholar (there is no study plan per school). Staff upload it here with one button
 * (PDF or Word, up to 10 MB) and every scholar can download it from the Renewal tile at any time, even before applying, always named "Study Plan Form".
 * It is kept as the "default" template. A template that was uploaded earlier for one single school is removed when the new form is uploaded, so that no
 * scholar gets an older, school-specific one instead.
 */
export function RenewalStudyPlanFormsSection() {
  const [templates, setTemplates] = useState<StudyPlanTemplate[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    const setup = await fetchStudyPlanFormSetup();
    if (!setup.ok) { setError(setup.error); setLoading(false); return; }
    setTemplates(setup.templates); setError(""); setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const template = templates.find(t => t.schoolId === null) ?? null;
  const leftovers = templates.filter(t => t.schoolId !== null);      // uploaded per school before: no longer used

  async function upload(_schoolId: string | null, file: File | undefined) {
    if (!file) return;
    setBusy(true); setSaved(false); setError(""); setConfirming(false);
    const r = await uploadStudyPlanTemplate(null, file);
    if (!r.ok) { setBusy(false); setError(r.error); return; }
    for (const old of leftovers) await removeStudyPlanTemplate(old.schoolId);      // one generic form: no school keeps an older one of its own
    await load();
    setBusy(false); setSaved(true);
  }
  async function remove() {
    setBusy(true); setSaved(false); setError(""); setConfirming(false);
    const r = await removeStudyPlanTemplate(null);
    if (!r.ok) { setBusy(false); setError(r.error); return; }
    await load();
    setBusy(false);
  }
  async function view(t: StudyPlanTemplate) {
    setError("");
    const url = await fetchStudyPlanTemplateUrl(t.storagePath);
    if (!url) { setError("Couldn't open that file right now. Please try again."); return; }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-[15px] font-extrabold text-[#062444]">Renewal study plan form</h2>
        <p className="mt-1 text-[14px] text-slate-700">
          There is one study plan form for all scholars. Upload it with the button below (PDF or Word, up to 10 MB). Every scholar can download it from their Renewal tile at any time,
          even before applying, always named <strong>Study Plan Form</strong>. Uploading a new file replaces the old one.
        </p>
      </div>
      {error && <p role="alert" className="mb-3 text-[14px] text-red-700">{error}</p>}
      {loading ? <p className="text-[14px] text-slate-700">Loading…</p> : (
        <ul className="space-y-2.5">
          <TemplateRow rowKey="default" schoolId={null} label="Study plan form (all scholars)" note={template ? "Scholars download this file." : "No study plan form yet: scholars see a message that it is not ready."}
            template={template} busy={busy} saved={saved} confirming={confirming}
            onUpload={upload} onRemove={() => void remove()} onView={view} onAskRemove={k => setConfirming(k !== null)} />
        </ul>
      )}
    </div>
  );
}

interface RowProps {
  rowKey: string; schoolId: string | null; label: string; note: string; template: StudyPlanTemplate | null;
  busy: boolean; saved: boolean; confirming: boolean;
  onUpload: (schoolId: string | null, file: File | undefined) => void; onRemove: (schoolId: string | null) => void;
  onView: (t: StudyPlanTemplate) => void; onAskRemove: (key: string | null) => void;
}

function TemplateRow({ rowKey, schoolId, label, note, template, busy, saved, confirming, onUpload, onRemove, onView, onAskRemove }: RowProps) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const inputId = `spt-${rowKey}`;
  const uploaded = template ? new Date(template.updatedAt).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }) : "";

  return (
    <li className="rounded-xl border border-[#e6ecf5] bg-white px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14px] font-bold text-[#062444]">{label}</p>
          <p className="text-[13.5px] text-slate-700">{note}</p>
        </div>
        {saved && <span className="flex items-center gap-1 text-[14px] font-semibold text-green-800"><CheckCircle2 size={14} aria-hidden="true" /> Saved</span>}
      </div>

      <input ref={input} id={inputId} type="file" className="sr-only" tabIndex={-1} accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        aria-label={`Study plan template file for ${label}`}
        onChange={e => { onUpload(schoolId, e.target.files?.[0]); e.target.value = ""; }} />

      {template ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-[#f7f9fc] px-3 py-2">
          <span className="flex min-w-0 items-center gap-1.5 text-[14px] text-[#062444]">
            <FileText size={15} className="shrink-0" aria-hidden="true" />
            <span className="break-all font-semibold">{template.fileName}</span>
            <span className="text-slate-700">· uploaded {uploaded}</span>
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => onView(template)} className="inline-flex items-center gap-1.5 rounded-lg border border-[#062444]/25 bg-white px-3 py-1.5 text-[14px] font-semibold text-[#062444] hover:bg-[#f7f9fc]">
              <Eye size={14} aria-hidden="true" /> View<span className="sr-only"> template for {label}</span>
            </button>
            <button type="button" onClick={() => input.current?.click()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-[#062444]/25 bg-white px-3 py-1.5 text-[14px] font-semibold text-[#062444] hover:bg-[#f7f9fc] disabled:opacity-60">
              {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Upload size={14} aria-hidden="true" />} Replace<span className="sr-only"> template for {label}</span>
            </button>
            {confirming ? (
              <span className="flex items-center gap-2 text-[14px]" role="group" aria-label={`Remove the template for ${label}?`}>
                <span className="font-semibold text-red-800">Remove it?</span>
                <button type="button" onClick={() => onRemove(schoolId)} className="rounded-lg bg-red-700 px-3 py-1.5 text-[14px] font-semibold text-white hover:bg-red-800">Yes, remove</button>
                <button type="button" onClick={() => onAskRemove(null)} className="rounded-lg border border-[#062444]/25 bg-white px-3 py-1.5 text-[14px] font-semibold text-[#062444]">Keep it</button>
              </span>
            ) : (
              <button type="button" onClick={() => onAskRemove(rowKey)} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[14px] font-semibold text-red-800 hover:bg-red-50 disabled:opacity-60">
                <Trash2 size={14} aria-hidden="true" /> Remove<span className="sr-only"> template for {label}</span>
              </button>
            )}
          </span>
        </div>
      ) : (
        <button type="button" onClick={() => input.current?.click()} disabled={busy}
          onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); onUpload(schoolId, e.dataTransfer.files?.[0]); }}
          className={`mt-2.5 flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-3 text-[14px] font-semibold text-[#062444] transition-colors disabled:opacity-60 ${dragging ? "border-[#062444] bg-[#eef3fb]" : "border-[#062444]/30 hover:bg-[#f7f9fc]"}`}>
          {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Upload size={16} aria-hidden="true" />}
          {busy ? "Uploading…" : "Upload the study plan form"}<span className="sr-only"> for {label}</span>
        </button>
      )}
    </li>
  );
}
