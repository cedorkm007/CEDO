import { useEffect, useState } from "react";
import { Plus, Pencil, FileEdit } from "lucide-react";
import {
  fetchMyProjects, fetchStageSubmissionsForProjects, computeProposalDevFormStatuses,
  STATUS_REMARKS, STAGE_LABELS, PROPOSAL_DEV_FORM_KEYS, PROPOSAL_DEV_FORM_LABELS,
  type ResearchProject, type StageSubmission,
} from "../../researchProjectApi";
import { ConceptFormModal } from "../../components/ConceptFormModal";
import { ProposalDevelopmentWizard } from "../../components/ProposalDevelopmentWizard";

const STATUS_LABELS: Record<StageSubmission["status"], string> = {
  under_review: "Under Review",
  returned: "Returned",
  approved: "Approved",
};
const STATUS_BADGE_CLASSES: Record<StageSubmission["status"], string> = {
  under_review: "text-amber-700 bg-amber-100",
  returned: "text-red-700 bg-red-100",
  approved: "text-green-700 bg-green-100",
};

export function MyProposalsSubtab() {
  const [projects, setProjects] = useState<ResearchProject[]>([]);
  const [submissions, setSubmissions] = useState<StageSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ project: ResearchProject; submission: StageSubmission } | "new" | null>(null);
  const [developing, setDeveloping] = useState<ResearchProject | null>(null);

  async function load() {
    setLoading(true);
    const p = await fetchMyProjects();
    setProjects(p);
    setSubmissions(await fetchStageSubmissionsForProjects(p.map(x => x.id)));
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  // Concept has exactly one form ("main") — a single submission is enough.
  function currentSubmissionFor(project: ResearchProject): StageSubmission | null {
    return submissions.find(s => s.projectId === project.id && s.stage === project.currentStage) ?? null;
  }

  function proposalDevSubmissionsFor(project: ResearchProject): StageSubmission[] {
    return submissions.filter(s => s.projectId === project.id && s.stage === "proposal_development");
  }

  /** Proposal Development's "Status"/"Remarks" columns show the form that's actually blocking progress right now, plus how many of the 6 are done. */
  function proposalDevProgressFor(project: ResearchProject): { label: string; badgeClass: string; remarks: string } | null {
    const projectSubmissions = proposalDevSubmissionsFor(project);
    const statuses = computeProposalDevFormStatuses(projectSubmissions);
    const approvedCount = PROPOSAL_DEV_FORM_KEYS.filter(k => statuses[k] === "approved").length;
    const activeKey = PROPOSAL_DEV_FORM_KEYS.find(k => statuses[k] !== "approved");
    if (!activeKey) return null; // all 6 approved — project will have already moved to Implementation
    const activeStatus = statuses[activeKey];
    const progress = `(${approvedCount}/${PROPOSAL_DEV_FORM_KEYS.length} forms approved)`;
    if (activeStatus === "editable") {
      return { label: "Not yet submitted", badgeClass: "text-slate-500 bg-slate-100", remarks: `${PROPOSAL_DEV_FORM_LABELS[activeKey]} ${progress}` };
    }
    return {
      label: STATUS_LABELS[activeStatus as StageSubmission["status"]],
      badgeClass: STATUS_BADGE_CLASSES[activeStatus as StageSubmission["status"]],
      remarks: `${PROPOSAL_DEV_FORM_LABELS[activeKey]} ${progress}`,
    };
  }

  // "My Proposals" tracks projects still moving through Concept/Proposal
  // Development — once approved past Proposal Development the project
  // moves to Implementation and belongs in "My Approved Projects" instead
  // (wired in Phase D.5); for now (only Concept exists) this is every project.
  const activeProjects = projects.filter(p => p.currentStage === "concept" || p.currentStage === "proposal_development");

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[13.5px] font-bold text-[#062444]">Your Proposals</h3>
        <button onClick={() => setEditing("new")} className="flex items-center gap-1.5 bg-[#062444] text-white text-[12.5px] font-semibold rounded-lg px-3.5 py-2">
          <Plus size={14} /> New Research Project
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-[#e6ecf5] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="bg-[#f8fafd] text-left text-slate-400 text-[11px] font-bold uppercase tracking-wide">
                <th className="px-4 py-3">Research Title</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Remarks</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
              ) : activeProjects.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">You haven't submitted any research proposals yet.</td></tr>
              ) : (
                activeProjects.map(project => {
                  const submission = project.currentStage === "concept" ? currentSubmissionFor(project) : null;
                  const proposalDevProgress = project.currentStage === "proposal_development" ? proposalDevProgressFor(project) : null;
                  return (
                    <tr key={project.id} className="border-t border-[#f0f3f8]">
                      <td className="px-4 py-3 font-semibold text-[#062444]">
                        {project.title}
                        <div className="text-[10.5px] font-normal text-slate-400 mt-0.5">{STAGE_LABELS[project.currentStage]}</div>
                      </td>
                      <td className="px-4 py-3">
                        {submission ? (
                          <span className={`inline-block rounded-full px-2.5 py-0.5 font-bold ${STATUS_BADGE_CLASSES[submission.status]}`}>
                            {STATUS_LABELS[submission.status]}
                          </span>
                        ) : proposalDevProgress ? (
                          <span className={`inline-block rounded-full px-2.5 py-0.5 font-bold ${proposalDevProgress.badgeClass}`}>
                            {proposalDevProgress.label}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {submission ? STATUS_REMARKS[submission.status] : proposalDevProgress ? proposalDevProgress.remarks : ""}
                      </td>
                      <td className="px-4 py-3">
                        {submission?.status === "returned" && project.currentStage === "concept" && (
                          <button onClick={() => setEditing({ project, submission })} className="flex items-center gap-1 text-[#0088cc] font-semibold hover:underline">
                            <Pencil size={12} /> Edit
                          </button>
                        )}
                        {submission?.status === "approved" && project.currentStage === "concept" && (
                          <button disabled title="Waiting for the evaluator to move this project to Proposal Development" className="text-slate-300 font-semibold cursor-not-allowed">
                            Fill Proposal Development
                          </button>
                        )}
                        {project.currentStage === "proposal_development" && (
                          <button onClick={() => setDeveloping(project)} className="flex items-center gap-1 text-[#0088cc] font-semibold hover:underline">
                            <FileEdit size={12} /> {proposalDevProgress?.label === "Not yet submitted" ? "Fill Proposal Development" : "Continue Proposal Development"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <ConceptFormModal
          existing={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      {developing && (
        <ProposalDevelopmentWizard
          project={developing}
          existingSubmissions={proposalDevSubmissionsFor(developing)}
          onClose={() => setDeveloping(null)}
          onSaved={() => { setDeveloping(null); load(); }}
        />
      )}
    </div>
  );
}
