import { FolderCheck } from "lucide-react";

/** Placeholder — populated once a project can actually reach Implementation (Phase D.4/D.5 of the approved plan). */
export function MyApprovedProjectsSubtab() {
  return (
    <div className="bg-white rounded-2xl border border-[#e6ecf5] p-10 text-center text-slate-400">
      <FolderCheck size={22} className="mx-auto mb-2 text-slate-300" />
      No approved projects yet. Once a proposal moves to Implementation, it will appear here.
    </div>
  );
}
