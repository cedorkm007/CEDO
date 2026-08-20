import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { fetchCurrentScholarProfile, fetchSubjectsAndGrades, fetchQuestScores, scholarSignOut } from "../scholarApi";
import { ProfileBanner } from "../components/dashboard/ProfileBanner";
import { DashboardHome } from "../components/dashboard/DashboardHome";
import { CompactNav } from "../components/dashboard/CompactNav";
import { BottomNav } from "../components/dashboard/BottomNav";
import { MobilePortalHeader } from "../components/dashboard/MobilePortalHeader";
import { ProfilePopupModal } from "../components/dashboard/ProfilePopupModal";
import { ProfilePanel } from "../components/dashboard/ProfilePanel";
import { SubjectsGradesPanel } from "../components/dashboard/SubjectsGradesPanel";
import { FormsAndServicesPanel } from "../components/dashboard/FormsAndServicesPanel";
import { QuestsPanel } from "../components/dashboard/QuestsPanel";
import { SDPPanel } from "../components/dashboard/SDPPanel";
import { fetchScholarSDPCategoryStatus, type SDPCategoryStatus } from "../sdpApi";
import { fetchOwnPositionLabels } from "../formationApi";
import { CalendarAndActivitiesPanel } from "../components/dashboard/CalendarAndActivitiesPanel";
import { ChangePasswordModal } from "../components/dashboard/ChangePasswordModal";
import type { DashPanelKey } from "../components/dashboard/types";
import type { ScholarProfile, SubjectGrade, QuestScore } from "../types";

interface ScholarPortalPageProps {
  onSignOut: () => void;
}

export function ScholarPortalPage({ onSignOut }: ScholarPortalPageProps) {
  const [profile, setProfile] = useState<ScholarProfile | null>(null);
  const [grades, setGrades] = useState<SubjectGrade[]>([]);
  const [scores, setScores] = useState<QuestScore[]>([]);
  const [sdpStatus, setSdpStatus] = useState<SDPCategoryStatus>({ community_service: false, community_volunteerism: false, formation_program: false });
  const [positions, setPositions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [panel, setPanel] = useState<DashPanelKey | null>(null); // null = home
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showProfilePopup, setShowProfilePopup] = useState(false);

  function goToForms() { setPanel("services"); }

  useEffect(() => {
    (async () => {
      const p = await fetchCurrentScholarProfile();
      setProfile(p);
      if (p) {
        const [g, s, status, pos] = await Promise.all([
          fetchSubjectsAndGrades(p.scholarIdNumber), fetchQuestScores(p.scholarIdNumber), fetchScholarSDPCategoryStatus(p.scholarIdNumber),
          fetchOwnPositionLabels(p.scholarIdNumber),
        ]);
        setGrades(g);
        setScores(s);
        setSdpStatus(status);
        setPositions(pos);
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
    <>
      {/* Mobile-only: replaces the hidden PublicNav (see ScholarSiteApp) — Home · CEDO logo · Profile popup trigger */}
      <MobilePortalHeader onHome={() => setPanel(null)} onOpenProfile={() => setShowProfilePopup(true)} />

      <div className="min-h-[calc(100vh-64px)] bg-[#F5F7FA] px-4 md:px-8 py-8 pb-24 md:pb-8">
        <div className="max-w-[1100px] mx-auto">
          {/* Desktop only — on mobile, Sign Out lives in the profile popup instead */}
          <div className="hidden md:flex items-center justify-between mb-4">
            <p className="text-sm text-slate-500">Scholar Portal</p>
            <button onClick={handleSignOut} style={{ cursor: 'pointer' }} className="flex items-center gap-1.5 text-sm font-semibold text-[#062444] hover:text-red-600 hover:opacity-80 transition-colors">
              <LogOut size={15} /> Sign Out
            </button>
          </div>

          {/* Desktop only — on mobile this info lives in the profile popup instead, and the
              home screen goes straight to the widget grid (matches the reference app's simpler
              icon-grid home screen). */}
          <div className="hidden md:block">
            <ProfileBanner profile={profile} sdpStatus={sdpStatus} positions={positions} onChangePassword={() => setShowChangePassword(true)} />
          </div>

          {panel === null ? (
            <DashboardHome onOpen={setPanel} />
          ) : (
            <>
              {/* Desktop only — on mobile, switching panels is the bottom nav's job; no separate
                  "minimize back to grid" control is needed alongside it. */}
              <div className="hidden md:block">
                <CompactNav active={panel} onSelect={setPanel} onHome={() => setPanel(null)} />
              </div>

              {panel === "profile" && <ProfilePanel profile={profile} onProfileUpdated={setProfile} />}
              {panel === "subjects-grades" && <SubjectsGradesPanel grades={grades} />}
              {panel === "services" && <FormsAndServicesPanel />}
              {panel === "quests" && (
                <QuestsPanel
                  scores={scores}
                  scholarIdNumber={profile.scholarIdNumber}
                  onScoreSubmitted={() => { fetchQuestScores(profile.scholarIdNumber).then(setScores); }}
                  onNavigateToForms={goToForms}
                />
              )}
              {panel === "sdp" && <SDPPanel scholarIdNumber={profile.scholarIdNumber} />}
              {panel === "calendar" && <CalendarAndActivitiesPanel />}
            </>
          )}
        </div>
      </div>

      {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} />}
      {showProfilePopup && (
        <ProfilePopupModal
          profile={profile}
          sdpStatus={sdpStatus}
          positions={positions}
          onClose={() => setShowProfilePopup(false)}
          onChangePassword={() => { setShowProfilePopup(false); setShowChangePassword(true); }}
          onProfileUpdated={setProfile}
          onSignOut={handleSignOut}
        />
      )}
      <BottomNav active={panel} onSelect={setPanel} />
    </>
  );
}
