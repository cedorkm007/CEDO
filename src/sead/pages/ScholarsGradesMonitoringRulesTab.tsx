import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { fetchGradingSetupSchools, type GradingSetupSchool } from "../enteredGradesApi";
import { fetchSchoolRules, fetchSchoolRulesVersion } from "../schoolGradingRulesApi";
import { GradingRulesView } from "@/app/components/GradingRulesView";
import { describeChanges } from "@/lib/gradingRules";
import type { RulesOverview, SavedVersion } from "@/lib/gradingRulesData";
import { periodTitle } from "@/lib/academicPeriods";
import { formatDateTime } from "@/lib/renewal";
import { Modal } from "../components/Modal";

const when = (y: string, t: string) => periodTitle({ schoolYear: y, semester: t });

/**
 * Scholars' Grades Monitoring > Grading rules. CEDO staff see, read-only, each school's grade conversion table, passing marks, GWA settings, the versions and the history of changes.
 * Only the school changes its rules (in the School Portal); nothing here can save.
 */
export function ScholarsGradesMonitoringRulesTab() {
  const [schools, setSchools] = useState<GradingSetupSchool[] | null>(null);
  const [error, setError] = useState("");
  const [typed, setTyped] = useState("");
  const [opening, setOpening] = useState<GradingSetupSchool | null>(null);
  const [overview, setOverview] = useState<RulesOverview | null>(null);
  const [openError, setOpenError] = useState("");
  const [version, setVersion] = useState<SavedVersion | null>(null);

  const load = useCallback(async () => {
    const r = await fetchGradingSetupSchools();
    if (r.ok) { setSchools(r.schools); setError(""); } else setError(r.error);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function open(s: GradingSetupSchool) {
    setOpening(s); setOverview(null); setOpenError("");
    const r = await fetchSchoolRules(s.schoolId);
    if (r.ok) setOverview(r.overview); else setOpenError(r.missing ? "The grading rules need the latest database update (supabase_migration_school_grading_rules_a_tables.sql and _c_functions.sql)." : r.error);
  }
  async function openVersion(id: string) {
    const r = await fetchSchoolRulesVersion(id);
    if (r.ok) setVersion(r.version); else setOpenError(r.error);
  }
  const shown = (schools ?? []).filter(s => !typed.trim() || s.name.toLowerCase().includes(typed.trim().toLowerCase()));

  return (
    <div>
      <p className="text-[14px] text-slate-700 mb-3">Each school's grade conversion table, passing marks and GWA settings, as the school saved them. You can only look: the school changes its own rules in the School Portal, and every change is kept in the history.</p>
      <input value={typed} onChange={e => setTyped(e.target.value)} placeholder="Search a school" aria-label="Search a school" className="mb-3 w-full max-w-sm rounded-lg border border-[#062444]/25 px-3 py-2 text-[14px] outline-none focus:border-[#062444] bg-white" />
      {error ? <p role="alert" className="text-[14px] text-red-700">{error}</p> : !schools ? <p className="text-[14px] text-slate-700 flex items-center gap-2"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…</p> : (
        <ul className="space-y-2">
          {shown.map(s => (
            <li key={s.schoolId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#e6ecf5] bg-white px-4 py-3 text-[14px]">
              <div><p className="font-bold text-[#062444]">{s.name}</p><p className="text-slate-800">{s.scholars} active scholar{s.scholars === 1 ? "" : "s"}</p></div>
              <button onClick={() => void open(s)} className="rounded-lg border border-[#062444]/25 bg-white px-3 py-1.5 font-semibold text-[#062444] hover:bg-[#f7f9fc]">View grading rules</button>
            </li>
          ))}
          {shown.length === 0 && <li className="rounded-xl border border-dashed border-[#e6ecf5] px-4 py-6 text-center text-[14px] text-slate-700">No school matches.</li>}
        </ul>
      )}

      {opening && (
        <Modal title={`Grading rules — ${opening.name}`} onClose={() => { setOpening(null); setOverview(null); setVersion(null); }}>
          {openError ? <p role="alert" className="text-[14px] text-red-700">{openError}</p> : !overview ? <p className="text-[14px] text-slate-700 flex items-center gap-2"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…</p> : (
            <div className="space-y-5 text-[14.5px] text-slate-900">
              <p>{overview.currentPeriod ? <>Current period: <strong>{when(overview.currentPeriod.schoolYear, overview.currentPeriod.term)}</strong>{overview.currentPeriod.submitted ? " (submitted by the school)" : ""}. </> : null}
                {overview.active ? <>Rules in use now: <strong>version {overview.active.versionNo}</strong>, started {when(overview.active.effectiveYear, overview.active.effectiveTerm)}.</> : <>No rules are in use yet: the school's passing mark on its own scale{overview.scale?.passingMark != null ? ` (${overview.scale.passingMark})` : ""} still decides who passed.</>}</p>
              {overview.scale && <p>Scale: {overview.scale.scaleMin} to {overview.scale.scaleMax}, {overview.scale.direction === "lower_is_better" ? "lower" : "higher"} is better{overview.scale.usesLetterGrades ? ", with letter grades" : ""}.</p>}

              {overview.latest ? (
                <section>
                  <h4 className="text-[15px] font-bold text-[#062444] mb-2">{overview.active?.id === overview.latest.id ? `Rules in use (version ${overview.latest.versionNo})` : `Latest saved rules (version ${overview.latest.versionNo}, starts ${when(overview.latest.effectiveYear, overview.latest.effectiveTerm)})`}</h4>
                  <GradingRulesView rules={overview.latest.rules} scale={overview.scale} />
                </section>
              ) : <p className="rounded-lg border border-dashed border-[#062444]/30 px-3.5 py-3">This school has not saved a conversion table or GWA settings.</p>}

              {overview.versions.length > 0 && (
                <section>
                  <h4 className="text-[15px] font-bold text-[#062444] mb-2">Versions</h4>
                  <ul className="space-y-1.5">
                    {overview.versions.map(v => (
                      <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#e6ecf5] bg-white px-3 py-2">
                        <span>Version {v.versionNo} · starts {when(v.effectiveYear, v.effectiveTerm)} · {v.bandCount} row{v.bandCount === 1 ? "" : "s"} · saved {formatDateTime(v.createdAt)}{v.createdByLabel ? ` by ${v.createdByLabel}` : ""}</span>
                        <button onClick={() => void openVersion(v.id)} className="font-semibold text-[#00709f] hover:underline">View</button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {overview.audit.length > 0 && (
                <section>
                  <h4 className="text-[15px] font-bold text-[#062444] mb-2">History of changes</h4>
                  <ul className="space-y-2">
                    {overview.audit.map(a => (
                      <li key={a.id} className="rounded-lg border border-[#e6ecf5] bg-white px-3 py-2">
                        <p className="font-semibold text-[#062444]">Version {a.versionNo ?? "?"} · saved {formatDateTime(a.changedAt)}{a.changedByLabel ? ` by ${a.changedByLabel}` : ""}</p>
                        <ul className="list-disc pl-5">{describeChanges(a.oldRules, a.newRules).map((c, k) => <li key={k}>{c}</li>)}</ul>
                        {a.impact.gradesChecked != null && <p className="text-slate-800">When it was saved: {a.impact.gradesChanged ?? 0} grade result(s) and {a.impact.gwasChanged ?? 0} GWA(s) would change.</p>}
                        {a.note && <p className="text-slate-800">Note: {a.note}</p>}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </Modal>
      )}
      {version && (
        <Modal title={`Version ${version.versionNo} — starts ${when(version.effectiveYear, version.effectiveTerm)}`} onClose={() => setVersion(null)} level={1}>
          <div className="text-[14.5px] text-slate-900"><GradingRulesView rules={version.rules} scale={overview?.scale ?? null} /></div>
        </Modal>
      )}
    </div>
  );
}
