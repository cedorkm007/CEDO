import { useEffect, useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { fetchMyProjects, fetchStageSubmissionsForProjects, STATUS_REMARKS, STAGE_LABELS, type ResearchProject, type StageSubmission } from "../../researchProjectApi";
import { ConceptFormModal } from "../../components/ConceptFormModal";

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

  async function load() {
    setLoading(true);
    const p = await fetchMyProjects();
    setProjects(p);
    setSubmissions(await fetchStageSubmissionsForProjects(p.map(x => x.id)));
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function currentSubmissionFor(project: ResearchProject): StageSubmission | null {
    return submissions.find(s => s.projectId === project.id && s.stage === project.currentStage) ?? null;
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
                  const submission = currentSubmissionFor(project);
                  return (
                    <tr key={project.id} className="border-t border-[#f0f3f8]">
                      <td className="px-4 py-3 font-semibold text-[#062444]">
                        {project.title}
                        <div className="text-[10.5px] font-normal text-slate-400 mt-0.5">{STAGE_LABELS[project.currentStage]}</div>
                      </td>
                      <td className="px-4 py-3">
                        {submission && (
                          <span className={`inline-block rounded-full px-2.5 py-0.5 font-bold ${STATUS_BADGE_CLASSES[submission.status]}`}>
                            {STATUS_LABELS[submission.status]}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500">{submission ? STATUS_REMARKS[submission.status] : ""}</td>
                      <td className="px-4 py-3">
                        {submission?.status === "returned" && project.currentStage === "concept" && (
                          <button onClick={() => setEditing({ project, submission })} className="flex items-center gap-1 text-[#0088cc] font-semibold hover:underline">
                            <Pencil size={12} /> Edit
                          </button>
                        )}
                        {submission?.status === "approved" && project.currentStage === "concept" && (
                          <button disabled title="Coming soon" className="text-slate-300 font-semibold cursor-not-allowed">
                            Fill Proposal Development
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
    </div>
  );
}
