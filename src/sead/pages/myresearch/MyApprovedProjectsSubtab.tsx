import { useEffect, useState } from "react";
import { FolderCheck, FileEdit, Pencil } from "lucide-react";
import {
  fetchMyProjects, fetchStageSubmissionsForProjects, PROJECT_STAGES, STAGE_LABELS,
  STATUS_LABELS, STATUS_BADGE_CLASSES, STATUS_REMARKS,
  type ResearchProject, type StageSubmission, type ObjectiveItem, type ProposalDevelopmentFormData, type PostApprovalStageKey,
} from "../../researchProjectApi";
import { PostApprovalStageFormModal } from "../../components/PostApprovalStageFormModal";

const IMPLEMENTATION_INDEX = PROJECT_STAGES.indexOf("implementation");

/** Projects that have reached Implementation or beyond — moved here from My Proposals once the evaluator approves them past Proposal Development. Same Research Title/Status/Remarks/Action table as My Proposals. */
export function MyApprovedProjectsSubtab() {
  const [projects, setProjects] = useState<ResearchProject[]>([]);
  const [submissions, setSubmissions] = useState<StageSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [filling, setFilling] = useState<ResearchProject | null>(null);

  async function load() {
    setLoading(true);
    const all = await fetchMyProjects();
    const approved = all.filter(p => PROJECT_STAGES.indexOf(p.currentStage) >= IMPLEMENTATION_INDEX);
    setProjects(approved);
    setSubmissions(await fetchStageSubmissionsForProjects(approved.map(p => p.id)));
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  // Every post-approval stage is one "main" submission — like Concept, not split like Proposal Development.
  function currentSubmissionFor(project: ResearchProject): StageSubmission | null {
    return submissions.find(s => s.projectId === project.id && s.stage === project.currentStage) ?? null;
  }

  // The specific objectives (never the main objective) that the Implementation/Monitoring forms need one row per — sourced from the already-approved Proposal Development "objectives" form.
  function objectivesFor(project: ResearchProject): string[] {
    const sub = submissions.find(s => s.projectId === project.id && s.stage === "proposal_development" && s.formKey === "objectives");
    const objectives = (sub?.formData as Partial<ProposalDevelopmentFormData> | undefined)?.objectives as ObjectiveItem[] | undefined;
    return objectives?.map(o => o.text) ?? [];
  }

  // The analysis techniques the researcher proposed — shown as read-only context on the Monitoring results form.
  function dataAnalysisFor(project: ResearchProject): string[] {
    const sub = submissions.find(s => s.projectId === project.id && s.stage === "proposal_development" && s.formKey === "methodology");
    return (sub?.formData as Partial<ProposalDevelopmentFormData> | undefined)?.methodology?.dataAnalysis ?? [];
  }

  if (loading) return <p className="text-center text-slate-400 py-10">Loading…</p>;

  return (
    <div>
      <h3 className="text-[13.5px] font-bold text-[#062444] mb-4">Approved Projects</h3>

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
              {projects.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-slate-400">
                    <div className="flex flex-col items-center gap-2">
                      <FolderCheck size={22} className="text-slate-300" />
                      <span>No approved projects yet. Once a proposal moves to Implementation, it will appear here.</span>
                    </div>
                  </td>
                </tr>
              ) : (
                projects.map(project => {
                  const completed = project.currentStage === "completed";
                  const submission = completed ? null : currentSubmissionFor(project);
                  const canFill = !completed && (!submission || submission.status === "returned");
                  return (
                    <tr key={project.id} className="border-t border-[#f0f3f8]">
                      <td className="px-4 py-3 font-semibold text-[#062444]">
                        {project.title}
                        <div className="text-[10.5px] font-normal text-slate-400 mt-0.5">{STAGE_LABELS[project.currentStage]}</div>
                      </td>
                      <td className="px-4 py-3">
                        {completed ? (
                          <span className="inline-block rounded-full px-2.5 py-0.5 font-bold text-green-700 bg-green-100">Completed</span>
                        ) : submission ? (
                          <span className={`inline-block rounded-full px-2.5 py-0.5 font-bold ${STATUS_BADGE_CLASSES[submission.status]}`}>
                            {STATUS_LABELS[submission.status]}
                          </span>
                        ) : (
                          <span className="inline-block rounded-full px-2.5 py-0.5 font-bold text-slate-500 bg-slate-100">Not yet submitted</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {completed ? "Research completed" : submission ? STATUS_REMARKS[submission.status] : `Submit ${STAGE_LABELS[project.currentStage]} requirements`}
                      </td>
                      <td className="px-4 py-3">
                        {canFill && (
                          <button onClick={() => setFilling(project)} className="flex items-center gap-1 text-[#0088cc] font-semibold hover:underline">
                            {submission?.status === "returned" ? <Pencil size={12} /> : <FileEdit size={12} />}
                            {submission?.status === "returned" ? "Edit" : `Fill ${STAGE_LABELS[project.currentStage]}`}
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

      {filling && (
        <PostApprovalStageFormModal
          project={filling}
          stage={filling.currentStage as PostApprovalStageKey}
          existingSubmission={currentSubmissionFor(filling)}
          objectives={objectivesFor(filling)}
          dataAnalysis={dataAnalysisFor(filling)}
          onClose={() => setFilling(null)}
          onSaved={() => { setFilling(null); load(); }}
        />
      )}
    </div>
  );
}
