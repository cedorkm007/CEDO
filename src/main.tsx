
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

  // PWA baseline for Kauban only (docs/kauban/PROGRESS.md milestone 16):
  // manifest link, iOS home-screen icon, and theme-color are injected here
  // rather than in the shared index.html so the staff app and public CEDO
  // site — which share this one Vite build — aren't affected.
  if (isKaubanSite) {
    const head = document.head;

    const manifestLink = document.createElement("link");
    manifestLink.rel = "manifest";
    manifestLink.href = "/kauban-manifest.webmanifest";
    head.appendChild(manifestLink);

    const appleIcon = document.createElement("link");
    appleIcon.rel = "apple-touch-icon";
    appleIcon.href = "/kauban-icons/apple-touch-icon.png";
    head.appendChild(appleIcon);

    const themeColor = document.createElement("meta");
    themeColor.name = "theme-color";
    themeColor.content = "#059669";
    head.appendChild(themeColor);

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("/kauban-sw.js", { scope: "/kauban" }).catch(() => {
          // Offline support is a progressive enhancement — a failed
          // registration (e.g. unsupported browser policy) shouldn't
          // block the app from working normally online.
        });
      });
    }
  }

  createRoot(document.getElementById("root")!).render(
    isKaubanSite ? <KaubanApp /> : isScholarSite ? <ScholarSiteApp /> : <App />
  );
