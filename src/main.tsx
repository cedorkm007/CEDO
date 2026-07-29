
  import { createRoot } from "react-dom/client";
  import App from "./app/App.tsx";
  import { ScholarSiteApp } from "./scholar/ScholarSiteApp.tsx";
  import "./styles/index.css";

  // Two separate apps, one Vite build, one Vercel deployment:
  //  - "/"          -> the existing staff/admin app (src/app/App.tsx), unchanged.
  //  - "/scholars*" -> the public CEDO site + Scholar Portal (src/scholar/ScholarSiteApp.tsx).
  // Both talk to the same Supabase project/database (src/lib/supabase.ts).
  const isScholarSite = window.location.pathname.startsWith("/scholars");

  createRoot(document.getElementById("root")!).render(
    isScholarSite ? <ScholarSiteApp /> : <App />
  );
