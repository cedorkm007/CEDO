import { useEffect, useState } from "react";
import { LogOut, Settings, Users } from "lucide-react";
import { fetchCurrentSchoolProfile, schoolSignOut } from "../schoolApi";
import { GradingConfigPanel } from "../components/GradingConfigPanel";
import { ScholarsDrilldownPanel } from "../components/ScholarsDrilldownPanel";
import { useUrlState } from "@/app/useUrlState";
import type { SchoolProfile } from "../types";

type SchoolPanelKey = "grading-config" | "scholars";
const PANEL_VALUES: readonly SchoolPanelKey[] = ["grading-config", "scholars"];

interface SchoolPortalPageProps {
  onSignOut: () => void;
}

export function SchoolPortalPage({ onSignOut }: SchoolPortalPageProps) {
  const [profile, setProfile] = useState<SchoolProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [panel, setPanel] = useUrlState<SchoolPanelKey>("panel", "scholars", PANEL_VALUES);

  useEffect(() => {
    fetchCurrentSchoolProfile().then(p => { setProfile(p); setLoading(false); });
  }, []);

  async function handleSignOut() {
    await schoolSignOut();
    onSignOut();
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-slate-400 text-sm">Loading your school profile…</div>;
  }
  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center text-center px-4">
        <p className="text-slate-500 text-sm">We couldn't load your school profile. Please sign in again.</p>
      </div>
    );
  }

  const TABS: { key: SchoolPanelKey; label: string; icon: React.ReactNode }[] = [
    { key: "scholars", label: "Scholars", icon: <Users size={14} /> },
    { key: "grading-config", label: "Grading System", icon: <Settings size={14} /> },
  ];

  return (
    <div className="min-h-screen bg-[#F5F7FA]">
      <div className="bg-white border-b border-[#e6ecf5] px-4 md:px-8 py-4 flex items-center justify-between">
        <div>
          <p className="text-[11px] text-slate-400 uppercase tracking-wide font-semibold">School Portal</p>
          <h1 className="text-lg font-bold text-[#062444]">{profile.schoolName}</h1>
        </div>
        <button onClick={handleSignOut} className="flex items-center gap-1.5 text-sm font-semibold text-[#062444] hover:text-red-600 transition-colors">
          <LogOut size={15} /> Sign Out
        </button>
      </div>

      <div className="max-w-[1100px] mx-auto px-4 md:px-8 py-6">
        <div className="flex w-full gap-1 border-b border-[#e6ecf5] mb-5">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setPanel(t.key)}
              className={`flex items-center justify-center gap-2 px-4 py-2.5 text-[13.5px] font-bold border-b-2 transition-colors ${
                panel === t.key ? "border-[#0088cc] text-[#062444]" : "border-transparent text-slate-400 hover:text-[#062444]"
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {panel === "grading-config" && <GradingConfigPanel schoolId={profile.schoolId} />}
        {panel === "scholars" && <ScholarsDrilldownPanel schoolId={profile.schoolId} />}
      </div>
    </div>
  );
}
