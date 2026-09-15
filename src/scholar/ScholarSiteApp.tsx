import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { PublicNav } from "./components/PublicNav";
import { CEDOHomePage } from "./pages/CEDOHomePage";
import { UnderDevelopmentPage } from "./pages/UnderDevelopmentPage";
import { ScholarLoginPage } from "./pages/ScholarLoginPage";
import { ScholarPortalPage } from "./pages/ScholarPortalPage";
import { FinancialAssistanceStatusPage } from "./pages/FinancialAssistanceStatusPage";
import type { PublicPage } from "./types";

type SiteView = PublicPage | "scholar-login" | "new-college" | "new-law-medical" | "portal" | "financial-assistance-status";

// Every view gets its own URL under /CEDO so a scholar can bookmark/share a
// direct link (e.g. a QR code to the login page) and so refreshing the page
// stays on the same view instead of bouncing back to the home page — before
// this, `view` was purely in-memory React state with no URL of its own.
const VIEW_PATHS: Record<SiteView, string> = {
  home: "", articles: "articles", programs: "programs", statistics: "statistics",
  "new-college": "new-college", "new-law-medical": "new-law-medical",
  "scholar-login": "login", portal: "portal",
  "financial-assistance-status": "financial-assistance-status",
};
const PATH_TO_VIEW = Object.fromEntries(
  Object.entries(VIEW_PATHS).map(([view, path]) => [path, view])
) as Record<string, SiteView>;

// main.tsx matches "/cedo" case-insensitively, so a URL built here can
// safely always use this one canonical casing regardless of how the visitor
// originally arrived.
const SITE_BASE_PATH = "/CEDO";

function viewFromLocation(): SiteView {
  const segments = window.location.pathname.split("/").filter(Boolean); // e.g. ["CEDO", "login"]
  return PATH_TO_VIEW[(segments[1] ?? "").toLowerCase()] ?? "home";
}

function pathForView(view: SiteView): string {
  const segment = VIEW_PATHS[view];
  return segment ? `${SITE_BASE_PATH}/${segment}` : SITE_BASE_PATH;
}

/**
 * Root of the public CEDO site + Scholar Portal (mounted at /scholars, see
 * src/main.tsx). Entirely separate from src/app/App.tsx (the staff/admin
 * app mounted at /) — different account system (public.scholars), same
 * Supabase project and Auth service.
 */
export function ScholarSiteApp() {
  const [view, setViewState] = useState<SiteView>(() => viewFromLocation());
  const [checkingSession, setCheckingSession] = useState(true);

  // Wraps setViewState so every view change also updates the address bar
  // (browser back/forward then works too, via the popstate listener below).
  function setView(next: SiteView) {
    setViewState(next);
    const path = pathForView(next);
    if (window.location.pathname !== path) window.history.pushState(null, "", path);
  }

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

    function onPopState() { setViewState(viewFromLocation()); }
    window.addEventListener("popstate", onPopState);
    return () => {
      subscription.unsubscribe();
      window.removeEventListener("popstate", onPopState);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (checkingSession) {
    return <div className="min-h-screen flex items-center justify-center text-slate-400 text-sm">Loading…</div>;
  }

  const navPage: PublicPage | "login" | "portal" =
    view === "scholar-login" ? "login"
    : view === "portal" ? "portal"
    : (["home", "articles", "programs", "statistics"] as string[]).includes(view) ? (view as PublicPage)
    : "home";

  return (
    <div className="min-h-screen bg-white">
      {view !== "financial-assistance-status" && (
        <div className={view === "portal" ? "hidden md:block" : ""}>
          <PublicNav
            page={navPage}
            onNavigate={(p) => setView(p)}
            onExistingScholar={() => setView("scholar-login")}
            onNewApplicant={(kind) => setView(kind === "college" ? "new-college" : "new-law-medical")}
          />
        </div>
      )}

      {view === "home" && <CEDOHomePage />}
      {view === "articles" && <UnderDevelopmentPage title="Articles" />}
      {view === "programs" && <UnderDevelopmentPage title="Programs" />}
      {view === "statistics" && <UnderDevelopmentPage title="Statistics" />}
      {view === "new-college" && <UnderDevelopmentPage title="New Applicant — College Scholarship" />}
      {view === "new-law-medical" && <UnderDevelopmentPage title="New Applicant — Law and Medical Scholarship" />}
      {view === "scholar-login" && <ScholarLoginPage onLoginSuccess={() => setView("portal")} />}
      {view === "portal" && <ScholarPortalPage onSignOut={() => setView("home")} />}
      {view === "financial-assistance-status" && <FinancialAssistanceStatusPage />}
    </div>
  );
}
