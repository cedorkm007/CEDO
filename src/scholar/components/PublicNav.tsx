import { useEffect, useRef, useState } from "react";
import { ChevronDown, Menu, LogIn } from "lucide-react";
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const mobileWrapRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      // dropdownOpen is shared between the desktop pill dropdown (wrapRef) and the
      // mobile square dropdown (mobileWrapRef) — both refs stay mounted at all
      // times (just CSS-hidden per breakpoint), so a click has to be outside BOTH
      // before it counts as "outside." Checking each ref independently was the
      // bug: on mobile, wrapRef never contains the click, so that check alone
      // closed the dropdown on every tap — including taps on its own buttons,
      // before the click could register.
      const insideDesktop = wrapRef.current?.contains(target) ?? false;
      const insideMobile = mobileWrapRef.current?.contains(target) ?? false;
      if (!insideDesktop && !insideMobile) setDropdownOpen(false);

      if (mobileMenuRef.current && !mobileMenuRef.current.contains(target)) setMobileMenuOpen(false);
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
      {/* Desktop layout: logo left, nav center-ish, full "SCHOLAR LOG IN" pill right */}
      <div className="max-w-[1280px] mx-auto hidden md:flex items-center justify-between h-[64px] px-8">
        <button onClick={() => onNavigate("home")} className="flex items-center gap-2 shrink-0">
          <img src={CEDOLogoWhite} alt="CEDO — City Education and Development Office" className="h-10 w-auto" />
        </button>

        <nav className="flex items-center gap-8">
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

          {dropdownOpen && <LoginDropdown className="right-0" onExistingScholar={onExistingScholar} onNewApplicant={onNewApplicant} close={() => setDropdownOpen(false)} />}
        </div>
      </div>

      {/* Mobile layout — order: hamburger menu (nav) · CEDO logo (center) · compact square Scholar Log In */}
      <div className="md:hidden grid grid-cols-3 items-center h-[56px] px-3">
        <div ref={mobileMenuRef} className="relative justify-self-start">
          <button
            onClick={() => { setMobileMenuOpen(o => !o); setDropdownOpen(false); }}
            aria-label="Menu"
            className={`flex items-center justify-center w-10 h-10 rounded-md transition-colors ${mobileMenuOpen ? "bg-white/15" : "hover:bg-white/10"}`}
          >
            <Menu size={22} className="text-white" />
          </button>

          {mobileMenuOpen && (
            <div className="absolute top-full z-[60] left-0 mt-2 w-[180px] bg-[#1F334F]/95 backdrop-blur-sm rounded-lg shadow-xl border border-white/10 p-1.5 flex flex-col gap-0.5">
              {navItems.map(item => (
                <button
                  key={item.key}
                  onClick={() => { setMobileMenuOpen(false); onNavigate(item.key); }}
                  className={`text-left text-[13px] font-bold tracking-wide rounded-md px-3 py-2.5 transition-colors ${
                    page === item.key ? "text-[#F3BC00] bg-white/5" : "text-white/90 hover:bg-white/10"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <button onClick={() => onNavigate("home")} className="justify-self-center">
          <img src={CEDOLogoWhite} alt="CEDO — City Education and Development Office" className="h-8 w-auto" />
        </button>

        <div ref={mobileWrapRef} className="relative justify-self-end">
          <button
            onClick={() => { setDropdownOpen(o => !o); setMobileMenuOpen(false); }}
            aria-label="Scholar Log In"
            className={`flex items-center justify-center w-10 h-10 rounded-md transition-colors ${
              dropdownOpen ? "bg-[#e0ac00]" : "bg-[#F3BC00] hover:bg-[#e0ac00]"
            }`}
          >
            <LogIn size={18} className="text-[#1F334F]" />
          </button>

          {dropdownOpen && <LoginDropdown className="right-0" onExistingScholar={onExistingScholar} onNewApplicant={onNewApplicant} close={() => setDropdownOpen(false)} />}
        </div>
      </div>
    </header>
  );
}

function LoginDropdown({ className, onExistingScholar, onNewApplicant, close }: {
  className?: string;
  onExistingScholar: () => void;
  onNewApplicant: (kind: "college" | "law-medical") => void;
  close: () => void;
}) {
  return (
    <div className={`absolute top-full z-[60] mt-2 w-[260px] bg-[#1F334F]/95 backdrop-blur-sm rounded-lg shadow-xl border border-white/10 p-2 flex flex-col gap-1.5 ${className ?? ""}`}>
      <button
        onClick={() => { close(); onExistingScholar(); }}
        className="text-center bg-[#16283F] hover:bg-[#0f1d2f] text-white text-[13px] font-bold tracking-wide rounded-full px-4 py-3 transition-colors"
      >
        EXISTING SCHOLAR
      </button>
      <button
        onClick={() => { close(); onNewApplicant("college"); }}
        className="text-center bg-[#16283F] hover:bg-[#0f1d2f] text-white text-[13px] font-bold tracking-wide rounded-full px-4 py-3 leading-tight transition-colors"
      >
        NEW APPLICANT FOR<br />COLLEGE SCHOLARSHIP
      </button>
      <button
        onClick={() => { close(); onNewApplicant("law-medical"); }}
        className="text-center bg-[#16283F] hover:bg-[#0f1d2f] text-white text-[13px] font-bold tracking-wide rounded-full px-4 py-3 leading-tight transition-colors"
      >
        NEW APPLICANT FOR<br />LAW AND MEDICAL SCHOLARSHIP
      </button>
    </div>
  );
}
