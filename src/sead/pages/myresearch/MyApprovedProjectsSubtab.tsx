import { useEffect, useState } from "react";
import { FolderCheck } from "lucide-react";
import { fetchMyProjects, PROJECT_STAGES, STAGE_LABELS, type ResearchProject } from "../../researchProjectApi";

const IMPLEMENTATION_INDEX = PROJECT_STAGES.indexOf("implementation");

function StagePipeline({ currentStage }: { currentStage: ResearchProject["currentStage"] }) {
  const currentIndex = PROJECT_STAGES.indexOf(currentStage);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {PROJECT_STAGES.map((stage, i) => (
        <span key={stage}
          className={`text-[10.5px] font-bold rounded-full px-2.5 py-1 ${
            i === currentIndex ? "bg-[#062444] text-white" : i < currentIndex ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-400"
          }`}>
          {STAGE_LABELS[stage]}
        </span>
      ))}
    </div>
  );
}

/** Projects that have reached Implementation or beyond — moved here from My Proposals once the evaluator approves them past Proposal Development. Read-only until a later phase adds forms for Implementation-onward stages. */
export function MyApprovedProjectsSubtab() {
  const [projects, setProjects] = useState<ResearchProject[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const all = await fetchMyProjects();
      setProjects(all.filter(p => PROJECT_STAGES.indexOf(p.currentStage) >= IMPLEMENTATION_INDEX));
      setLoading(false);
    })();
  }, []);

  if (loading) return <p className="text-center text-slate-400 py-10">Loading…</p>;

  if (projects.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-[#e6ecf5] p-10 text-center text-slate-400">
        <FolderCheck size={22} className="mx-auto mb-2 text-slate-300" />
        No approved projects yet. Once a proposal moves to Implementation, it will appear here.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {projects.map(project => (
        <div key={project.id} className="bg-white rounded-2xl border border-[#e6ecf5] p-4">
          <h4 className="text-[13.5px] font-bold text-[#062444] mb-2.5">{project.title}</h4>
          <StagePipeline currentStage={project.currentStage} />
        </div>
      ))}
    </div>
  );
}
