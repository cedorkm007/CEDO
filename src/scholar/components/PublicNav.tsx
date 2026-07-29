import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import CEDOLogoWhite from "@/imports/scholar/CEDO_Logo_White.png";
import type { PublicPage } from "../types";

interface PublicNavProps {
  page: PublicPage | "login" | "portal";
  onNavigate: (page: PublicPage) => void;
  onExistingScholar: () => void;
  onNewApplicant: (kind: "college" | "law-medical") => void;
}

/**
 * The dark-navy top nav shared by every public CEDO page (Home, Articles,
 * Programs, Statistics) and reused, per the brief, as the top of the
 * Scholar Portal itself once logged in ("I want the top navigation to be
 * the same as the navigation panel of the home page").
 */
export function PublicNav({ page, onNavigate, onExistingScholar, onNewApplicant }: PublicNavProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setDropdownOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const navItems: { key: PublicPage; label: string }[] = [
    { key: "home", label: "HOME" },
    { key: "articles", label: "ARTICLES" },
    { key: "programs", label: "PROGRAMS" },
    { key: "statistics", label: "STATISTICS" },
  ];

  return (
    <header className="sticky top-0 z-50 bg-[#1F334F] shadow-md">
      <div className="max-w-[1280px] mx-auto flex items-center justify-between h-[64px] px-4 md:px-8">
        <button onClick={() => onNavigate("home")} className="flex items-center gap-2 shrink-0">
          <img src={CEDOLogoWhite} alt="CEDO — City Education and Development Office" className="h-9 md:h-10 w-auto" />
        </button>

        <nav className="hidden md:flex items-center gap-8">
          {navItems.map(item => (
            <button
              key={item.key}
              onClick={() => onNavigate(item.key)}
              className={`text-[13px] font-bold tracking-wide transition-colors ${
                page === item.key ? "text-[#F3BC00]" : "text-white/90 hover:text-[#F3BC00]"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div ref={wrapRef} className="relative shrink-0">
          <button
            onClick={() => setDropdownOpen(o => !o)}
            className="flex items-center gap-1.5 bg-[#F3BC00] hover:bg-[#e0ac00] text-[#1F334F] text-[13px] font-bold tracking-wide px-4 py-2 rounded-md transition-colors"
          >
            SCHOLAR LOG IN
            <ChevronDown size={15} className={`transition-transform ${dropdownOpen ? "rotate-180" : ""}`} />
          </button>

          {dropdownOpen && (
            <div className="absolute right-0 mt-2 w-[260px] bg-[#1F334F]/95 backdrop-blur-sm rounded-lg shadow-xl border border-white/10 p-2 flex flex-col gap-1.5">
              <button
                onClick={() => { setDropdownOpen(false); onExistingScholar(); }}
                className="text-center bg-[#16283F] hover:bg-[#0f1d2f] text-white text-[13px] font-bold tracking-wide rounded-full px-4 py-3 transition-colors"
              >
                EXISTING SCHOLAR
              </button>
              <button
                onClick={() => { setDropdownOpen(false); onNewApplicant("college"); }}
                className="text-center bg-[#16283F] hover:bg-[#0f1d2f] text-white text-[13px] font-bold tracking-wide rounded-full px-4 py-3 leading-tight transition-colors"
              >
                NEW APPLICANT FOR<br />COLLEGE SCHOLARSHIP
              </button>
              <button
                onClick={() => { setDropdownOpen(false); onNewApplicant("law-medical"); }}
                className="text-center bg-[#16283F] hover:bg-[#0f1d2f] text-white text-[13px] font-bold tracking-wide rounded-full px-4 py-3 leading-tight transition-colors"
              >
                NEW APPLICANT FOR<br />LAW AND MEDICAL SCHOLARSHIP
              </button>
            </div>
          )}
        </div>

        {/* Mobile nav */}
        <nav className="md:hidden flex items-center gap-4 absolute left-1/2 -translate-x-1/2 top-full bg-[#1F334F] w-full justify-center py-2 border-t border-white/10">
          {navItems.map(item => (
            <button
              key={item.key}
              onClick={() => onNavigate(item.key)}
              className={`text-[11px] font-bold tracking-wide ${page === item.key ? "text-[#F3BC00]" : "text-white/80"}`}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </div>
    </header>
  );
}
