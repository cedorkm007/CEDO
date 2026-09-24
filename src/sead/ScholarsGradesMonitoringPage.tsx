import { useEffect, useState } from "react";
import { School, Users, Pencil, Check } from "lucide-react";
import { ScholarsGradesMonitoringSchoolsTab } from "./pages/ScholarsGradesMonitoringSchoolsTab";
import { ScholarsGradesMonitoringScholarsTab } from "./pages/ScholarsGradesMonitoringScholarsTab";
import { fetchCurrentGradingPeriod, setCurrentGradingPeriod, type GradingPeriod } from "./scholarsGradesMonitoringApi";

type MonitoringSubtab = "schools" | "scholars";

/**
 * Gated by the "scholars_grades_monitoring" tag (src/app/staffToolTags.ts),
 * granted from it.admin1's Staff Accounts page. Same subtab-shell pattern
 * as ScholarCounselingToolPage.tsx. Also owns the one "current grading
 * period" setting both subtabs' % complete figures and every school's
 * grade-entry screen key off (see grading_period_settings in the migration).
 */
export function ScholarsGradesMonitoringPage() {
  const TABS: { key: MonitoringSubtab; label: string; icon: React.ReactNode }[] = [
    { key: "schools", label: "Schools", icon: <School size={14} /> },
    { key: "scholars", label: "Scholars", icon: <Users size={14} /> },
  ];
  const [tab, setTab] = useState<MonitoringSubtab>("schools");
  const [period, setPeriod] = useState<GradingPeriod>({ schoolYear: "", semester: "" });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<GradingPeriod>({ schoolYear: "", semester: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchCurrentGradingPeriod().then(p => { setPeriod(p); setDraft(p); });
  }, []);

  async function handleSave() {
    setSaving(true);
    const result = await setCurrentGradingPeriod(draft);
    setSaving(false);
    if (result.ok) { setPeriod(draft); setEditing(false); }
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-foreground mb-1">Scholars' Grades Monitoring</h1>
      <p className="text-sm text-muted-foreground mb-4">Monitor scholars' grade-completion rates by school and program, and drill into individual grades and GWA.</p>

      <div className="flex items-center gap-3 bg-[#f7f9fc] border border-[#e6ecf5] rounded-xl px-4 py-3 mb-5 text-[13px]">
        <span className="font-bold text-[#062444] uppercase tracking-wide text-[11.5px]">Current Grading Period</span>
        {editing ? (
          <>
            <input value={draft.schoolYear} onChange={e => setDraft(d => ({ ...d, schoolYear: e.target.value }))}
              placeholder="e.g. 2025-2026" className="border border-[#062444]/15 rounded-lg px-2.5 py-1.5 text-[13px] outline-none w-32" />
            <input value={draft.semester} onChange={e => setDraft(d => ({ ...d, semester: e.target.value }))}
              placeholder="e.g. 1st Semester" className="border border-[#062444]/15 rounded-lg px-2.5 py-1.5 text-[13px] outline-none w-36" />
            <button onClick={handleSave} disabled={saving} className="flex items-center gap-1 text-[12.5px] font-semibold text-white bg-[#062444] rounded-lg px-3 py-1.5 disabled:opacity-60">
              <Check size={13} /> {saving ? "Saving…" : "Save"}
            </button>
            <button onClick={() => { setDraft(period); setEditing(false); }} className="text-[12.5px] text-slate-400 hover:text-slate-600">Cancel</button>
          </>
        ) : (
          <>
            <span className="text-[#062444] font-semibold">{period.schoolYear || "—"} · {period.semester || "—"}</span>
            <button onClick={() => setEditing(true)} className="flex items-center gap-1 text-[12.5px] font-semibold text-[#0088cc] hover:opacity-80">
              <Pencil size={12} /> Change
            </button>
          </>
        )}
      </div>

      <div className="flex w-full gap-1 border-b border-border mb-5">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-[13.5px] font-bold border-b-2 transition-colors ${
              tab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === "schools" && <ScholarsGradesMonitoringSchoolsTab period={period} />}
      {tab === "scholars" && <ScholarsGradesMonitoringScholarsTab />}
    </div>
  );
}
