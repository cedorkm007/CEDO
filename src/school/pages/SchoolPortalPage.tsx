import { useEffect, useState } from "react";
import { Settings, Users } from "lucide-react";
import { fetchCurrentSchoolProfile, fetchSchoolAccountUsername, schoolSignOut } from "../schoolApi";
import { GradingConfigPanel } from "../components/GradingConfigPanel";
import { ScholarsDrilldownPanel } from "../components/ScholarsDrilldownPanel";
import { SchoolAccountMenu } from "../components/SchoolAccountMenu";
import { SchoolPeriodBar } from "../components/SchoolPeriodBar";
import { focusRing } from "../components/portalParts";
import { useSchoolData, type SchoolData } from "../useSchoolData";
import { useUrlState } from "@/app/useUrlState";
import type { SchoolProfile } from "../types";

type SchoolPanelKey = "grading-config" | "scholars";
const PANEL_VALUES: readonly SchoolPanelKey[] = ["grading-config", "scholars"];

interface SchoolPortalPageProps {
  onSignOut: () => void;
}

/**
 * The signed-in school's workspace. Layout (Phase 5): header with the school's full name and an account menu
 * (change password, help / contact CEDO, sign out), the always-visible period bar, then the Scholars and
 * Grading System tabs. One useSchoolData() feeds the period bar, the summary, the cards, the table and the
 * grade-entry window.
 */
export function SchoolWorkspaceView({ profile, username, onSignOut, data, gradingPanel }: {
  profile: SchoolProfile; username: string | null; onSignOut: () => void; data: SchoolData;
  /** The Grading System tab's content (lets a preview page swap in a stand-in that needs no database). */
  gradingPanel?: React.ReactNode;
}) {
  const [panel, setPanel] = useUrlState<SchoolPanelKey>("panel", "scholars", PANEL_VALUES);

  const TABS: { key: SchoolPanelKey; label: string; icon: React.ReactNode }[] = [
    { key: "scholars", label: "Scholars", icon: <Users size={16} aria-hidden="true" /> },
    { key: "grading-config", label: "Grading System", icon: <Settings size={16} aria-hidden="true" /> },
  ];

  return (
    <div className="min-h-screen bg-[#F5F7FA]">
      <header className="bg-white border-b border-[#e6ecf5] px-4 md:px-8 py-4">
        <div className="max-w-[1100px] mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] text-slate-700 uppercase tracking-wide font-bold">School Portal</p>
            <h1 className="text-[22px] leading-snug font-bold text-[#062444] break-words">{profile.schoolName}</h1>
          </div>
          <SchoolAccountMenu username={username} onSignOut={onSignOut} />
        </div>
      </header>

      <div className="md:sticky md:top-0 z-30">
        <SchoolPeriodBar data={data} />
      </div>

      <main className="max-w-[1100px] mx-auto px-4 md:px-8 py-6">
        <div role="tablist" aria-label="School Portal sections" className="flex w-full gap-1 border-b border-[#e6ecf5] mb-5 overflow-x-auto">
          {TABS.map(t => (
            <button key={t.key} role="tab" aria-selected={panel === t.key} onClick={() => setPanel(t.key)}
              className={`flex items-center justify-center gap-2 px-4 py-3 text-[15px] font-bold border-b-2 whitespace-nowrap transition-colors ${focusRing} ${
                panel === t.key ? "border-[#0077b6] text-[#062444]" : "border-transparent text-slate-700 hover:text-[#062444]"
              }`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {panel === "grading-config" && (gradingPanel ?? <GradingConfigPanel schoolId={profile.schoolId} onSaved={data.reloadConfig} />)}
        {panel === "scholars" && <ScholarsDrilldownPanel data={data} onGoToGradingSystem={() => setPanel("grading-config")} />}
      </main>
    </div>
  );
}

function SchoolWorkspace({ profile, username, onSignOut }: { profile: SchoolProfile; username: string | null; onSignOut: () => void }) {
  const data = useSchoolData(profile.schoolId);
  return <SchoolWorkspaceView profile={profile} username={username} onSignOut={onSignOut} data={data} />;
}

export function SchoolPortalPage({ onSignOut }: SchoolPortalPageProps) {
  const [profile, setProfile] = useState<SchoolProfile | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCurrentSchoolProfile().then(p => { setProfile(p); setLoading(false); });
    fetchSchoolAccountUsername().then(setUsername);
  }, []);

  async function handleSignOut() {
    await schoolSignOut();
    onSignOut();
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-slate-700 text-[15px]">Loading your school profile…</div>;
  }
  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center text-center px-4">
        <p className="text-slate-800 text-[15px]">We couldn't load your school profile. Please sign in again.</p>
      </div>
    );
  }
  return <SchoolWorkspace profile={profile} username={username} onSignOut={handleSignOut} />;
}
