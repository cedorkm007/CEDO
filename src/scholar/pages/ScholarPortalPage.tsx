import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { fetchCurrentScholarProfile, fetchSubjectsAndGrades, fetchQuestScores, scholarSignOut } from "../scholarApi";
import { ProfileBanner } from "../components/dashboard/ProfileBanner";
import { DashboardHome } from "../components/dashboard/DashboardHome";
import { CompactNav } from "../components/dashboard/CompactNav";
import { ProfilePanel } from "../components/dashboard/ProfilePanel";
import { SubjectsGradesPanel } from "../components/dashboard/SubjectsGradesPanel";
import { ServicesPanel } from "../components/dashboard/ServicesPanel";
import { QuestsPanel } from "../components/dashboard/QuestsPanel";
import { UnderDevPanelCard } from "../components/dashboard/UnderDevPanelCard";
import { SectionCard } from "../components/dashboard/SectionCard";
import { ChangePasswordModal } from "../components/dashboard/ChangePasswordModal";
import type { DashPanelKey } from "../components/dashboard/types";
import type { ScholarProfile, SubjectGrade, QuestScore } from "../types";
import { Lightbulb, Calendar as CalendarIcon } from "lucide-react";

interface ScholarPortalPageProps {
  onSignOut: () => void;
}

export function ScholarPortalPage({ onSignOut }: ScholarPortalPageProps) {
  const [profile, setProfile] = useState<ScholarProfile | null>(null);
  const [grades, setGrades] = useState<SubjectGrade[]>([]);
  const [scores, setScores] = useState<QuestScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [panel, setPanel] = useState<DashPanelKey | null>(null); // null = home
  const [showChangePassword, setShowChangePassword] = useState(false);

  useEffect(() => {
    (async () => {
      const p = await fetchCurrentScholarProfile();
      setProfile(p);
      if (p) {
        const [g, s] = await Promise.all([fetchSubjectsAndGrades(p.scholarIdNumber), fetchQuestScores(p.scholarIdNumber)]);
        setGrades(g);
        setScores(s);
      }
      setLoading(false);
    })();
  }, []);

  async function handleSignOut() {
    await scholarSignOut();
    onSignOut();
  }

  if (loading) {
    return <div className="min-h-[calc(100vh-64px)] flex items-center justify-center text-slate-400 text-sm">Loading your profile…</div>;
  }

  if (!profile) {
    return (
      <div className="min-h-[calc(100vh-64px)] flex items-center justify-center text-center px-4">
        <p className="text-slate-500 text-sm">We couldn't load your profile. Please sign in again.</p>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-64px)] bg-[#F5F7FA] px-4 md:px-8 py-8">
      <div className="max-w-[1100px] mx-auto">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-slate-500">Scholar Portal</p>
          <button onClick={handleSignOut} className="flex items-center gap-1.5 text-sm font-semibold text-[#062444] hover:text-red-600">
            <LogOut size={15} /> Sign Out
          </button>
        </div>

        <ProfileBanner profile={profile} onChangePassword={() => setShowChangePassword(true)} />

        {panel === null ? (
          <DashboardHome onOpen={setPanel} />
        ) : (
          <>
            <CompactNav active={panel} onSelect={setPanel} onHome={() => setPanel(null)} />

            {panel === "profile" && <ProfilePanel profile={profile} onProfileUpdated={setProfile} />}
            {panel === "subjects-grades" && <SubjectsGradesPanel grades={grades} />}
            {panel === "services" && <ServicesPanel />}
            {panel === "quests" && (
              <QuestsPanel
                scores={scores}
                scholarIdNumber={profile.scholarIdNumber}
                onScoreSubmitted={() => { fetchQuestScores(profile.scholarIdNumber).then(setScores); }}
              />
            )}
            {panel === "sdp" && (
              <SectionCard icon={<Lightbulb size={14} />} title="Scholars' Development Program (SDP)">
                <UnderDevPanelCard label="Under Development" />
              </SectionCard>
            )}
            {panel === "calendar" && (
              <SectionCard icon={<CalendarIcon size={14} />} title="Calendar">
                <UnderDevPanelCard label="Under Development" />
              </SectionCard>
            )}
          </>
        )}
      </div>

      {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} />}
    </div>
  );
}
