import { useCallback, useEffect, useMemo, useState } from "react";
import { School, Users, Pencil, Check, CalendarRange, AlertTriangle, FileSignature, Wrench, Download } from "lucide-react";
import { ScholarsGradesMonitoringSchoolsTab } from "./pages/ScholarsGradesMonitoringSchoolsTab";
import { ScholarsGradesMonitoringScholarsTab } from "./pages/ScholarsGradesMonitoringScholarsTab";
import { ScholarsGradesMonitoringCorrectionsTab } from "./pages/ScholarsGradesMonitoringCorrectionsTab";
import { ScholarsGradesMonitoringCleanupTab } from "./pages/ScholarsGradesMonitoringCleanupTab";
import { GradesExportDialog } from "./components/GradesExportDialog";
import { AcademicPeriodsModal } from "./components/AcademicPeriodsModal";
import { Modal } from "./components/Modal";
import { PeriodSelect } from "@/app/components/PeriodSelect";
import { fetchCurrentGradingPeriod, setCurrentGradingPeriod, type GradingPeriod } from "./scholarsGradesMonitoringApi";
import { fetchAcademicPeriods } from "@/lib/academicPeriodsApi";
import {
  TERMS, termLabel, statusLabel, normalizeTerm, isValidSchoolYear, periodKey, periodOptions, periodRefOf,
  findPeriod, deadlineSummary, type AcademicPeriod,
} from "@/lib/academicPeriods";

type MonitoringSubtab = "schools" | "scholars" | "corrections" | "cleanup";

/**
 * Gated by the "scholars_grades_monitoring" tag (src/app/staffToolTags.ts),
 * granted from it.admin1's Staff Accounts page. Same subtab-shell pattern
 * as ScholarCounselingToolPage.tsx. Also owns the one "current grading
 * period" setting both subtabs' % complete figures and every school's
 * grade-entry screen key off (see grading_period_settings in the migration).
 *
 * Phase 2: the Current Grading Period is still the default, but a "Viewing period" dropdown lets staff
 * look at any past (or future) period in both subtabs, "Manage periods" opens the list of academic
 * periods (open / close / archive, deadline), and changing the Current Grading Period asks for
 * confirmation first because it also changes the SDP credit period.
 */
export function ScholarsGradesMonitoringPage() {
  const TABS: { key: MonitoringSubtab; label: string; icon: React.ReactNode }[] = [
    { key: "schools", label: "Schools", icon: <School size={14} /> },
    { key: "scholars", label: "Scholars", icon: <Users size={14} /> },
    { key: "corrections", label: "Correction requests", icon: <FileSignature size={14} /> },
    { key: "cleanup", label: "Clean-up", icon: <Wrench size={14} /> },
  ];
  const [tab, setTab] = useState<MonitoringSubtab>("schools");
  const [period, setPeriod] = useState<GradingPeriod>({ schoolYear: "", semester: "" });
  const [periods, setPeriods] = useState<AcademicPeriod[]>([]);
  const [periodsError, setPeriodsError] = useState("");
  const [viewKey, setViewKey] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftYear, setDraftYear] = useState("");
  const [draftTerm, setDraftTerm] = useState<string>(TERMS[0]);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [managing, setManaging] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    const [p, result] = await Promise.all([fetchCurrentGradingPeriod(), fetchAcademicPeriods()]);
    setPeriod(p);
    if (result.ok) { setPeriods(result.periods); setPeriodsError(""); }
    else setPeriodsError(result.error);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const currentKey = period.schoolYear ? periodKey(period.schoolYear, period.semester) : "";
  const options = useMemo(() => periodOptions(periods, period, { withStatus: true }), [periods, period]);
  // Default to the Current Grading Period until staff pick something else.
  const effectiveKey = viewKey && options.some(o => o.key === viewKey) ? viewKey : currentKey;
  const viewing = useMemo(() => {
    const found = periods.find(p => periodKey(p.schoolYear, p.term) === effectiveKey);
    return found ?? null;
  }, [periods, effectiveKey]);
  // Memoized: the tabs refetch whenever this object changes identity.
  const viewPeriod: GradingPeriod = useMemo(
    () => (viewing ? periodRefOf(viewing) : { schoolYear: period.schoolYear, semester: period.semester }),
    [viewing, period.schoolYear, period.semester],
  );
  const currentRecord = findPeriod(periods, period);
  const draftTermNormalized = normalizeTerm(draftTerm) ?? draftTerm;
  const targetRecord = findPeriod(periods, { schoolYear: draftYear.trim(), semester: draftTermNormalized });

  function startEditing() {
    setDraftYear(period.schoolYear);
    setDraftTerm(normalizeTerm(period.semester) ?? TERMS[0]);
    setSaveError("");
    setEditing(true);
  }

  function askToConfirm() {
    setSaveError("");
    if (!isValidSchoolYear(draftYear)) { setSaveError("School year must look like 2026-2027 (the second year is one more than the first)."); return; }
    setConfirming(true);
  }

  async function confirmChange() {
    setSaving(true);
    const next = { schoolYear: draftYear.trim(), semester: draftTermNormalized };
    const result = await setCurrentGradingPeriod(next);
    setSaving(false);
    setConfirming(false);
    if (!result.ok) { setSaveError(result.error || "Couldn't change the period."); return; }
    setEditing(false);
    setViewKey(periodKey(next.schoolYear, next.semester));
    await load();
  }

  const deadlineText = viewing ? deadlineSummary(viewing.deadline, new Date()) : null;

  return (
    <div>
      <h1 className="text-xl font-bold text-foreground mb-1">Scholars' Grades Monitoring</h1>
      <p className="text-sm text-slate-600 mb-4">Monitor scholars' grade-completion rates by school and program, and drill into individual grades and GWA.</p>

      <div className="flex flex-wrap items-center gap-3 bg-[#f7f9fc] border border-[#e6ecf5] rounded-xl px-4 py-3 mb-3 text-[13px]">
        <span className="font-bold text-[#062444] uppercase tracking-wide text-[11.5px]">Current Grading Period</span>
        {editing ? (
          <>
            <input value={draftYear} onChange={e => setDraftYear(e.target.value)} aria-label="School year"
              placeholder="e.g. 2025-2026" className="border border-[#062444]/20 rounded-lg px-2.5 py-1.5 text-[13px] outline-none w-32" />
            <select value={draftTerm} onChange={e => setDraftTerm(e.target.value)} aria-label="Term"
              className="border border-[#062444]/20 rounded-lg px-2.5 py-1.5 text-[13px] outline-none bg-white">
              {TERMS.map(t => <option key={t} value={t}>{termLabel(t)}</option>)}
            </select>
            <button onClick={askToConfirm} disabled={saving} className="flex items-center gap-1 text-[12.5px] font-semibold text-white bg-[#062444] rounded-lg px-3 py-1.5 disabled:opacity-60">
              <Check size={13} /> Save
            </button>
            <button onClick={() => { setEditing(false); setSaveError(""); }} className="text-[12.5px] text-slate-600 hover:text-slate-800">Cancel</button>
          </>
        ) : (
          <>
            <span className="text-[#062444] font-semibold">
              {period.schoolYear || "—"} · {period.semester ? termLabel(normalizeTerm(period.semester) ?? period.semester) : "—"}
              {currentRecord && <span className="ml-2 text-[11.5px] font-bold text-slate-600">({statusLabel(currentRecord.status)})</span>}
            </span>
            <button onClick={startEditing} className="flex items-center gap-1 text-[13px] font-semibold text-[#006aa3] hover:underline">
              <Pencil size={12} /> Change
            </button>
            <button onClick={() => setManaging(true)} className="flex items-center gap-1 text-[13px] font-semibold text-[#006aa3] hover:underline sm:ml-auto">
              <CalendarRange size={13} /> Manage periods
            </button>
          </>
        )}
      </div>
      {saveError && <p role="alert" className="text-[12.5px] text-red-600 mb-3">{saveError}</p>}
      {periodsError && <p role="alert" className="text-[12.5px] text-red-600 mb-3">Couldn't load the academic periods: {periodsError}</p>}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-5">
        <PeriodSelect label="Viewing period" options={options} value={effectiveKey} onChange={setViewKey} />
        {viewing && effectiveKey !== currentKey && (
          <button onClick={() => setViewKey(null)} className="text-[13px] font-semibold text-[#006aa3] hover:underline">Back to the current period</button>
        )}
        {viewing && <span className="text-[12.5px] text-slate-600">Status: <strong className="text-[#062444]">{statusLabel(viewing.status)}</strong></span>}
        {deadlineText && <span className="text-[12.5px] text-slate-600">{deadlineText}</span>}
        <button onClick={() => setExporting(true)} disabled={periods.length === 0}
          className="flex items-center gap-1.5 text-[13.5px] font-semibold text-[#006aa3] hover:underline disabled:opacity-50 sm:ml-auto">
          <Download size={14} aria-hidden="true" /> Export to Excel
        </button>
      </div>

      <div className="flex w-full gap-1 border-b border-border mb-5">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 sm:gap-2 px-2 sm:px-4 py-2.5 text-[13.5px] font-bold border-b-2 transition-colors ${
              tab === t.key ? "border-primary text-foreground" : "border-transparent text-slate-600 hover:text-foreground"
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === "schools" && <ScholarsGradesMonitoringSchoolsTab period={viewPeriod} periodId={viewing?.id ?? null} />}
      {tab === "scholars" && <ScholarsGradesMonitoringScholarsTab period={viewPeriod} periodId={viewing?.id ?? null} />}
      {tab === "corrections" && <ScholarsGradesMonitoringCorrectionsTab />}
      {tab === "cleanup" && <ScholarsGradesMonitoringCleanupTab />}

      {exporting && <GradesExportDialog periods={periods} current={period} viewKey={effectiveKey} onClose={() => setExporting(false)} />}

      {confirming && (
        <Modal title="Change the Current Grading Period?" onClose={() => setConfirming(false)}>
          <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-lg px-3.5 py-3 mb-4">
            <AlertTriangle size={17} className="text-amber-600 shrink-0 mt-0.5" />
            <p className="text-[13px] text-amber-900">
              This also changes the <strong>SDP credit period</strong>. From now on, SDP credit earned by scholars is counted in
              {" "}<strong>{draftYear.trim()} · {termLabel(draftTermNormalized)}</strong>, and the SDP checklist shows that period's totals
              (credit above 3 per category carries forward automatically).
            </p>
          </div>
          <p className="text-[13px] text-slate-700 mb-1">
            Now: <strong>{period.schoolYear || "—"} · {period.semester ? termLabel(normalizeTerm(period.semester) ?? period.semester) : "—"}</strong>
          </p>
          <p className="text-[13px] text-slate-700 mb-3">
            New: <strong>{draftYear.trim()} · {termLabel(draftTermNormalized)}</strong>
            {targetRecord ? ` (currently ${statusLabel(targetRecord.status)})` : " (a new period — it will be created as Open)"}
          </p>
          {targetRecord && targetRecord.status === "closed" && (
            <p className="text-[12.5px] text-amber-800 mb-3">This period is Closed, so schools will not be able to enter grades for it until you reopen it from Manage periods.</p>
          )}
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirming(false)} className="px-4 py-2 rounded-lg border border-[#062444]/20 text-[13px] font-semibold text-[#062444]">Cancel</button>
            <button onClick={() => void confirmChange()} disabled={saving}
              className="bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-60 text-white text-[13px] font-semibold rounded-lg px-4 py-2">
              {saving ? "Changing…" : "Change period"}
            </button>
          </div>
        </Modal>
      )}

      {managing && (
        <AcademicPeriodsModal periods={periods} current={period} onClose={() => setManaging(false)} onChanged={() => void load()} />
      )}
    </div>
  );
}
