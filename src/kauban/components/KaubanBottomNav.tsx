import { Home } from "lucide-react";
import type { KaubanPage, KaubanRole } from "../types";
import { KAUBAN_TOOLS } from "../kaubanTools";

// These pages are all reached through the Sign Language Tools hub, so
// they light up that one icon instead of having their own — a direct
// port of the original app's own bottom-nav `active` check in
// resources/views/layout.blade.php, which matches all of these route
// names against a single combined icon. speechToText is deliberately
// NOT in this list: it has its own bottom-nav icon (see kaubanTools.ts),
// since the Dashboard kept it as its own tile per an earlier request.
const HUB_SUB_PAGES: KaubanPage[] = ["signLanguageTools", "textToSpeech", "speechToSignLanguage", "signLanguage", "signLanguageQuiz"];

/**
 * Persistent bottom bar, shown on every screen once a role is picked —
 * a direct port of the original app's floating pill-shaped `.bottom-nav`
 * (resources/views/layout.blade.php): Home + one icon per KAUBAN_TOOLS
 * entry, each tool's own bright color from the Dashboard carried through
 * here for a consistent look between the two navigation surfaces.
 */
export function KaubanBottomNav({ role, page, onNavigate }: {
  role: KaubanRole;
  page: KaubanPage;
  onNavigate: (page: KaubanPage) => void;
}) {
  const tools = KAUBAN_TOOLS.filter(t => t.roles === "all" || t.roles.includes(role));

  return (
    <div className="fixed bottom-3 left-1/2 z-30 w-[calc(100%-24px)] max-w-md -translate-x-1/2 sm:bottom-5">
      <div className="flex items-center justify-around gap-1 rounded-full bg-white p-2 shadow-xl">
        <button
          onClick={() => onNavigate("dashboard")}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-transform duration-150 active:scale-90 sm:h-14 sm:w-14"
          style={page === "dashboard" ? { backgroundColor: "#2B6CB0", color: "#fff" } : { backgroundColor: "#EBF8FF", color: "#2B6CB0" }}
          aria-label="Home"
        >
          <Home size={20} />
        </button>

        {tools.map(tool => {
          const active = tool.page === "signLanguageTools" ? HUB_SUB_PAGES.includes(page) : page === tool.page;
          return (
            <button
              key={tool.page}
              onClick={() => onNavigate(tool.page)}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-transform duration-150 active:scale-90 sm:h-14 sm:w-14"
              style={active ? { backgroundColor: tool.fg, color: "#fff" } : { backgroundColor: tool.bg, color: tool.fg }}
              aria-label={tool.label}
            >
              <tool.icon size={20} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
