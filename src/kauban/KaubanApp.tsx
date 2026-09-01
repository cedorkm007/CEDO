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
import type { KaubanPage, KaubanRole } from "./types";

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
 * Every one of the 9 dashboard tools has its own case below — no
 * placeholder screens remain (the last one, "Sign Language Tools", was
 * filled in once its original controller/view were actually found and
 * read; see docs/kauban/PROGRESS.md).
 */
export function KaubanApp() {
  const [role, setRole] = useState<KaubanRole | null>(() => getKaubanRole());
  const [page, setPage] = useState<KaubanPage>("dashboard");

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

  const goToDashboard = () => setPage("dashboard");

  switch (page) {
    case "dashboard":
      return <DashboardPage role={role} onNavigate={setPage} onSwitchRole={handleSwitchRole} />;
    case "quickPhrases":
      return <QuickPhrasesPage onBack={goToDashboard} />;
    case "signLanguage":
      return <SignLanguagePage onBack={goToDashboard} />;
    case "signLanguageQuiz":
      return <SignLanguageQuizPage onBack={goToDashboard} />;
    case "signLanguageTools":
      return <SignLanguageToolsPage role={role} onNavigate={setPage} onBack={goToDashboard} />;
    case "speechToSignLanguage":
      return <SpeechToSignLanguagePage onBack={goToDashboard} />;
    case "textToSpeech":
      return <TextToSpeechPage onBack={goToDashboard} />;
    case "speechToText":
      return <SpeechToTextPage onBack={goToDashboard} />;
    case "drawingPad":
      return <DrawingPadPage onBack={goToDashboard} />;
    case "emergency":
      return <EmergencyPage onBack={goToDashboard} />;
  }
}
