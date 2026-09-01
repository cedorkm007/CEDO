import { RefreshCw } from "lucide-react";
import type { KaubanPage, KaubanRole } from "../types";
import { toolsForRole } from "../kaubanTools";

const ROLE_LABEL: Record<KaubanRole, string> = {
  deaf: "Deaf",
  "hard-of-hearing": "Hard of Hearing",
  hearing: "Hearing",
};

// Matches the original app's own `.user-role-badge.{deaf,hard-hearing,hearing}`
// gradients in resources/views/layout.blade.php exactly.
const ROLE_BADGE_STYLE: Record<KaubanRole, { background: string; color: string }> = {
  deaf: { background: "linear-gradient(135deg, #F6E05E 0%, #D69E2E 100%)", color: "#744210" },
  "hard-of-hearing": { background: "linear-gradient(135deg, #48BB78 0%, #38A169 100%)", color: "#ffffff" },
  hearing: { background: "linear-gradient(135deg, #4299E1 0%, #3182CE 100%)", color: "#ffffff" },
};

/**
 * Home screen after role selection — a grid of the tools available to
 * that role (see kaubanTools.ts's per-tool `roles` list, copied from the
 * original app's own per-controller role checks). "Switch role" resets
 * back to RoleSelectionPage, same as the original app's "Switch User".
 * Colors match layout.blade.php: gradient body, light content card,
 * app-brand green title, per-role gradient badge.
 */
export function DashboardPage({ role, onNavigate, onSwitchRole }: {
  role: KaubanRole;
  onNavigate: (page: KaubanPage) => void;
  onSwitchRole: () => void;
}) {
  const tools = toolsForRole(role);

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#059669] to-[#2563EB] p-4 sm:p-8">
      <div className="mx-auto max-w-4xl rounded-[20px] bg-[#F7FAFC] p-6 shadow-xl sm:p-10">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-extrabold text-[#10B981]">Kauban</h1>
            <span
              className="rounded-full px-3 py-1 text-xs font-semibold"
              style={ROLE_BADGE_STYLE[role]}
            >
              {ROLE_LABEL[role]}
            </span>
          </div>
          <button
            onClick={onSwitchRole}
            className="flex items-center gap-1.5 rounded-lg bg-[#EBF8FF] px-3 py-2 text-xs font-semibold text-[#2B6CB0] hover:bg-[#BEE3F8]"
          >
            <RefreshCw size={13} /> Switch Role
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
          {tools.map(tool => (
            <button
              key={tool.page}
              onClick={() => onNavigate(tool.page)}
              className="flex flex-col items-start gap-3 rounded-2xl border border-transparent bg-white p-5 text-left shadow-sm transition hover:border-[#3182CE] hover:shadow-md focus:outline-none focus-visible:ring-4 focus-visible:ring-[#3182CE]/30"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#EBF8FF] text-[#2B6CB0]">
                <tool.icon size={22} />
              </span>
              <span>
                <span className="block text-base font-bold text-[#2D3748]">{tool.label}</span>
                <span className="block text-sm text-[#718096]">{tool.description}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
