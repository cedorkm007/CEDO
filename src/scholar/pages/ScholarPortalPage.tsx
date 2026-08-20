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
import { NewlyUnlockedModal } from "../components/dashboard/NewlyUnlockedModal";
import { syncAndFetchUnreadFormUnlockNotifications, markFormUnlockNotificationsRead, type FormUnlockNotification } from "../formsApi";
import { useUrlState } from "@/app/useUrlState";
import type { DashPanelKey } from "../components/dashboard/types";
import type { ScholarProfile, SubjectGrade, QuestScore } from "../types";

interface ScholarPortalPageProps {
  onSignOut: () => void;
}

// URL representation of the panel state — "home" stands in for `panel ===
// null` (the DashboardHome grid) since useUrlState's default value must be
// a real string, not null, and "home" doubles as a readable URL rather
// than an empty/missing param meaning something implicit. Converted back
// to `DashPanelKey | null` immediately below so every other line in this
// file keeps using the exact same `panel`/`setPanel` shape as before —
// nested tabs and in-progress quiz state are deliberately NOT part of
// this (Quests' internal browse/topics/quiz steps, Formation Tools-style
// drill-downs, etc. — out of scope per this milestone's instructions).
type PanelUrlValue = "home" | DashPanelKey;
const PANEL_VALUES: readonly PanelUrlValue[] = ["home", "profile", "subjects-grades", "services", "quests", "sdp", "calendar"];

export function ScholarPortalPage({ onSignOut }: ScholarPortalPageProps) {
  const [profile, setProfile] = useState<ScholarProfile | null>(null);
  const [grades, setGrades] = useState<SubjectGrade[]>([]);
  const [scores, setScores] = useState<QuestScore[]>([]);
  const [sdpStatus, setSdpStatus] = useState<SDPCategoryStatus>({ community_service: false, community_volunteerism: false, formation_program: false });
  const [positions, setPositions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [panelUrlValue, setPanelUrlValue] = useUrlState<PanelUrlValue>("panel", "home", PANEL_VALUES);
  const panel: DashPanelKey | null = panelUrlValue === "home" ? null : panelUrlValue;
  function setPanel(next: DashPanelKey | null) { setPanelUrlValue(next ?? "home"); }
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showProfilePopup, setShowProfilePopup] = useState(false);
  const [newlyUnlocked, setNewlyUnlocked] = useState<FormUnlockNotification[]>([]);

  function goToForms() { setPanel("services"); }

  useEffect(() => {
    (async () => {
      const p = await fetchCurrentScholarProfile();
      setProfile(p);
      // Any restored panel value is already guaranteed to be a real
      // PANEL_VALUES member by useUrlState itself (invalid/garbage URL
      // values fall back to "home" there) — every one of the six panels
      // is available to any signed-in scholar (no per-panel tag/role gate
      // exists on this side, unlike the staff app), so there's no further
      // per-panel authorization check needed here once a profile exists.
      // The one thing that DOES need checking is "no profile at all"
      // (session expired / sign-in failed) — the early-return screens
      // below already cover that by never reaching the panel switch, so a
      // stale ?panel=... on an unauthenticated load safely shows the
      // sign-in-again screen instead of a broken panel.
      if (p) {
        const [g, s, status, pos, unread] = await Promise.all([
          fetchSubjectsAndGrades(p.scholarIdNumber), fetchQuestScores(p.scholarIdNumber), fetchScholarSDPCategoryStatus(p.scholarIdNumber),
          fetchOwnPositionLabels(p.scholarIdNumber),
          // Catches unlocks the scholar didn't personally just cause — staff
          // created a newly-qualifying material, loosened a condition, or
          // changed their year level since they were last here.
          syncAndFetchUnreadFormUnlockNotifications(),
        ]);
        setGrades(g);
        setScores(s);
        setSdpStatus(status);
        setPositions(pos);
        setNewlyUnlocked(unread);
      }
      setLoading(false);
    })();
  }, []);

  function dismissNewlyUnlocked() {
    const ids = newlyUnlocked.map(n => n.notificationId);
    setNewlyUnlocked([]);
    if (ids.length > 0) void markFormUnlockNotificationsRead(ids);
  }

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
              {panel === "calendar" && <CalendarAndActivitiesPanel onNavigateToForms={goToForms} />}
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
      <NewlyUnlockedModal notifications={newlyUnlocked} onGoToForms={goToForms} onClose={dismissNewlyUnlocked} />
    </>
  );
}
