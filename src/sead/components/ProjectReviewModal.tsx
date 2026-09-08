import { useState } from "react";
import { X, CheckCircle2, AlertCircle } from "lucide-react";
import {
  reviewStageSubmission, STAGE_LABELS,
  type ResearchProject, type StageSubmission, type ProposalDevelopmentFormData,
} from "../researchProjectApi";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === "" || value === null || value === undefined) return null;
  return (
    <div className="mb-2.5">
      <p className="text-[10.5px] font-bold text-slate-400 uppercase tracking-wide mb-0.5">{label}</p>
      <div className="text-[13px] text-[#062444] whitespace-pre-wrap">{value}</div>
    </div>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="bg-[#062444] text-[#F3BC00] font-bold text-xs px-3 py-1.5 rounded-lg inline-block mb-3 uppercase tracking-wide">{title}</div>
      {children}
    </div>
  );
}
function Pills({ items }: { items: string[] }) {
  if (items.length === 0) return <span className="text-slate-400 text-[12.5px]">None selected</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map(i => <span key={i} className="text-[11.5px] bg-slate-100 text-slate-600 rounded-full px-2.5 py-0.5">{i}</span>)}
    </div>
  );
}

function ProposalDevelopmentReadout({ data }: { data: ProposalDevelopmentFormData }) {
  return (
    <>
      <Field label="Statement of the Problem" value={data.statementOfProblem} />
      <Field label="Main Objective" value={data.mainObjective} />
      <Field label="Specific Objectives" value={data.objectives.map((o, i) => `${i + 1}. ${o.text}`).join("\n")} />

      <p className="text-[10.5px] font-bold text-slate-400 uppercase tracking-wide mb-1 mt-3">Methodology</p>
      <Field label="Approach" value={data.methodology.approach} />
      <Field label="Design" value={data.methodology.design} />
      <Field label="Population" value={data.methodology.population} />
      <Field label="Sampling" value={data.methodology.sampling} />
      <p className="text-[10.5px] font-bold text-slate-400 uppercase tracking-wide mb-1 mt-2">Data Sources</p>
      <Pills items={data.methodology.dataSources} />
      <p className="text-[10.5px] font-bold text-slate-400 uppercase tracking-wide mb-1 mt-2">Data Collection Methods</p>
      <Pills items={data.methodology.dataCollectionMethods} />
      <p className="text-[10.5px] font-bold text-slate-400 uppercase tracking-wide mb-1 mt-2">Data Analysis</p>
      <Pills items={data.methodology.dataAnalysis} />

      <Field label="Timeframe" value={data.workPlanStart && data.workPlanEnd ? `${data.workPlanStart} to ${data.workPlanEnd}` : ""} />
      <Field label="Work Plan Activities" value={data.workPlanActivities.map(a => `${a.activity} (${a.days} day(s)) — ${a.deliverable}`).join("\n")} />

      <Field label="Total Budget" value={data.budgetTotal ? `₱${data.budgetTotal}` : ""} />
      <Field label="Budget Items" value={data.budgetItems.map(b => `${b.quantity} ${b.unit} — ${b.specification} @ ₱${b.unitCost} = ₱${b.subtotal}`).join("\n")} />

      <Field label="Expected Outputs" value={data.expectedOutputs.map((o, i) => `${i + 1}. ${o.text}`).join("\n")} />
      <Field label="Expected Outcomes" value={data.expectedOutcomes.map((o, i) => `${i + 1}. ${o.text}`).join("\n")} />
    </>
  );
}

export function ProjectReviewModal({
  project, submissions, onClose, onReviewed,
}: { project: ResearchProject; submissions: StageSubmission[]; onClose: () => void; onReviewed: () => void }) {
  const activeSubmission = submissions.find(s => s.stage === project.currentStage) ?? null;
  const proposalDevSubmission = submissions.find(s => s.stage === "proposal_development") ?? null;
  const [comment, setComment] = useState(activeSubmission?.evaluatorComment ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function decide(outcome: "approved" | "returned") {
    if (!activeSubmission) return;
    if (outcome === "returned" && !comment.trim()) { setError("Add a comment explaining what needs revision."); return; }
    setBusy(true);
    setError("");
    const result = await reviewStageSubmission(activeSubmission.id, project.id, project.currentStage, outcome, comment.trim());
    setBusy(false);
    if (!result.ok) { setError(result.error || "Couldn't save the review."); return; }
    onReviewed();
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[92vh]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4 rounded-t-2xl shrink-0">
          <div>
            <h3 className="text-white font-bold text-[15px]">{project.title}</h3>
            <p className="text-white/60 text-xs mt-0.5">{STAGE_LABELS[project.currentStage]}</p>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <Section title="Concept">
            <Field label="Research Agenda" value={project.researchAgenda} />
            <Field label="Leader" value={project.leaderName} />
            <Field label="Members" value={project.members.join(", ")} />
            <Field label="Stakeholders" value={project.stakeholders} />
            <Field label="Rationale" value={project.rationale} />
            <Field label="Significance" value={project.significance} />
            <Field label="Expected Outcomes (Summary)" value={project.expectedOutcomesSummary} />
          </Section>

          {proposalDevSubmission && Object.keys(proposalDevSubmission.formData).length > 0 && (
            <Section title="Proposal Development">
              <ProposalDevelopmentReadout data={proposalDevSubmission.formData as unknown as ProposalDevelopmentFormData} />
            </Section>
          )}

          {activeSubmission ? (
            activeSubmission.status === "under_review" ? (
              <Section title={`Review — ${STAGE_LABELS[project.currentStage]}`}>
                {error && <p className="text-red-500 text-sm bg-red-50 px-3 py-2 rounded-lg mb-3">{error}</p>}
                <textarea value={comment} onChange={e => setComment(e.target.value)} rows={3}
                  placeholder="Comment (required to return for revision — shown to the researcher)"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F3BC00] bg-white resize-none mb-3" />
                <div className="flex gap-2">
                  <button type="button" disabled={busy} onClick={() => void decide("approved")}
                    className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-[12.5px] font-bold text-white disabled:opacity-50">
                    <CheckCircle2 size={14} /> Approve
                  </button>
                  <button type="button" disabled={busy} onClick={() => void decide("returned")}
                    className="flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-[12.5px] font-bold text-white disabled:opacity-50">
                    <AlertCircle size={14} /> Return for Revision
                  </button>
                </div>
              </Section>
            ) : (
              <Section title={`Review — ${STAGE_LABELS[project.currentStage]}`}>
                <p className="text-[12.5px] text-slate-500 mb-1">
                  {activeSubmission.status === "approved" ? "Approved" : "Returned for revision"}
                  {activeSubmission.reviewedAt ? ` on ${new Date(activeSubmission.reviewedAt).toLocaleString()}` : ""}.
                </p>
                {activeSubmission.evaluatorComment && <p className="text-[12.5px] text-slate-600 italic">"{activeSubmission.evaluatorComment}"</p>}
              </Section>
            )
          ) : (
            <p className="text-[12.5px] text-slate-400 italic">The researcher hasn't submitted this stage yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
