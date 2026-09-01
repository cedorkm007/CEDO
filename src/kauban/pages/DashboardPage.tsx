import type { KaubanPage, KaubanRole } from "../types";
import { toolsForRole } from "../kaubanTools";

const KID_FONT = { fontFamily: "'Fredoka', sans-serif" };

/**
 * Home screen after role selection — a grid of the tools available to
 * that role (see kaubanTools.ts's per-tool `roles` list, copied from the
 * original app's own per-controller role checks). The "Kauban" brand,
 * role badge, and "Switch Role" control used to live here but now live
 * in KaubanTopNav.tsx (persistent across every screen), so this page is
 * just the tool grid itself. Most Kauban users are kids under 8 on a
 * phone/tablet, so tiles use big touch targets, a distinct bright color
 * per tool, the rounded "Fredoka" display font, and a tactile press
 * animation instead of a hover-only affordance.
 */
export function DashboardPage({ role, onNavigate }: {
  role: KaubanRole;
  onNavigate: (page: KaubanPage) => void;
}) {
  const tools = toolsForRole(role);

  return (
    <div className="rounded-[20px] bg-[#F7FAFC] p-4 shadow-xl sm:p-10">
      <h1 className="mb-5 text-lg font-semibold text-[#2D3748] sm:mb-8 sm:text-xl" style={KID_FONT}>
        Hi! What do you want to do?
      </h1>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
        {tools.map(tool => (
          <button
            key={tool.page}
            onClick={() => onNavigate(tool.page)}
            className="flex min-h-[132px] flex-col items-start gap-2.5 rounded-3xl border-2 border-transparent bg-white p-4 text-left shadow-sm transition-all duration-150 active:scale-95 active:shadow-md sm:gap-3 sm:p-5 sm:hover:-translate-y-0.5 sm:hover:border-[#3182CE] sm:hover:shadow-md focus:outline-none focus-visible:ring-4 focus-visible:ring-[#3182CE]/30"
          >
            <span
              className="flex h-12 w-12 items-center justify-center rounded-2xl sm:h-14 sm:w-14"
              style={{ backgroundColor: tool.bg, color: tool.fg }}
            >
              <tool.icon size={24} />
            </span>
            <span>
              <span className="block text-base font-semibold text-[#2D3748]" style={KID_FONT}>{tool.label}</span>
              <span className="mt-0.5 block text-xs text-[#718096] sm:text-sm">{tool.description}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
