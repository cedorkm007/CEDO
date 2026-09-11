import { useEffect, useState } from "react";
import { FolderKanban } from "lucide-react";
import {
  fetchAllResearchProjectsForEvaluator, fetchStageSubmissionsForProjects, computeProposalDevFormStatuses,
  STAGE_LABELS, PROPOSAL_DEV_FORM_KEYS,
  type ResearchProject, type StageSubmission,
} from "../../researchProjectApi";
import { ProjectReviewModal } from "../../components/ProjectReviewModal";

type DashboardStatus = "Completed" | "For Review" | "Active";

/** For proposal_development (up to 6 independent forms), the stage this project's own submissions are actually in right now — the one form that's under_review, returned, or not yet submitted, since only one is ever open at a time (see computeProposalDevFormStatuses' sequential gating). undefined once every form is approved (the project will have already advanced to Implementation by then). */
function activeProposalDevStatus(projectId: string, submissions: StageSubmission[]): StageSubmission["status"] | "not_submitted" | undefined {
  const projectSubmissions = submissions.filter(s => s.projectId === projectId && s.stage === "proposal_development");
  const statuses = computeProposalDevFormStatuses(projectSubmissions);
  const activeKey = PROPOSAL_DEV_FORM_KEYS.find(k => statuses[k] !== "approved");
  if (!activeKey) return undefined;
  const activeStatus = statuses[activeKey];
  return activeStatus === "under_review" || activeStatus === "returned" ? activeStatus : "not_submitted";
}

function statusFor(project: ResearchProject, submissions: StageSubmission[]): DashboardStatus {
  if (project.currentStage === "completed") return "Completed";
  const active = project.currentStage === "proposal_development"
    ? activeProposalDevStatus(project.id, submissions)
    : submissions.find(s => s.stage === project.currentStage)?.status;
  if (active === "under_review") return "For Review";
  return "Active";
}

function nextActionFor(project: ResearchProject, submissions: StageSubmission[], status: DashboardStatus): string {
  if (status === "Completed") return "—";
  if (status === "For Review") return "Review submission";
  const active = project.currentStage === "proposal_development"
    ? activeProposalDevStatus(project.id, submissions)
    : submissions.find(s => s.stage === project.currentStage)?.status;
  if (active === "returned") return "Waiting on researcher's revision";
  return "Waiting on researcher's submission";
}

const STATUS_COLOR_CLASSES: Record<DashboardStatus, string> = {
  Completed: "bg-green-100 text-green-700",
  "For Review": "bg-amber-100 text-amber-700",
  Active: "bg-blue-100 text-blue-700",
};

export function MonitoringSubtab() {
  const [projects, setProjects] = useState<ResearchProject[]>([]);
  const [submissions, setSubmissions] = useState<StageSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ResearchProject | null>(null);

  async function load() {
    setLoading(true);
    const p = await fetchAllResearchProjectsForEvaluator();
    setProjects(p);
    setSubmissions(await fetchStageSubmissionsForProjects(p.map(x => x.id)));
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const rows = projects.map(project => {
    const status = statusFor(project, submissions);
    return { project, status, nextAction: nextActionFor(project, submissions, status) };
  });
  const completedCount = rows.filter(r => r.status === "Completed").length;
  const activeCount = rows.filter(r => r.status === "Active").length;
  const forReviewCount = rows.filter(r => r.status === "For Review").length;

  const selectedSubmissions = selected ? submissions.filter(s => s.projectId === selected.id) : [];

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-6">
        <div className="bg-[#062444] rounded-2xl p-5 text-left sm:col-span-1">
          <p className="text-[11px] font-bold uppercase tracking-wide text-white/60 mb-1.5">Total Research Projects</p>
          <p className="text-4xl font-extrabold text-white">{projects.length}</p>
        </div>
        <StatCard label="Completed" value={completedCount} colorClasses="bg-green-100 text-green-700" />
        <StatCard label="Active" value={activeCount} colorClasses="bg-blue-100 text-blue-700" />
        <StatCard label="For Review" value={forReviewCount} colorClasses="bg-amber-100 text-amber-700" />
      </div>

      <div className="bg-white rounded-2xl border border-[#e6ecf5] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-[#e6ecf5] text-left text-slate-400 text-[11px] font-bold uppercase tracking-wide">
                <th className="px-4 py-3">Research Title</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Stage</th>
                <th className="px-4 py-3">Last Updated</th>
                <th className="px-4 py-3">Next Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                    <div className="flex flex-col items-center gap-2">
                      <FolderKanban size={22} className="text-slate-300" />
                      <span>No research projects have been submitted yet.</span>
                    </div>
                  </td>
                </tr>
              ) : (
                rows.map(({ project, status, nextAction }) => (
                  <tr key={project.id} onClick={() => setSelected(project)}
                    className="border-b border-[#f0f3f8] last:border-0 cursor-pointer hover:bg-[#f7f9fc]">
                    <td className="px-4 py-3 font-semibold text-[#062444]">{project.title}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded-lg px-2 py-0.5 font-bold ${STATUS_COLOR_CLASSES[status]}`}>{status}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{STAGE_LABELS[project.currentStage]}</td>
                    <td className="px-4 py-3 text-slate-500">{new Date(project.updatedAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-slate-500">{nextAction}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <ProjectReviewModal
          project={selected}
          submissions={selectedSubmissions}
          onClose={() => setSelected(null)}
          onReviewed={() => { setSelected(null); load(); }}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, colorClasses }: { label: string; value: number; colorClasses: string }) {
  return (
    <div className="bg-white rounded-2xl border border-[#e6ecf5] p-4 text-left">
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">{label}</p>
      <span className={`inline-block text-2xl font-extrabold rounded-lg px-2.5 py-0.5 ${colorClasses}`}>{value}</span>
    </div>
  );
}
