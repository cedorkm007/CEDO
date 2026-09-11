import { useState } from "react";
import { Plus, Trash2, Upload, FileText } from "lucide-react";
import {
  submitPostApprovalStageForm, STAGE_LABELS, MAX_DISSEMINATION_EVIDENCE, MAX_UTILIZATION_CERTIFICATES,
  type ResearchProject, type StageSubmission, type PostApprovalStageKey,
  type EvidenceFile, type ObjectiveEvidenceItem, type ImplementationFormData,
  type ObjectiveResultItem, type MonitoringFormData,
  type EvidenceListItem, type DisseminationFormData, type UtilizationFormData,
  type PreservationFormData, type InstitutionalLearningFormData,
} from "../researchProjectApi";
import { uploadEvidenceFile, removeEvidenceFile, fetchEvidencePreviewUrl } from "../researchEvidenceApi";
import { ModalShell } from "./SeadUiShell";

const DOC_ACCEPT = ".pdf,.doc,.docx,.jpg,.jpeg,.png";
const DOC_TYPES = [
  "application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg", "image/png",
];
const CERT_ACCEPT = ".pdf,.jpg,.jpeg,.png";
const CERT_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const SUMMARY_ACCEPT = ".pdf,.doc,.docx";
const SUMMARY_TYPES = ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];

const STAGE_FORM_TITLES: Record<PostApprovalStageKey, string> = {
  implementation: "Implementation — Evidence per Objective",
  monitoring: "Monitoring — Results & Insights",
  dissemination: "Dissemination — Presentation/Publication Evidence",
  utilization: "Utilization — Certificate of Utilization",
  preservation: "Preservation — Executive Summary",
  institutional_learning: "Institutional Learning — Way Forward",
};

function FLabel({ label, required }: { label: string; required?: boolean }) {
  return <label className="block text-[12px] font-semibold text-slate-500 mb-1.5">{label}{required && <span className="text-red-400 ml-1">*</span>}</label>;
}
function FTextarea({ value, onChange, placeholder, rows = 3 }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows}
    className="w-full border border-[#062444]/15 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-[#0088cc] bg-white resize-none" />;
}

function FileField({
  label, file, onChange, accept, allowedTypes, projectId, stage, evidenceId,
}: {
  label: string; file: EvidenceFile | null; onChange: (f: EvidenceFile | null) => void;
  accept: string; allowedTypes: string[]; projectId: string; stage: PostApprovalStageKey; evidenceId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    setBusy(true);
    setError("");
    const result = await uploadEvidenceFile(projectId, stage, evidenceId, picked, allowedTypes);
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    onChange(result.evidence);
  }
  async function handleView() {
    if (!file) return;
    const url = await fetchEvidencePreviewUrl(file);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }
  async function handleRemove() {
    if (!file) return;
    setBusy(true);
    await removeEvidenceFile(file);
    setBusy(false);
    onChange(null);
  }

  return (
    <div>
      <FLabel label={label} required />
      {file ? (
        <div className="flex items-center gap-2 text-[12.5px] bg-slate-50 border border-gray-200 rounded-lg px-3 py-2">
          <FileText size={14} className="text-[#0088cc] shrink-0" />
          <span className="truncate flex-1 text-gray-700">{file.fileName}</span>
          <button type="button" onClick={handleView} className="text-[#0088cc] font-semibold hover:underline shrink-0">View</button>
          <button type="button" onClick={handleRemove} disabled={busy} className="text-red-400 hover:text-red-600 shrink-0"><Trash2 size={14} /></button>
        </div>
      ) : (
        <label className="flex items-center gap-1.5 text-[12px] font-semibold text-[#0088cc] cursor-pointer w-fit">
          <Upload size={13} /> {busy ? "Uploading…" : "Choose file"}
          <input type="file" accept={accept} onChange={handlePick} disabled={busy} className="hidden" />
        </label>
      )}
      {error && <p className="text-[11px] text-red-500 mt-1">{error}</p>}
    </div>
  );
}

function hydrateObjectiveRows<T extends { objectiveText: string }>(
  objectives: string[], existing: T[] | undefined, blank: (objectiveText: string) => T,
): T[] {
  if (existing && existing.length === objectives.length) return existing;
  return objectives.map(blank);
}

export function PostApprovalStageFormModal({
  project, stage, existingSubmission, objectives, dataAnalysis, onClose, onSaved,
}: {
  project: ResearchProject;
  stage: PostApprovalStageKey;
  existingSubmission: StageSubmission | null;
  objectives: string[];
  dataAnalysis: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const existingData = existingSubmission?.formData as Record<string, unknown> | undefined;

  const [implEvidence, setImplEvidence] = useState<ObjectiveEvidenceItem[]>(() =>
    hydrateObjectiveRows(objectives, (existingData as Partial<ImplementationFormData> | undefined)?.evidence,
      objectiveText => ({ objectiveText, description: "", file: null })));

  const [monResults, setMonResults] = useState<ObjectiveResultItem[]>(() =>
    hydrateObjectiveRows(objectives, (existingData as Partial<MonitoringFormData> | undefined)?.results,
      objectiveText => ({ objectiveText, results: "", insights: "" })));
  const [overallConclusion, setOverallConclusion] = useState((existingData as Partial<MonitoringFormData> | undefined)?.overallConclusion ?? "");

  const [dissEvidence, setDissEvidence] = useState<EvidenceListItem[]>(
    (existingData as Partial<DisseminationFormData> | undefined)?.evidence?.length
      ? (existingData as Partial<DisseminationFormData>).evidence!
      : [{ id: crypto.randomUUID(), description: "", file: null }]);

  const [certificates, setCertificates] = useState<EvidenceListItem[]>(
    (existingData as Partial<UtilizationFormData> | undefined)?.certificates?.length
      ? (existingData as Partial<UtilizationFormData>).certificates!
      : [{ id: crypto.randomUUID(), description: "", file: null }]);

  const [summaryFile, setSummaryFile] = useState<EvidenceFile | null>((existingData as Partial<PreservationFormData> | undefined)?.file ?? null);
  const [wayForward, setWayForward] = useState((existingData as Partial<InstitutionalLearningFormData> | undefined)?.wayForward ?? "");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function validate(): string | null {
    switch (stage) {
      case "implementation":
        return implEvidence.some(r => !r.description.trim() || !r.file) ? "Add a description and evidence file for every objective." : null;
      case "monitoring":
        return monResults.some(r => !r.results.trim() || !r.insights.trim()) || !overallConclusion.trim()
          ? "Fill in the results and insights for every objective, and the overall conclusion." : null;
      case "dissemination":
        return dissEvidence.some(r => !r.description.trim() || !r.file) ? "Add a description and evidence file for every row." : null;
      case "utilization":
        return certificates.some(r => !r.description.trim() || !r.file) ? "Add a description and certificate file for every row." : null;
      case "preservation":
        return summaryFile ? null : "Upload the executive summary.";
      case "institutional_learning":
        return wayForward.trim() ? null : "Describe the way forward / future plans.";
    }
  }

  function dataFor(): Record<string, unknown> {
    switch (stage) {
      case "implementation": return { evidence: implEvidence } satisfies ImplementationFormData;
      case "monitoring": return { results: monResults, overallConclusion: overallConclusion.trim() } satisfies MonitoringFormData;
      case "dissemination": return { evidence: dissEvidence } satisfies DisseminationFormData;
      case "utilization": return { certificates } satisfies UtilizationFormData;
      case "preservation": return { file: summaryFile } satisfies PreservationFormData;
      case "institutional_learning": return { wayForward: wayForward.trim() } satisfies InstitutionalLearningFormData;
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const validationError = validate();
    if (validationError) { setError(validationError); return; }
    setError("");
    setBusy(true);
    const result = await submitPostApprovalStageForm(project.id, stage, existingSubmission?.id ?? null, dataFor());
    setBusy(false);
    if (!result.ok) { setError(result.error || "Failed to save."); return; }
    onSaved();
  }

  return (
    <ModalShell title={STAGE_FORM_TITLES[stage]} onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-[12px] text-slate-400">{project.title} — currently in {STAGE_LABELS[stage]}</p>

        {stage === "implementation" && implEvidence.map((row, i) => (
          <div key={i} className="border border-gray-200 rounded-xl p-3.5 space-y-2.5">
            <p className="text-[12.5px] font-bold text-[#062444]">Objective {i + 1}: <span className="font-normal text-gray-600">{row.objectiveText}</span></p>
            <div>
              <FLabel label="Description" required />
              <FTextarea rows={2} value={row.description} onChange={v => setImplEvidence(rows => rows.map((r, idx) => idx === i ? { ...r, description: v } : r))} placeholder="What does this evidence show?" />
            </div>
            <FileField label="Evidence File" file={row.file} onChange={f => setImplEvidence(rows => rows.map((r, idx) => idx === i ? { ...r, file: f } : r))}
              accept={DOC_ACCEPT} allowedTypes={DOC_TYPES} projectId={project.id} stage={stage} evidenceId={row.file?.id ?? crypto.randomUUID()} />
          </div>
        ))}

        {stage === "monitoring" && (
          <>
            {dataAnalysis.length > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5">
                <p className="text-[10.5px] font-bold text-blue-700 uppercase tracking-wide mb-1">Proposed Analysis Techniques</p>
                <p className="text-[12px] text-blue-800">{dataAnalysis.join(", ")}</p>
              </div>
            )}
            {monResults.map((row, i) => (
              <div key={i} className="border border-gray-200 rounded-xl p-3.5 space-y-2.5">
                <p className="text-[12.5px] font-bold text-[#062444]">Objective {i + 1}: <span className="font-normal text-gray-600">{row.objectiveText}</span></p>
                <div>
                  <FLabel label="Results" required />
                  <FTextarea value={row.results} onChange={v => setMonResults(rows => rows.map((r, idx) => idx === i ? { ...r, results: v } : r))} placeholder="Report the results for this objective…" />
                </div>
                <div>
                  <FLabel label="Insights / Findings" required />
                  <FTextarea value={row.insights} onChange={v => setMonResults(rows => rows.map((r, idx) => idx === i ? { ...r, insights: v } : r))} placeholder="What do the results mean?" />
                </div>
              </div>
            ))}
            <div>
              <FLabel label="Overall Conclusion" required />
              <FTextarea rows={4} value={overallConclusion} onChange={setOverallConclusion} placeholder="Conclusion for the research as a whole…" />
            </div>
          </>
        )}

        {stage === "dissemination" && (
          <>
            <div className="flex items-center justify-between">
              <FLabel label="Evidence" required />
              {dissEvidence.length < MAX_DISSEMINATION_EVIDENCE && (
                <button type="button" onClick={() => setDissEvidence(rows => [...rows, { id: crypto.randomUUID(), description: "", file: null }])}
                  className="flex items-center gap-1 text-[12px] font-semibold text-[#0088cc] hover:underline">
                  <Plus size={13} /> Add evidence
                </button>
              )}
            </div>
            {dissEvidence.map((row, i) => (
              <div key={row.id} className="border border-gray-200 rounded-xl p-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-[12px] font-bold text-[#062444]">Item {i + 1}</p>
                  {dissEvidence.length > 1 && (
                    <button type="button" onClick={() => setDissEvidence(rows => rows.filter((_, idx) => idx !== i))} className="text-slate-300 hover:text-red-500"><Trash2 size={14} /></button>
                  )}
                </div>
                <div>
                  <FLabel label="Description" required />
                  <FTextarea rows={2} value={row.description} onChange={v => setDissEvidence(rows => rows.map((r, idx) => idx === i ? { ...r, description: v } : r))} placeholder="Presentation/publication details…" />
                </div>
                <FileField label="Evidence File" file={row.file} onChange={f => setDissEvidence(rows => rows.map((r, idx) => idx === i ? { ...r, file: f } : r))}
                  accept={DOC_ACCEPT} allowedTypes={DOC_TYPES} projectId={project.id} stage={stage} evidenceId={row.id} />
              </div>
            ))}
          </>
        )}

        {stage === "utilization" && (
          <>
            <div className="flex items-center justify-between">
              <FLabel label="Certificates of Utilization" required />
              {certificates.length < MAX_UTILIZATION_CERTIFICATES && (
                <button type="button" onClick={() => setCertificates(rows => [...rows, { id: crypto.randomUUID(), description: "", file: null }])}
                  className="flex items-center gap-1 text-[12px] font-semibold text-[#0088cc] hover:underline">
                  <Plus size={13} /> Add certificate
                </button>
              )}
            </div>
            {certificates.map((row, i) => (
              <div key={row.id} className="border border-gray-200 rounded-xl p-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-[12px] font-bold text-[#062444]">Item {i + 1}</p>
                  {certificates.length > 1 && (
                    <button type="button" onClick={() => setCertificates(rows => rows.filter((_, idx) => idx !== i))} className="text-slate-300 hover:text-red-500"><Trash2 size={14} /></button>
                  )}
                </div>
                <div>
                  <FLabel label="Issued By (stakeholder/end-user)" required />
                  <FTextarea rows={2} value={row.description} onChange={v => setCertificates(rows => rows.map((r, idx) => idx === i ? { ...r, description: v } : r))} placeholder="Who issued this certificate?" />
                </div>
                <FileField label="Certificate File" file={row.file} onChange={f => setCertificates(rows => rows.map((r, idx) => idx === i ? { ...r, file: f } : r))}
                  accept={CERT_ACCEPT} allowedTypes={CERT_TYPES} projectId={project.id} stage={stage} evidenceId={row.id} />
              </div>
            ))}
          </>
        )}

        {stage === "preservation" && (
          <FileField label="Executive Summary" file={summaryFile} onChange={setSummaryFile}
            accept={SUMMARY_ACCEPT} allowedTypes={SUMMARY_TYPES} projectId={project.id} stage={stage} evidenceId={summaryFile?.id ?? crypto.randomUUID()} />
        )}

        {stage === "institutional_learning" && (
          <div>
            <FLabel label="Way Forward / Future Plans" required />
            <FTextarea rows={5} value={wayForward} onChange={setWayForward} placeholder="What's next after this project's completion?" />
          </div>
        )}

        {error && <p className="text-[13px] text-red-600">{error}</p>}

        <div className="flex justify-end">
          <button type="submit" disabled={busy}
            className="bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-60 text-white text-[13px] font-semibold rounded-lg px-5 py-2.5">
            {busy ? "Submitting…" : "Submit for Review"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
