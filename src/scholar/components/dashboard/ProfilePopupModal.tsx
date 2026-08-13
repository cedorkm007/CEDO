import { X, ShieldCheck, GraduationCap, LogOut, MapPinned, CheckCircle2, Circle } from "lucide-react";
import { ProfilePanel } from "./ProfilePanel";
import { clusterForBarangay, clusterLabel } from "@/lib/cdoBarangays";
import { SDP_CATEGORIES, type SDPCategoryStatus } from "../../sdpApi";
import type { ScholarProfile } from "../../types";

interface ProfilePopupModalProps {
  profile: ScholarProfile;
  sdpStatus: SDPCategoryStatus;
  positions: string[];
  onClose: () => void;
  onChangePassword: () => void;
  onProfileUpdated: (p: ScholarProfile) => void;
  onSignOut: () => void;
}

/**
 * Mobile-only profile popup, opened from MobilePortalHeader's profile
 * button — shows name/ID/SDP checklist + Change Password up top, then the
 * full profile page content below (same ProfilePanel used elsewhere).
 */
export function ProfilePopupModal({ profile, sdpStatus, positions, onClose, onChangePassword, onProfileUpdated, onSignOut }: ProfilePopupModalProps) {
  const cluster = profile.barangay ? clusterForBarangay(profile.barangay) : null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-end justify-center md:hidden" onClick={onClose}>
      <div className="bg-[#F5F7FA] rounded-t-3xl shadow-2xl w-full max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-gradient-to-br from-[#062444] via-[#0a3a6b] to-[#0d4d8a] rounded-t-3xl px-6 pt-5 pb-6 z-10">
          <div className="flex justify-end mb-2">
            <button onClick={onClose} className="text-white/70 hover:text-white"><X size={20} /></button>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full border-4 border-[#F3BC00] shadow-lg bg-[#0a3a6b] flex items-center justify-center text-white shrink-0">
              <GraduationCap size={28} />
            </div>
            <div className="min-w-0">
              <p className="text-white font-bold text-[15px] leading-tight truncate">
                {profile.lastName.toUpperCase()}, {profile.firstName.toUpperCase()}{profile.middleName ? ` ${profile.middleName[0].toUpperCase()}` : ""}
              </p>
              {positions.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap mt-1">
                  {positions.map(p => (
                    <span key={p} className="inline-flex items-center bg-[#F3BC00] text-[#062444] text-[10px] font-bold rounded-full px-2 py-0.5">
                      {p}
                    </span>
                  ))}
                </div>
              )}
              <p className="text-[#F3BC00] text-[12.5px] font-semibold mt-1">{profile.scholarIdNumber}</p>
              <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                {SDP_CATEGORIES.map(c => (
                  <span key={c.key} className={`inline-flex items-center gap-1 text-[10px] font-bold rounded-full px-2 py-0.5 ${
                    sdpStatus[c.key] ? "bg-green-500/20 text-green-300 border border-green-400/30" : "bg-white/10 text-white/50 border border-white/15"
                  }`}>
                    {sdpStatus[c.key] ? <CheckCircle2 size={10} /> : <Circle size={10} />} {c.label}
                  </span>
                ))}
                {cluster && (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-white/70">
                    <MapPinned size={10} className="text-[#F3BC00]" /> {clusterLabel(cluster)}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-4">
            <button onClick={onChangePassword}
              className="flex-1 flex items-center justify-center gap-1.5 bg-white/10 hover:bg-white/20 border border-white/30 text-white text-[12.5px] font-semibold rounded-lg px-3 py-2.5 transition-colors">
              <ShieldCheck size={14} className="text-[#F3BC00]" /> Change Password
            </button>
            <button onClick={onSignOut}
              className="flex-1 flex items-center justify-center gap-1.5 bg-white/10 hover:bg-red-500/30 border border-white/30 text-white text-[12.5px] font-semibold rounded-lg px-3 py-2.5 transition-colors">
              <LogOut size={14} /> Sign Out
            </button>
          </div>
        </div>

        <div className="p-4 pb-8">
          <ProfilePanel profile={profile} onProfileUpdated={onProfileUpdated} />
        </div>
      </div>
    </div>
  );
}
