
  import { createRoot } from "react-dom/client";
  import App from "./app/App.tsx";
  import { ScholarSiteApp } from "./scholar/ScholarSiteApp.tsx";
  import "./styles/index.css";

  // Two separate apps, one Vite build, one Vercel deployment:
  //  - "/"       -> the existing staff/admin app (src/app/App.tsx). Now also
  //                 includes "Scholar Management Tools" as a page inside it
  //                 (src/sead/ScholarManagementToolsPage.tsx), visible only to
  //                 the "sead.sma1" account — not a separate module/login.
  //  - "/CEDO*"  -> the public CEDO site + Scholar Portal (src/scholar/ScholarSiteApp.tsx).
  //                 Matched case-insensitively, so /CEDO and /cedo both work.
  // Both talk to the same Supabase project/database (src/lib/supabase.ts).
  const isScholarSite = window.location.pathname.toLowerCase().startsWith("/cedo");

  createRoot(document.getElementById("root")!).render(
    isScholarSite ? <ScholarSiteApp /> : <App />
  );
