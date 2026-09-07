import { FolderKanban } from "lucide-react";

/**
 * Every research project's tracked lifecycle stage. Defined here (rather
 * than deferred until a real backend exists) so the eventual research
 * projects table/RPC can be designed against a shape the UI already
 * expects, instead of the UI being reshaped around whatever the backend
 * ends up returning.
 */
export const STAGE_PIPELINE = [
  "Concept",
  "Proposal Development",
  "Review",
  "Approval",
  "Implementation",
  "Monitoring",
  "Dissemination",
  "Utilization",
  "Preservation",
  "Institutional Learning",
] as const;
export type ResearchProjectStage = (typeof STAGE_PIPELINE)[number];

export type ResearchProjectStatus = "Drafting" | "Ongoing" | "For Review" | "Completed";
export const RESEARCH_STATUSES: ResearchProjectStatus[] = ["Drafting", "Ongoing", "For Review", "Completed"];

export interface ResearchProject {
  id: string;
  title: string;
  status: ResearchProjectStatus;
  stage: ResearchProjectStage;
  lastUpdated: string;
  nextAction: string;
}

const STATUS_COLOR_CLASSES: Record<ResearchProjectStatus, string> = {
  Drafting: "bg-slate-100 text-slate-600",
  Ongoing: "bg-blue-100 text-blue-700",
  "For Review": "bg-amber-100 text-amber-700",
  Completed: "bg-green-100 text-green-700",
};

/**
 * UI-only shell — deliberately not wired to a real research_projects table
 * yet (see the approved plan's Phase A scope). The stat cards and matrix
 * below always render their empty state until a backend phase gives them
 * something to fetch; STAGE_PIPELINE/ResearchProjectStatus/ResearchProject
 * are kept here so that phase can slot straight into this shape.
 */
export function MonitoringSubtab() {
  const projects: ResearchProject[] = [];
  const completedCount = projects.filter(p => p.status === "Completed").length;
  const ongoingCount = projects.filter(p => p.status === "Ongoing").length;
  const forReviewCount = projects.filter(p => p.status === "For Review").length;

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-6">
        <div className="bg-[#062444] rounded-2xl p-5 text-left sm:col-span-1">
          <p className="text-[11px] font-bold uppercase tracking-wide text-white/60 mb-1.5">Total Research Projects</p>
          <p className="text-4xl font-extrabold text-white">{projects.length}</p>
        </div>
        <StatCard label="Completed" value={completedCount} colorClasses="bg-green-100 text-green-700" />
        <StatCard label="Active" value={ongoingCount} colorClasses="bg-blue-100 text-blue-700" />
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
              {projects.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                    <div className="flex flex-col items-center gap-2">
                      <FolderKanban size={22} className="text-slate-300" />
                      <span>No research projects yet — this view isn't wired to a data source yet.</span>
                    </div>
                  </td>
                </tr>
              ) : (
                projects.map(p => (
                  <tr key={p.id} className="border-b border-[#f0f3f8] last:border-0">
                    <td className="px-4 py-3 font-semibold text-[#062444]">{p.title}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded-lg px-2 py-0.5 font-bold ${STATUS_COLOR_CLASSES[p.status]}`}>{p.status}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{p.stage}</td>
                    <td className="px-4 py-3 text-slate-500">{p.lastUpdated}</td>
                    <td className="px-4 py-3 text-slate-500">{p.nextAction}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
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
