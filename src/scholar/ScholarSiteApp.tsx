import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { PublicNav } from "./components/PublicNav";
import { CEDOHomePage } from "./pages/CEDOHomePage";
import { UnderDevelopmentPage } from "./pages/UnderDevelopmentPage";
import { ScholarLoginPage } from "./pages/ScholarLoginPage";
import { ScholarResetPasswordPage } from "./pages/ScholarResetPasswordPage";
import { ScholarPortalPage } from "./pages/ScholarPortalPage";
import type { PublicPage } from "./types";

type SiteView = PublicPage | "scholar-login" | "reset-password" | "new-college" | "new-law-medical" | "portal";

/**
 * Root of the public CEDO site + Scholar Portal (mounted at /scholars, see
 * src/main.tsx). Entirely separate from src/app/App.tsx (the staff/admin
 * app mounted at /) — different account system (public.scholars), same
 * Supabase project and Auth service.
 */
export function ScholarSiteApp() {
  const [view, setView] = useState<SiteView>("home");
  const [checkingSession, setCheckingSession] = useState(true);

  // On load / refresh, if there's already a valid Supabase Auth session for
  // a scholar, skip straight to the portal instead of showing the login form.
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) setView("portal");
      setCheckingSession(false);
    })();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") setView("home");
    });
    return () => subscription.unsubscribe();
  }, []);

  if (checkingSession) {
    return <div className="min-h-screen flex items-center justify-center text-slate-400 text-sm">Loading…</div>;
  }

  const navPage: PublicPage | "login" | "portal" =
    view === "scholar-login" || view === "reset-password" ? "login"
    : view === "portal" ? "portal"
    : (["home", "articles", "programs", "statistics"] as string[]).includes(view) ? (view as PublicPage)
    : "home";

  return (
    <div className="min-h-screen bg-white">
      <div className={view === "portal" ? "hidden md:block" : ""}>
        <PublicNav
          page={navPage}
          onNavigate={(p) => setView(p)}
          onExistingScholar={() => setView("scholar-login")}
          onNewApplicant={(kind) => setView(kind === "college" ? "new-college" : "new-law-medical")}
        />
      </div>

      {view === "home" && <CEDOHomePage />}
      {view === "articles" && <UnderDevelopmentPage title="Articles" />}
      {view === "programs" && <UnderDevelopmentPage title="Programs" />}
      {view === "statistics" && <UnderDevelopmentPage title="Statistics" />}
      {view === "new-college" && <UnderDevelopmentPage title="New Applicant — College Scholarship" />}
      {view === "new-law-medical" && <UnderDevelopmentPage title="New Applicant — Law and Medical Scholarship" />}
      {view === "scholar-login" && (
        <ScholarLoginPage onLoginSuccess={() => setView("portal")} onResetPassword={() => setView("reset-password")} />
      )}
      {view === "reset-password" && <ScholarResetPasswordPage onBack={() => setView("scholar-login")} />}
      {view === "portal" && <ScholarPortalPage onSignOut={() => setView("home")} />}
    </div>
  );
}
