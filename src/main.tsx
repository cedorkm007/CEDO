
  import { createRoot } from "react-dom/client";
  import App from "./app/App.tsx";
  import { ScholarSiteApp } from "./scholar/ScholarSiteApp.tsx";
  import { KaubanApp } from "./kauban/KaubanApp.tsx";
  import "./styles/index.css";

  // Three separate apps, one Vite build, one Vercel deployment:
  //  - "/"        -> the existing staff/admin app (src/app/App.tsx). Now also
  //                  includes "Scholar Management Tools" as a page inside it
  //                  (src/sead/ScholarManagementToolsPage.tsx), visible only to
  //                  the "sead.sma1" account — not a separate module/login.
  //  - "/CEDO*"   -> the public CEDO site + Scholar Portal (src/scholar/ScholarSiteApp.tsx).
  //                  Matched case-insensitively, so /CEDO and /cedo both work.
  //  - "/kauban*" -> Kauban, a sign-language/speech accessibility tool for deaf
  //                  and hard-of-hearing learners (src/kauban/KaubanApp.tsx).
  //                  No accounts at all — see docs/kauban/PROGRESS.md.
  // All three talk to the same Supabase project/database (src/lib/supabase.ts).
  const path = window.location.pathname.toLowerCase();
  const isKaubanSite = path.startsWith("/kauban");
  const isScholarSite = !isKaubanSite && path.startsWith("/cedo");

  createRoot(document.getElementById("root")!).render(
    isKaubanSite ? <KaubanApp /> : isScholarSite ? <ScholarSiteApp /> : <App />
  );
