import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { SchoolLoginPage } from "./pages/SchoolLoginPage";
import { SchoolPortalPage } from "./pages/SchoolPortalPage";
import { ForcePasswordChange } from "@/app/components/ForcePasswordChange";
import { usePasswordChangeRequired } from "@/lib/passwordGate";

type SiteView = "login" | "portal";

/**
 * Root of the School Portal (mounted at /school, see src/main.tsx).
 * Entirely separate from src/app/App.tsx (staff) and
 * src/scholar/ScholarSiteApp.tsx (scholars) — a third account system
 * (public.school_accounts), same Supabase project and Auth service.
 * Simpler than ScholarSiteApp: no public marketing site to also serve at
 * this path, just session-check -> login or portal.
 */
export function SchoolSiteApp() {
  const [view, setView] = useState<SiteView>("login");
  const [checkingSession, setCheckingSession] = useState(true);
  // A school given a TEMPORARY password (new account, or reset by IT) must choose its own before anything else (Phase 6).
  const passwordGate = usePasswordChangeRequired(view === "portal" ? "school" : null);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) setView("portal");
      setCheckingSession(false);
    })();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") setView("login");
    });
    return () => subscription.unsubscribe();
  }, []);

  if (checkingSession) {
    return <div className="min-h-screen flex items-center justify-center text-slate-700 text-[15px]">Loading…</div>;
  }

  if (view === "portal" && passwordGate.required) {
    return <ForcePasswordChange who="your school username" avoid={[]} onDone={passwordGate.clear} onSignOut={() => { void supabase.auth.signOut(); setView("login"); }} />;
  }

  return (
    <div className="min-h-screen bg-white">
      {view === "login" && <SchoolLoginPage onLoginSuccess={() => setView("portal")} />}
      {view === "portal" && <SchoolPortalPage onSignOut={() => setView("login")} />}
    </div>
  );
}
