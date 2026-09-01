import { useEffect, useState } from "react";
import { Home, ArrowLeft, RefreshCw } from "lucide-react";
import type { KaubanPage, KaubanRole } from "../types";

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
 * Persistent top bar, shown on every screen once a role is picked — a
 * direct port of the original app's `.app-header` (resources/views/
 * layout.blade.php): white floating bar, rounded bottom corners, "Kauban"
 * brand center, Home/Back on the left, a profile control on the right.
 * The original's profile dropdown only had one action ("Switch User");
 * this keeps that same one-item shape ("Switch Role").
 */
export function KaubanTopNav({ role, page, showBack, onNavigateHome, onBack, onSwitchRole }: {
  role: KaubanRole;
  page: KaubanPage;
  showBack: boolean;
  onNavigateHome: () => void;
  onBack: () => void;
  onSwitchRole: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  // This bar persists across every page (it's outside KaubanApp's
  // renderPage() switch), so its own local menuOpen state would otherwise
  // survive navigation — including navigation via KaubanBottomNav, which
  // sits visually on top of this dropdown's full-screen close-backdrop and
  // so never gives it a chance to fire. Closing on every page change
  // handles all navigation sources at once instead of chasing z-index.
  useEffect(() => {
    setMenuOpen(false);
  }, [page]);

  return (
    <div className="sticky top-0 z-30 rounded-b-3xl bg-white/95 px-3 py-2.5 shadow-md backdrop-blur sm:px-6 sm:py-3">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            onClick={onNavigateHome}
            className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#EBF8FF] text-[#2B6CB0] transition active:scale-90"
            aria-label="Home"
          >
            <Home size={19} />
          </button>
          {showBack && (
            <button
              onClick={onBack}
              className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#EBF8FF] text-[#2B6CB0] transition active:scale-90"
              aria-label="Go back"
            >
              <ArrowLeft size={19} />
            </button>
          )}
        </div>

        <p className="text-lg font-bold leading-none text-[#10B981] sm:text-xl" style={{ fontFamily: "'Fredoka', sans-serif" }}>
          Kauban
        </p>

        <div className="relative">
          <button
            onClick={() => setMenuOpen(o => !o)}
            className="flex h-11 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold transition active:scale-95 sm:text-sm"
            style={ROLE_BADGE_STYLE[role]}
          >
            {ROLE_LABEL[role]}
          </button>

          {menuOpen && (
            <>
              <button
                className="fixed inset-0 z-30 cursor-default"
                onClick={() => setMenuOpen(false)}
                aria-label="Close menu"
                tabIndex={-1}
              />
              <div className="absolute right-0 top-[52px] z-40 min-w-[170px] rounded-2xl border border-[#EDF2F7] bg-white p-1.5 shadow-lg">
                <button
                  onClick={() => { setMenuOpen(false); onSwitchRole(); }}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-[#2D3748] transition active:scale-[0.97] hover:bg-[#EBF8FF]"
                >
                  <RefreshCw size={14} /> Switch Role
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
