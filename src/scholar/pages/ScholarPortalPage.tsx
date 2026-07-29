import { useEffect, useState } from "react";
import { GraduationCap, IdCard, Mail, Phone, MapPin, BookOpen, Trophy, LogOut } from "lucide-react";
import { fetchCurrentScholarProfile, fetchSubjectsAndGrades, fetchQuestScores, scholarSignOut } from "../scholarApi";
import type { ScholarProfile, SubjectGrade, QuestScore } from "../types";

interface ScholarPortalPageProps {
  onSignOut: () => void;
}

/**
 * Phase-1 shell for the logged-in scholar experience: real profile data
 * pulled from Supabase, plus Subjects & Grades / Quest Scores sections. This
 * is the foundation to build the full dashboard (from the reference mockup
 * you attached — probation banner, SDP, services, etc.) on top of next.
 */
export function ScholarPortalPage({ onSignOut }: ScholarPortalPageProps) {
  const [profile, setProfile] = useState<ScholarProfile | null>(null);
  const [grades, setGrades] = useState<SubjectGrade[]>([]);
  const [scores, setScores] = useState<QuestScore[]>([]);
  const [loading, setLoading] = useState(true);

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
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-extrabold text-[#1F334F]">Welcome, {profile.firstName}!</h1>
            <p className="text-sm text-slate-500">Scholar Portal</p>
          </div>
          <button onClick={handleSignOut} className="flex items-center gap-1.5 text-sm font-semibold text-[#1F334F] hover:text-red-600">
            <LogOut size={15} /> Sign Out
          </button>
        </div>

        {/* Profile card */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 mb-6">
          <div className="flex items-center gap-4 mb-5">
            <div className="w-14 h-14 rounded-full bg-[#1B3372] flex items-center justify-center text-white">
              <GraduationCap size={24} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[#1F334F]">{profile.firstName} {profile.middleName} {profile.lastName}</h2>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0088cc] bg-[#0088cc]/10 border border-[#0088cc]/20 rounded-full px-3 py-1 mt-1">
                <IdCard size={12} /> {profile.scholarIdNumber}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <InfoRow icon={<Mail size={14} />} label="Email" value={profile.email} />
            <InfoRow icon={<Phone size={14} />} label="Contact No." value={profile.contactNo || "—"} />
            <InfoRow icon={<GraduationCap size={14} />} label="School" value={profile.school || "—"} />
            <InfoRow icon={<BookOpen size={14} />} label="Course" value={profile.course || "—"} />
            <InfoRow icon={<MapPin size={14} />} label="Address" value={profile.address || "—"} />
            <InfoRow icon={<GraduationCap size={14} />} label="Civil Status" value={profile.civilStatus || "—"} />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Subjects & Grades */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
            <div className="flex items-center gap-2 mb-4">
              <BookOpen size={16} className="text-[#F3BC00]" />
              <h3 className="font-bold text-[#1F334F] text-sm">Subjects & Grades</h3>
            </div>
            {grades.length === 0 ? (
              <p className="text-sm text-slate-400">No grades recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {grades.map(g => (
                  <div key={g.id} className="flex items-center justify-between text-sm border-b border-slate-50 pb-2">
                    <div>
                      <p className="font-medium text-slate-700">{g.subject}</p>
                      <p className="text-xs text-slate-400">{g.schoolYear} · {g.semester}</p>
                    </div>
                    <span className="font-bold text-[#1F334F]">{g.grade}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quest Scores */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
            <div className="flex items-center gap-2 mb-4">
              <Trophy size={16} className="text-[#F3BC00]" />
              <h3 className="font-bold text-[#1F334F] text-sm">Quest Scores</h3>
            </div>
            {scores.length === 0 ? (
              <p className="text-sm text-slate-400">No quest scores recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {scores.map(s => (
                  <div key={s.id} className="flex items-center justify-between text-sm border-b border-slate-50 pb-2">
                    <div>
                      <p className="font-medium text-slate-700">{s.questName}</p>
                      <p className="text-xs text-slate-400">{s.dateTaken ?? "—"}</p>
                    </div>
                    <span className="font-bold text-[#1F334F]">{s.score ?? "—"}{s.maxScore ? ` / ${s.maxScore}` : ""}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
          <PlaceholderCard title="SDP" note="Under development." />
          <PlaceholderCard title="Services" note="Coming soon." />
        </div>
      </div>
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-[#F3BC00] mt-0.5">{icon}</span>
      <div>
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{label}</p>
        <p className="text-slate-700">{value}</p>
      </div>
    </div>
  );
}

function PlaceholderCard({ title, note }: { title: string; note: string }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-dashed border-slate-200 p-6 flex flex-col items-center justify-center text-center min-h-[120px]">
      <h3 className="font-bold text-[#1F334F] text-sm mb-1">{title}</h3>
      <p className="text-xs text-slate-400">{note}</p>
    </div>
  );
}
