import { useEffect, useRef, useState } from "react";
import { getKaubanRole, setKaubanRole, clearKaubanRole } from "./localRole";
import { RoleSelectionPage } from "./pages/RoleSelectionPage";
import { DashboardPage } from "./pages/DashboardPage";
import { QuickPhrasesPage } from "./pages/QuickPhrasesPage";
import { SignLanguagePage } from "./pages/SignLanguagePage";
import { SignLanguageQuizPage } from "./pages/SignLanguageQuizPage";
import { SignLanguageToolsPage } from "./pages/SignLanguageToolsPage";
import { SpeechToSignLanguagePage } from "./pages/SpeechToSignLanguagePage";
import { TextToSpeechPage } from "./pages/TextToSpeechPage";
import { SpeechToTextPage } from "./pages/SpeechToTextPage";
import { DrawingPadPage } from "./pages/DrawingPadPage";
import { EmergencyPage } from "./pages/EmergencyPage";
import { KaubanTopNav } from "./components/KaubanTopNav";
import { KaubanBottomNav } from "./components/KaubanBottomNav";
import { OfflineDownloadModal } from "./components/OfflineDownloadModal";
import type { KaubanPage, KaubanRole } from "./types";

// Reached only via the Sign Language Tools hub — "Back" from any of these
// returns to the hub, not the dashboard, matching how a person actually
// arrived (same reasoning as HUB_SUB_PAGES in KaubanBottomNav.tsx).
const HUB_SUB_PAGES: KaubanPage[] = ["textToSpeech", "speechToSignLanguage", "signLanguage", "signLanguageQuiz"];

// This app has no real per-page routing (see the class comment below) —
// every "page" is just React state, so the browser (and, critically, the
// TWA's own Android back button) has no history to step through and
// exits the whole app on the very first back press. Fixed by mirroring
// `page` into browser history so there's something to pop, and reacting
// to that pop with the exact same "smart back" rule already used by the
// in-app Back button (see handleBack below) — not real navigation
// history, since jumping between top-level tools via the bottom nav
// shouldn't create a long back-stack, only the fixed dashboard/hub
// hierarchy should. Depth is a pure function of the page itself:
// dashboard (0) -> hub or any top-level tool (1) -> a hub sub-page (2).
function depthOf(page: KaubanPage): number {
  if (page === "dashboard") return 0;
  if (HUB_SUB_PAGES.includes(page)) return 2;
  return 1;
}

/**
 * Root of the public Kauban app (mounted at /kauban, see src/main.tsx).
 * Entirely separate from src/app/App.tsx (staff) and
 * src/scholar/ScholarSiteApp.tsx (public CEDO site + Scholar Portal) —
 * different Supabase tables, no accounts at all (see docs/kauban/
 * PROGRESS.md milestone 1). Follows the same manual view-state pattern
 * as ScholarSiteApp.tsx rather than a client-side router, for consistency
 * with how the rest of this codebase is built (react-router is an
 * installed but otherwise-unused dependency here).
 *
 * Every screen after role selection sits inside the persistent top/bottom
 * nav shell (KaubanTopNav/KaubanBottomNav) — a direct port of the
 * original app's own always-present `.app-header` and `.bottom-nav`
 * (resources/views/layout.blade.php), which is why individual page
 * components no longer manage their own full-screen background or a
 * back button (see docs/kauban/PROGRESS.md).
 */
export function KaubanApp() {
  const [role, setRole] = useState<KaubanRole | null>(() => getKaubanRole());
  const [page, setPage] = useState<KaubanPage>("dashboard");
  const [showOfflineDownload, setShowOfflineDownload] = useState(false);

  const trackedDepthRef = useRef(0);
  const initializedRef = useRef(false);
  // Always-fresh mirror of `page` for the popstate handler below, which is
  // registered once rather than re-subscribed on every page change — an
  // earlier version re-subscribed per page change and, confirmed live on
  // device, could still leave a stale closure in place for a popstate that
  // lands in the tiny window between a fast repeated back-press and
  // React's next render.
  const pageRef = useRef(page);
  useEffect(() => { pageRef.current = page; }, [page]);

  // Keeps one browser-history entry per level of depth so there's
  // something for the hardware/gesture back button to pop. Runs even
  // before a role is picked (initializedRef guards the very first run,
  // which just establishes the base entry rather than pushing a new one).
  useEffect(() => {
    if (!role) return;
    if (!initializedRef.current) {
      initializedRef.current = true;
      history.replaceState({ page }, "");
      trackedDepthRef.current = depthOf(page);
      return;
    }
    const newDepth = depthOf(page);
    if (newDepth > trackedDepthRef.current) {
      history.pushState({ page }, "");
    } else {
      // Either a genuine hardware-back pop (the browser already moved;
      // this just keeps the entry's stored state in sync) or an explicit
      // jump straight to a shallower page (Home, Switch Role) — in that
      // second case the real history stack still has stale entries below
      // this one. That's harmless: the popstate handler's own refill-at-
      // dashboard logic below self-heals it on the next back press.
      history.replaceState({ page }, "");
    }
    trackedDepthRef.current = newDepth;
  }, [role, page]);

  // Reacts to the hardware/gesture back button. Deliberately ignores
  // event.state and recomputes the target from current `page` instead,
  // using the exact same rule as the in-app Back button (handleBack
  // below) — that's the whole point of wiring this up, so both agree.
  //
  // At the dashboard (depth 0), earlier versions did nothing here, which
  // let each further back press keep consuming the WebView's own real
  // history entries with nothing pushed back to replace them. Confirmed
  // live on device: once that stack was fully drained, the TWA's hosting
  // Custom Tab didn't cleanly exit the app — it went blank instead. So at
  // depth 0, a press pushes a fresh entry right back — the dashboard
  // doesn't visibly change, but the WebView's stack can never run dry.
  // The tradeoff is that hardware back can no longer exit the app from
  // the dashboard at all; leaving requires the device's home/recents
  // gesture instead, same as many single-page apps with a persistent
  // shell like this one.
  useEffect(() => {
    if (!role) return;
    function onPopState() {
      const current = pageRef.current;
      if (current === "dashboard") {
        history.pushState({ page: "dashboard" }, "");
        return;
      }
      setPage(HUB_SUB_PAGES.includes(current) ? "signLanguageTools" : "dashboard");
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [role]);

  function handleSelectRole(selected: KaubanRole) {
    setKaubanRole(selected);
    setRole(selected);
  }

  function handleSwitchRole() {
    clearKaubanRole();
    setRole(null);
    setPage("dashboard");
  }

  if (!role) {
    return <RoleSelectionPage onSelect={handleSelectRole} />;
  }
  // Re-bound to a `const` with an explicit non-null type so the nested
  // renderPage() closure below sees a plain KaubanRole — `tsc -b` (what
  // `npm run build` actually runs) doesn't carry the `if (!role)` guard's
  // narrowing into a closure the way plain `tsc --noEmit` does, the same
  // class of build-vs-typecheck mismatch found in milestone 11.
  const currentRole: KaubanRole = role;

  const goToDashboard = () => setPage("dashboard");
  const goToHub = () => setPage("signLanguageTools");
  const handleBack = HUB_SUB_PAGES.includes(page) ? goToHub : goToDashboard;

  function renderPage() {
    switch (page) {
      case "dashboard":
        return <DashboardPage role={currentRole} onNavigate={setPage} />;
      case "quickPhrases":
        return <QuickPhrasesPage />;
      case "signLanguage":
        return <SignLanguagePage />;
      case "signLanguageQuiz":
        return <SignLanguageQuizPage />;
      case "signLanguageTools":
        return <SignLanguageToolsPage role={currentRole} onNavigate={setPage} />;
      case "speechToSignLanguage":
        return <SpeechToSignLanguagePage />;
      case "textToSpeech":
        return <TextToSpeechPage />;
      case "speechToText":
        return <SpeechToTextPage />;
      case "drawingPad":
        return <DrawingPadPage />;
      case "emergency":
        return <EmergencyPage />;
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#059669] to-[#2563EB] pb-28 sm:pb-32">
      <KaubanTopNav
        role={currentRole}
        page={page}
        showBack={page !== "dashboard"}
        onNavigateHome={goToDashboard}
        onBack={handleBack}
        onSwitchRole={handleSwitchRole}
        onDownloadForOffline={() => setShowOfflineDownload(true)}
      />
      <div className="mx-auto max-w-4xl px-3 pt-4 sm:px-8 sm:pt-6">
        {renderPage()}
      </div>
      <KaubanBottomNav role={currentRole} page={page} onNavigate={setPage} />
      {showOfflineDownload && <OfflineDownloadModal onClose={() => setShowOfflineDownload(false)} />}
    </div>
  );
}
