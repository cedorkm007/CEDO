import { useState } from "react";
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
