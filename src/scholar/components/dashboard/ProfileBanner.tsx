import { GraduationCap, ShieldCheck } from "lucide-react";
import type { ScholarProfile } from "../../types";

interface ProfileBannerProps {
  profile: ScholarProfile;
  onChangePassword: () => void;
}

export function ProfileBanner({ profile, onChangePassword }: ProfileBannerProps) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#062444] via-[#0a3a6b] to-[#0d4d8a] p-6 md:p-8 mb-6 shadow-[0_8px_32px_rgba(6,36,68,0.25)]">
      <div className="absolute w-[280px] h-[280px] rounded-full bg-white/5 -top-24 -right-14 pointer-events-none" />
      <div className="absolute w-[160px] h-[160px] rounded-full bg-[#F3BC00]/8 -bottom-14 left-8 pointer-events-none" />

      <div className="relative z-10 flex items-center gap-5 flex-wrap">
        <div className="relative shrink-0">
          <div className="w-[84px] h-[84px] md:w-[100px] md:h-[100px] rounded-full border-4 border-[#F3BC00] shadow-lg bg-[#0a3a6b] flex items-center justify-center text-white">
            <GraduationCap size={40} />
          </div>
          <div className="absolute bottom-1 right-1 w-6 h-6 rounded-full bg-[#F3BC00] border-2 border-white flex items-center justify-center">
            <ShieldCheck size={12} className="text-[#062444]" />
          </div>
        </div>

        <div className="flex-1 min-w-[180px]">
          <div className="text-lg md:text-xl font-bold text-white tracking-wide mb-1">
            {profile.lastName.toUpperCase()}, {profile.firstName.toUpperCase()}{profile.middleName ? ` ${profile.middleName[0].toUpperCase()}` : ""}
          </div>
          <div className="text-[13px] font-semibold text-[#F3BC00] tracking-wide mb-2">{profile.scholarIdNumber}</div>
          <span className="inline-flex items-center gap-1.5 bg-[#F3BC00]/15 border border-[#F3BC00]/30 text-[#F3BC00] text-[11px] font-bold uppercase tracking-wider rounded-full px-3 py-1">
            City Scholar
          </span>
        </div>

        <button
          onClick={onChangePassword}
          className="flex items-center gap-2 bg-white/10 hover:bg-white/20 border border-white/30 text-white text-[13px] font-semibold rounded-[10px] px-4 py-2.5 transition-colors backdrop-blur-sm"
        >
          <ShieldCheck size={15} className="text-[#F3BC00]" />
          Change Password
        </button>
      </div>
    </div>
  );
}
