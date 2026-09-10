import { useState } from "react";
import { X, CheckCircle2, AlertCircle, Clock, Lock } from "lucide-react";
import {
  reviewStageSubmission, computeProposalDevFormStatuses, STAGE_LABELS, PROPOSAL_DEV_FORM_KEYS, PROPOSAL_DEV_FORM_LABELS,
  type ResearchProject, type StageSubmission, type ProposalDevelopmentFormData, type ProposalDevFormKey,
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

/** Renders just the fields one Proposal Development form is responsible for — mirrors sliceForStep in ProposalDevelopmentWizard.tsx. */
function ProposalDevFormReadout({ formKey, data }: { formKey: ProposalDevFormKey; data: Partial<ProposalDevelopmentFormData> }) {
  switch (formKey) {
    case "statement":
      return <Field label="Statement of the Problem" value={data.statementOfProblem} />;
    case "objectives":
      return (
        <>
          <Field label="Main Objective" value={data.mainObjective} />
          <Field label="Specific Objectives" value={data.objectives?.map((o, i) => `${i + 1}. ${o.text}`).join("\n")} />
        </>
      );
    case "methodology": {
      const m = data.methodology;
      if (!m) return null;
      return (
        <>
          <Field label="Approach" value={m.approach} />
          <Field label="Design" value={m.design} />
          <Field label="Population" value={m.population} />
          <Field label="Sampling" value={m.sampling} />
          <p className="text-[10.5px] font-bold text-slate-400 uppercase tracking-wide mb-1 mt-2">Data Sources</p>
          <Pills items={m.dataSources ?? []} />
          <p className="text-[10.5px] font-bold text-slate-400 uppercase tracking-wide mb-1 mt-2">Data Collection Methods</p>
          <Pills items={m.dataCollectionMethods ?? []} />
          <p className="text-[10.5px] font-bold text-slate-400 uppercase tracking-wide mb-1 mt-2">Data Analysis</p>
          <Pills items={m.dataAnalysis ?? []} />
        </>
      );
    }
    case "workPlan":
      return (
        <>
          <Field label="Timeframe" value={data.workPlanStart && data.workPlanEnd ? `${data.workPlanStart} to ${data.workPlanEnd}` : ""} />
          <Field label="Work Plan Activities" value={data.workPlanActivities?.map(a => `${a.activity} (${a.days} day(s)) — ${a.deliverable}`).join("\n")} />
        </>
      );
    case "budget":
      return (
        <>
          <Field label="Total Budget" value={data.budgetTotal ? `₱${data.budgetTotal}` : ""} />
          <Field label="Budget Items" value={data.budgetItems?.map(b => `${b.quantity} ${b.unit} — ${b.specification} @ ₱${b.unitCost} = ₱${b.subtotal}`).join("\n")} />
        </>
      );
    case "outputs":
      return (
        <>
          <Field label="Expected Outputs" value={data.expectedOutputs?.map((o, i) => `${i + 1}. ${o.text}`).join("\n")} />
          <Field label="Expected Outcomes" value={data.expectedOutcomes?.map((o, i) => `${i + 1}. ${o.text}`).join("\n")} />
        </>
      );
  }
}

/** One review card for a single stage/form submission — the shared UI for both Concept's one form and each of Proposal Development's 6. */
function SubmissionReviewCard({
  title, submission, readout, locked, onReviewed,
}: { title: string; submission: StageSubmission | null; readout: React.ReactNode; locked?: boolean; onReviewed: (submissionId: string, outcome: "approved" | "returned", comment: string) => Promise<{ ok: boolean; error?: string }> }) {
  const [comment, setComment] = useState(submission?.evaluatorComment ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function decide(outcome: "approved" | "returned") {
    if (!submission) return;
    if (outcome === "returned" && !comment.trim()) { setError("Add a comment explaining what needs revision."); return; }
    setBusy(true);
    setError("");
    const result = await onReviewed(submission.id, outcome, comment.trim());
    setBusy(false);
    if (!result.ok) setError(result.error || "Couldn't save the review.");
  }

  return (
    <Section title={title}>
      {!submission ? (
        <p className="text-[12.5px] text-slate-400 italic flex items-center gap-1.5">
          {locked ? <><Lock size={13} /> Not reached yet — an earlier form is still pending.</> : "The researcher hasn't submitted this form yet."}
        </p>
      ) : (
        <>
          {readout}
          {submission.status === "under_review" ? (
            <div className="mt-2">
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
            </div>
          ) : (
            <p className="text-[12.5px] text-slate-500 mt-1 flex items-center gap-1.5">
              {submission.status === "approved" ? <CheckCircle2 size={13} className="text-emerald-600" /> : <AlertCircle size={13} className="text-red-500" />}
              {submission.status === "approved" ? "Approved" : "Returned for revision"}
              {submission.reviewedAt ? ` on ${new Date(submission.reviewedAt).toLocaleString()}` : ""}.
              {submission.evaluatorComment && <span className="italic">"{submission.evaluatorComment}"</span>}
            </p>
          )}
        </>
      )}
    </Section>
  );
}

export function ProjectReviewModal({
  project, submissions, onClose, onReviewed,
}: { project: ResearchProject; submissions: StageSubmission[]; onClose: () => void; onReviewed: () => void }) {
  const conceptSubmission = submissions.find(s => s.stage === "concept") ?? null;
  const proposalDevSubmissions = submissions.filter(s => s.stage === "proposal_development");
  const proposalDevStatuses = computeProposalDevFormStatuses(proposalDevSubmissions);

  async function decide(submissionId: string, outcome: "approved" | "returned", comment: string) {
    const result = await reviewStageSubmission(submissionId, project.id, project.currentStage, outcome, comment);
    if (result.ok) onReviewed();
    return result;
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

          {project.currentStage === "concept" && (
            conceptSubmission ? (
              <SubmissionReviewCard
                title="Review — Concept"
                submission={conceptSubmission}
                readout={null}
                onReviewed={(id, outcome, comment) => decide(id, outcome, comment)}
              />
            ) : (
              <p className="text-[12.5px] text-slate-400 italic">The researcher hasn't submitted this stage yet.</p>
            )
          )}

          {project.currentStage === "proposal_development" && PROPOSAL_DEV_FORM_KEYS.map(key => {
            const submission = proposalDevSubmissions.find(s => s.formKey === key) ?? null;
            const locked = proposalDevStatuses[key] === "locked";
            return (
              <SubmissionReviewCard
                key={key}
                title={`${PROPOSAL_DEV_FORM_LABELS[key]}${locked ? " (locked)" : ""}`}
                submission={submission}
                locked={locked}
                readout={submission ? <ProposalDevFormReadout formKey={key} data={submission.formData as Partial<ProposalDevelopmentFormData>} /> : null}
                onReviewed={(id, outcome, comment) => decide(id, outcome, comment)}
              />
            );
          })}

          {project.currentStage !== "concept" && project.currentStage !== "proposal_development" && (
            <p className="text-[12.5px] text-slate-400 italic flex items-center gap-1.5"><Clock size={13} /> No form is defined for {STAGE_LABELS[project.currentStage]} yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
