import { useState } from "react";
import { X, CheckCircle2, AlertCircle, Clock, ChevronLeft, ChevronRight, FileText } from "lucide-react";
import {
  reviewStageSubmission, computeProposalDevFormStatuses, STAGE_LABELS, PROPOSAL_DEV_FORM_KEYS, PROPOSAL_DEV_FORM_LABELS,
  POST_APPROVAL_STAGE_KEYS,
  type ResearchProject, type StageSubmission, type ProposalDevelopmentFormData, type ProposalDevFormKey, type PostApprovalStageKey,
  type ImplementationFormData, type MonitoringFormData, type DisseminationFormData, type UtilizationFormData,
  type PreservationFormData, type InstitutionalLearningFormData, type EvidenceFile,
} from "../researchProjectApi";
import { fetchEvidencePreviewUrl } from "../researchEvidenceApi";

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

function NumberedTable({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mb-2.5">
      <p className="text-[10.5px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">{label}</p>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
        <div className="grid grid-cols-[40px_1fr] bg-[#062444]/5 min-w-[280px]">
          <div className="px-2.5 py-2 text-[11px] font-bold text-[#062444] border-r border-gray-200">No.</div>
          <div className="px-2.5 py-2 text-[11px] font-bold text-[#062444]">Description</div>
        </div>
        {items.map((text, i) => (
          <div key={i} className="grid grid-cols-[40px_1fr] border-t border-gray-100 min-w-[280px]">
            <div className="px-2.5 py-2 text-[12.5px] text-[#062444] border-r border-gray-100">{i + 1}</div>
            <div className="px-2.5 py-2 text-[12.5px] text-[#062444] whitespace-pre-wrap">{text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConceptReadout({ project }: { project: ResearchProject }) {
  return (
    <>
      <Field label="Research Agenda" value={project.researchAgenda} />
      <Field label="Leader" value={project.leaderName} />
      <Field label="Members" value={project.members.join(", ")} />
      <Field label="Stakeholders" value={project.stakeholders} />
      <Field label="Rationale" value={project.rationale} />
      <Field label="Significance" value={project.significance} />
      <Field label="Expected Outcomes (Summary)" value={project.expectedOutcomesSummary} />
    </>
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
          {data.workPlanActivities && data.workPlanActivities.length > 0 && (
            <div className="mb-2.5">
              <p className="text-[10.5px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">Work Plan Activities</p>
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
                <div className="grid grid-cols-[1fr_70px_1fr] bg-[#062444]/5 min-w-[420px]">
                  <div className="px-3 py-2 text-[11px] font-bold text-[#062444] border-r border-gray-200">Activity</div>
                  <div className="px-3 py-2 text-[11px] font-bold text-[#062444] border-r border-gray-200">Days</div>
                  <div className="px-3 py-2 text-[11px] font-bold text-[#062444]">Deliverable</div>
                </div>
                {data.workPlanActivities.map((a, i) => (
                  <div key={i} className="grid grid-cols-[1fr_70px_1fr] border-t border-gray-100 min-w-[420px]">
                    <div className="px-3 py-2 text-[12.5px] text-[#062444] border-r border-gray-100">{a.activity}</div>
                    <div className="px-3 py-2 text-[12.5px] text-[#062444] border-r border-gray-100">{a.days}</div>
                    <div className="px-3 py-2 text-[12.5px] text-[#062444]">{a.deliverable}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      );
    case "budget":
      return (
        <>
          <Field label="Total Budget" value={data.budgetTotal ? `₱${data.budgetTotal}` : ""} />
          {data.budgetItems && data.budgetItems.length > 0 && (
            <div className="mb-2.5">
              <p className="text-[10.5px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">Itemized Breakdown</p>
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
                <div className="grid grid-cols-5 bg-[#062444]/5 min-w-[480px]">
                  {["Qty", "Unit", "Specification", "Unit Cost (₱)", "Subtotal (₱)"].map((h, i) => (
                    <div key={h} className={`px-2.5 py-2 text-[11px] font-bold text-[#062444] ${i < 4 ? "border-r border-gray-200" : ""}`}>{h}</div>
                  ))}
                </div>
                {data.budgetItems.map((b, i) => (
                  <div key={i} className="grid grid-cols-5 border-t border-gray-100 min-w-[480px]">
                    <div className="px-2.5 py-2 text-[12.5px] text-[#062444] border-r border-gray-100">{b.quantity}</div>
                    <div className="px-2.5 py-2 text-[12.5px] text-[#062444] border-r border-gray-100">{b.unit}</div>
                    <div className="px-2.5 py-2 text-[12.5px] text-[#062444] border-r border-gray-100">{b.specification}</div>
                    <div className="px-2.5 py-2 text-[12.5px] text-[#062444] border-r border-gray-100">{b.unitCost}</div>
                    <div className="px-2.5 py-2 text-[12.5px] text-[#062444]">{b.subtotal}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      );
    case "outputs":
      return (
        <>
          <NumberedTable label="Expected Outputs" items={data.expectedOutputs?.map(o => o.text) ?? []} />
          <NumberedTable label="Expected Outcomes" items={data.expectedOutcomes?.map(o => o.text) ?? []} />
        </>
      );
  }
}

/** Opens a private evidence file in a new tab via a short-lived signed URL, fetched on click. */
function FileLink({ file }: { file: EvidenceFile | null }) {
  if (!file) return <span className="text-slate-400 italic">No file</span>;
  async function open() {
    const url = await fetchEvidencePreviewUrl(file!);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }
  return (
    <button type="button" onClick={open} className="flex items-center gap-1 text-[#0088cc] font-semibold hover:underline">
      <FileText size={12} /> {file.fileName}
    </button>
  );
}

/** Renders the single "main" submission's data for one Implementation-onward stage. */
function PostApprovalReadout({ stage, data, dataAnalysis }: { stage: PostApprovalStageKey; data: Record<string, unknown>; dataAnalysis: string[] }) {
  switch (stage) {
    case "implementation": {
      const rows = (data as Partial<ImplementationFormData>).evidence ?? [];
      if (rows.length === 0) return null;
      return (
        <div className="mb-2.5">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
            <div className="grid grid-cols-[1fr_1fr_140px] bg-[#062444]/5 min-w-[500px]">
              <div className="px-3 py-2 text-[11px] font-bold text-[#062444] border-r border-gray-200">Objective</div>
              <div className="px-3 py-2 text-[11px] font-bold text-[#062444] border-r border-gray-200">Description</div>
              <div className="px-3 py-2 text-[11px] font-bold text-[#062444]">Evidence</div>
            </div>
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_140px] border-t border-gray-100 min-w-[500px]">
                <div className="px-3 py-2 text-[12.5px] text-[#062444] border-r border-gray-100">{r.objectiveText}</div>
                <div className="px-3 py-2 text-[12.5px] text-[#062444] border-r border-gray-100 whitespace-pre-wrap">{r.description}</div>
                <div className="px-3 py-2 text-[12.5px]"><FileLink file={r.file} /></div>
              </div>
            ))}
          </div>
        </div>
      );
    }
    case "monitoring": {
      const rows = (data as Partial<MonitoringFormData>).results ?? [];
      return (
        <>
          {dataAnalysis.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5 mb-2.5">
              <p className="text-[10.5px] font-bold text-blue-700 uppercase tracking-wide mb-1">Proposed Analysis Techniques</p>
              <p className="text-[12px] text-blue-800">{dataAnalysis.join(", ")}</p>
            </div>
          )}
          {rows.length > 0 && (
            <div className="mb-2.5">
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
                <div className="grid grid-cols-3 bg-[#062444]/5 min-w-[500px]">
                  <div className="px-3 py-2 text-[11px] font-bold text-[#062444] border-r border-gray-200">Objective</div>
                  <div className="px-3 py-2 text-[11px] font-bold text-[#062444] border-r border-gray-200">Results</div>
                  <div className="px-3 py-2 text-[11px] font-bold text-[#062444]">Insights / Findings</div>
                </div>
                {rows.map((r, i) => (
                  <div key={i} className="grid grid-cols-3 border-t border-gray-100 min-w-[500px]">
                    <div className="px-3 py-2 text-[12.5px] text-[#062444] border-r border-gray-100">{r.objectiveText}</div>
                    <div className="px-3 py-2 text-[12.5px] text-[#062444] border-r border-gray-100 whitespace-pre-wrap">{r.results}</div>
                    <div className="px-3 py-2 text-[12.5px] text-[#062444] whitespace-pre-wrap">{r.insights}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <Field label="Overall Conclusion" value={(data as Partial<MonitoringFormData>).overallConclusion} />
        </>
      );
    }
    case "dissemination":
    case "utilization": {
      const rows = stage === "dissemination" ? (data as Partial<DisseminationFormData>).evidence ?? [] : (data as Partial<UtilizationFormData>).certificates ?? [];
      if (rows.length === 0) return null;
      return (
        <div className="mb-2.5">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
            <div className="grid grid-cols-[1fr_140px] bg-[#062444]/5 min-w-[420px]">
              <div className="px-3 py-2 text-[11px] font-bold text-[#062444] border-r border-gray-200">Description</div>
              <div className="px-3 py-2 text-[11px] font-bold text-[#062444]">File</div>
            </div>
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_140px] border-t border-gray-100 min-w-[420px]">
                <div className="px-3 py-2 text-[12.5px] text-[#062444] border-r border-gray-100 whitespace-pre-wrap">{r.description}</div>
                <div className="px-3 py-2 text-[12.5px]"><FileLink file={r.file} /></div>
              </div>
            ))}
          </div>
        </div>
      );
    }
    case "preservation":
      return <div className="mb-2.5"><FileLink file={(data as Partial<PreservationFormData>).file ?? null} /></div>;
    case "institutional_learning":
      return <Field label="Way Forward / Future Plans" value={(data as Partial<InstitutionalLearningFormData>).wayForward} />;
  }
}

/** One review card for a single stage/form submission — the shared UI for both Concept's one form and each of Proposal Development's 6.
 * Doubles as the read-only view for an already-decided (approved/returned) submission: the Approve/Return controls
 * only render while status is "under_review", so paging back to a past, already-approved section is automatically read-only. */
function SubmissionReviewCard({
  title, submission, readout, onReviewed,
}: { title: string; submission: StageSubmission | null; readout: React.ReactNode; onReviewed: (submissionId: string, outcome: "approved" | "returned", comment: string) => Promise<{ ok: boolean; error?: string }> }) {
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
        <p className="text-[12.5px] text-slate-400 italic">The researcher hasn't submitted this form yet.</p>
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

type PageKey = "concept" | ProposalDevFormKey | PostApprovalStageKey;
interface ReviewPage {
  key: PageKey;
  title: string;
  submission: StageSubmission | null;
  readout: React.ReactNode;
  isCurrent: boolean;
}

export function ProjectReviewModal({
  project, submissions, onClose, onReviewed,
}: { project: ResearchProject; submissions: StageSubmission[]; onClose: () => void; onReviewed: () => void }) {
  const conceptSubmission = submissions.find(s => s.stage === "concept") ?? null;
  const proposalDevSubmissions = submissions.filter(s => s.stage === "proposal_development");
  const proposalDevStatuses = computeProposalDevFormStatuses(proposalDevSubmissions);
  // Exactly one form is ever "active" at a time (editable/returned/under_review) — everything before it is
  // already approved and everything after is locked.
  const currentFormKey = PROPOSAL_DEV_FORM_KEYS.find(k => proposalDevStatuses[k] !== "approved" && proposalDevStatuses[k] !== "locked");
  const approvedCount = PROPOSAL_DEV_FORM_KEYS.filter(k => proposalDevStatuses[k] === "approved").length;

  // One page per reviewable section — Concept plus (once reached) each Proposal Development form that has
  // been submitted at least once. Locked forms have no data yet, so they're left out entirely.
  const pages: ReviewPage[] = [
    { key: "concept", title: "Concept", submission: conceptSubmission, readout: <ConceptReadout project={project} />, isCurrent: project.currentStage === "concept" },
  ];
  if (project.currentStage === "proposal_development") {
    for (const key of PROPOSAL_DEV_FORM_KEYS) {
      if (proposalDevStatuses[key] === "locked") continue;
      const submission = proposalDevSubmissions.find(s => s.formKey === key) ?? null;
      pages.push({
        key,
        title: PROPOSAL_DEV_FORM_LABELS[key],
        submission,
        readout: submission ? <ProposalDevFormReadout formKey={key} data={submission.formData as Partial<ProposalDevelopmentFormData>} /> : null,
        isCurrent: key === currentFormKey,
      });
    }
  } else if ((POST_APPROVAL_STAGE_KEYS as readonly string[]).includes(project.currentStage)) {
    const stage = project.currentStage as PostApprovalStageKey;
    const submission = submissions.find(s => s.stage === stage) ?? null;
    const methodologyData = proposalDevSubmissions.find(s => s.formKey === "methodology")?.formData as Partial<ProposalDevelopmentFormData> | undefined;
    pages.push({
      key: stage,
      title: STAGE_LABELS[stage],
      submission,
      readout: submission ? <PostApprovalReadout stage={stage} data={submission.formData} dataAnalysis={methodologyData?.methodology?.dataAnalysis ?? []} /> : null,
      isCurrent: true,
    });
  }

  // "View Full Proposal" always shows the complete original proposal (Concept through Expected Outputs and
  // Outcomes) regardless of what stage the project has since advanced to — unlike `pages` above, which is
  // scoped to whatever is current so the paginated reviewer view only shows what needs attention right now.
  const fullProposalSections: { key: string; title: string; readout: React.ReactNode }[] = [
    { key: "concept", title: "Concept", readout: <ConceptReadout project={project} /> },
    ...PROPOSAL_DEV_FORM_KEYS.map(key => {
      const submission = proposalDevSubmissions.find(s => s.formKey === key) ?? null;
      return {
        key,
        title: PROPOSAL_DEV_FORM_LABELS[key],
        readout: submission ? <ProposalDevFormReadout formKey={key} data={submission.formData as Partial<ProposalDevelopmentFormData>} /> : null,
      };
    }),
  ];

  const defaultIdx = pages.findIndex(p => p.isCurrent);
  const [pageIdx, setPageIdx] = useState(defaultIdx >= 0 ? defaultIdx : pages.length - 1);
  const [fullView, setFullView] = useState(false);
  const activePage = pages[Math.min(pageIdx, pages.length - 1)];

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
          <div className="flex items-center gap-3">
            <button onClick={() => setFullView(v => !v)}
              className="flex items-center gap-1.5 text-white/80 hover:text-white text-xs font-semibold bg-white/10 hover:bg-white/20 rounded-lg px-3 py-1.5">
              <FileText size={13} /> {fullView ? "Back to Review" : "View Full Proposal"}
            </button>
            <button onClick={onClose} className="text-white/70 hover:text-white"><X size={18} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {fullView ? (
            <>
              {fullProposalSections.map(s => (
                <Section key={s.key} title={s.title}>
                  {s.readout ?? <p className="text-[12.5px] text-slate-400 italic">Not yet submitted.</p>}
                </Section>
              ))}
            </>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <button type="button" onClick={() => setPageIdx(i => Math.max(0, i - 1))} disabled={pageIdx === 0}
                  className="flex items-center justify-center w-8 h-8 rounded-full border border-gray-200 text-[#062444] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-50">
                  <ChevronLeft size={16} />
                </button>
                <div className="text-center">
                  <p className="text-[11px] text-slate-400 font-semibold">
                    Section {pageIdx + 1} of {pages.length}
                    {project.currentStage === "proposal_development" && ` · ${approvedCount}/${PROPOSAL_DEV_FORM_KEYS.length} forms approved`}
                  </p>
                  <p className="text-sm font-bold text-[#062444]">{activePage.title}</p>
                </div>
                <button type="button" onClick={() => setPageIdx(i => Math.min(pages.length - 1, i + 1))} disabled={pageIdx === pages.length - 1}
                  className="flex items-center justify-center w-8 h-8 rounded-full border border-gray-200 text-[#062444] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-50">
                  <ChevronRight size={16} />
                </button>
              </div>

              <SubmissionReviewCard
                key={activePage.key}
                title={activePage.title}
                submission={activePage.submission}
                readout={activePage.readout}
                onReviewed={(id, outcome, comment) => decide(id, outcome, comment)}
              />

              {project.currentStage === "proposal_development" && !currentFormKey && (
                <p className="text-[12.5px] text-slate-400 italic flex items-center gap-1.5"><CheckCircle2 size={13} className="text-emerald-600" /> All {PROPOSAL_DEV_FORM_KEYS.length} forms have been approved.</p>
              )}

              {project.currentStage === "completed" && (
                <p className="text-[12.5px] text-slate-400 italic flex items-center gap-1.5"><CheckCircle2 size={13} className="text-emerald-600" /> This research project has completed every stage.</p>
              )}

              {project.currentStage !== "concept" && project.currentStage !== "proposal_development" && project.currentStage !== "completed"
                && !(POST_APPROVAL_STAGE_KEYS as readonly string[]).includes(project.currentStage) && (
                <p className="text-[12.5px] text-slate-400 italic flex items-center gap-1.5"><Clock size={13} /> No form is defined for {STAGE_LABELS[project.currentStage]} yet.</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
