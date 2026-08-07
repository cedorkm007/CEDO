import { User } from "lucide-react";
import CEDOLogoWhite from "@/imports/scholar/CEDO_Logo_White.png";

interface MobilePortalHeaderProps {
  onHome: () => void;
  onOpenProfile: () => void;
}

/**
 * Replaces PublicNav on mobile once a scholar is signed into the portal
 * (PublicNav itself is hidden below md in ScholarSiteApp for view==="portal").
 * Layout per spec: Home (left) · CEDO logo (center) · Profile (right, opens
 * the profile popup instead of navigating to a panel).
 */
export function MobilePortalHeader({ onHome, onOpenProfile }: MobilePortalHeaderProps) {
  return (
    <header className="md:hidden sticky top-0 z-40 bg-[#1F334F] shadow-md grid grid-cols-3 items-center h-[56px] px-3">
      <button onClick={onHome} className="justify-self-start text-white font-bold text-[13px] tracking-wide px-2 py-1.5 rounded-md hover:bg-white/10 transition-colors">
        Home
      </button>

      <img src={CEDOLogoWhite} alt="CEDO" className="h-8 w-auto justify-self-center" />

      <button onClick={onOpenProfile} aria-label="Profile" className="justify-self-end flex items-center justify-center w-10 h-10 rounded-md bg-[#F3BC00] hover:bg-[#e0ac00] transition-colors">
        <User size={18} className="text-[#1F334F]" />
      </button>
    </header>
  );
}
