import { RefreshCw } from "lucide-react";
import type { KaubanPage, KaubanRole } from "../types";
import { toolsForRole } from "../kaubanTools";

const ROLE_LABEL: Record<KaubanRole, string> = {
  deaf: "Deaf",
  "hard-of-hearing": "Hard of Hearing",
  hearing: "Hearing",
};

/**
 * Home screen after role selection — a grid of the tools available to
 * that role (see kaubanTools.ts's per-tool `roles` list, copied from the
 * original app's own per-controller role checks). "Switch role" resets
 * back to RoleSelectionPage, same as the original app's "Switch User".
 */
export function DashboardPage({ role, onNavigate, onSwitchRole }: {
  role: KaubanRole;
  onNavigate: (page: KaubanPage) => void;
  onSwitchRole: () => void;
}) {
  const tools = toolsForRole(role);

  return (
    <div className="min-h-screen bg-[#FAF9FC] px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold text-[#1E1B3A]">Kauban</h1>
            <p className="text-sm text-slate-500">Signed in as: {ROLE_LABEL[role]}</p>
          </div>
          <button
            onClick={onSwitchRole}
            className="flex items-center gap-1.5 rounded-lg border border-[#4F46E5]/20 bg-white px-3 py-2 text-xs font-semibold text-[#4F46E5] hover:bg-[#4F46E5]/5"
          >
            <RefreshCw size={13} /> Switch Role
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
          {tools.map(tool => (
            <button
              key={tool.page}
              onClick={() => onNavigate(tool.page)}
              className="flex flex-col items-start gap-3 rounded-2xl border border-[#4F46E5]/10 bg-white p-5 text-left shadow-sm transition hover:border-[#4F46E5] hover:shadow-md focus:outline-none focus-visible:ring-4 focus-visible:ring-[#4F46E5]/30"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#4F46E5]/10 text-[#4F46E5]">
                <tool.icon size={22} />
              </span>
              <span>
                <span className="block text-base font-bold text-[#1E1B3A]">{tool.label}</span>
                <span className="block text-sm text-slate-500">{tool.description}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
