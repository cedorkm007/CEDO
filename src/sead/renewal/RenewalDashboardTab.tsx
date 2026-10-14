import { useCallback, useEffect, useState } from "react";
import { CalendarClock, ChevronDown, FileSpreadsheet, Loader2 } from "lucide-react";
import { formatDay } from "@/lib/renewal";
import { FILTER_GROUPS, NO_FILTER, describeFilter, isFiltered, lastDays, percentOf, percentText, stageGroupCounts, type DashboardData, type ExportFilter } from "@/lib/renewalReport";
import { downloadRenewalExcel, fetchRenewalDashboard } from "../renewalReportApi";

/** One number with its words (the words matter as much as the number: nothing relies on colour alone). */
function Stat({ label, value, note, tone = "plain" }: { label: string; value: number | string; note?: string; tone?: "plain" | "good" | "warn" | "bad" }) {
  const ring = tone === "good" ? "border-green-300 bg-green-50" : tone === "warn" ? "border-amber-300 bg-amber-50" : tone === "bad" ? "border-red-300 bg-red-50" : "border-[#e6ecf5] bg-white";
  return (
    <div className={`rounded-xl border px-4 py-3 ${ring}`}>
      <p className="text-[24px] font-extrabold leading-tight text-[#062444]">{value}</p>
      <p className="text-[14px] font-semibold text-[#062444]">{label}</p>
      {note && <p className="text-[13.5px] text-slate-700">{note}</p>}
    </div>
  );
}

function Panel({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) {
  return (
    <section className="rounded-xl border border-[#e6ecf5] bg-white" aria-label={title}>
      <h3 className="border-b border-[#e6ecf5] px-4 py-2.5 text-[15px] font-bold text-[#062444]">{title}</h3>
      {hint && <p className="px-4 pt-2 text-[13.5px] text-slate-700">{hint}</p>}
      <div className="px-4 py-3 text-[14px] text-slate-800">{children}</div>
    </section>
  );
}

/** A horizontal bar with its number written next to it. */
function Bar({ label, count, max, tone = "bg-[#062444]" }: { label: string; count: number; max: number; tone?: string }) {
  return (
    <li className="grid grid-cols-[minmax(7rem,38%)_1fr_auto] items-center gap-2 py-1">
      <span className="text-[14px] text-slate-800">{label}</span>
      <span className="h-3 rounded bg-[#eef3fb]" aria-hidden="true"><span className={`block h-3 rounded ${tone}`} style={{ width: `${max <= 0 ? 0 : Math.max(count > 0 ? 3 : 0, Math.round((count / max) * 100))}%` }} /></span>
      <span className="w-10 text-right text-[14px] font-bold text-[#062444]">{count}</span>
    </li>
  );
}

/** A group of tick boxes: nothing ticked means "all". */
function Choices({ legend, options, picked, onChange }: { legend: string; options: { key: string; label: string }[]; picked: string[]; onChange: (next: string[]) => void }) {
  if (options.length === 0) return null;
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1 text-[14px] font-bold text-[#062444]">{legend}</legend>
      <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
        {options.map(o => (
          <label key={o.key} className="flex items-start gap-2 text-[14px] text-slate-800">
            <input type="checkbox" className="mt-1" checked={picked.includes(o.key)} onChange={e => onChange(e.target.checked ? [...picked, o.key] : picked.filter(k => k !== o.key))} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * "Dashboard" tab of Scholar Renewal: how the selected term is going, in numbers the evaluator and the Division Head can read at a glance, and the
 * Excel export of the whole term (summary, every application, who has not applied, by school, INC, consultations). The database makes every number.
 */
export function RenewalDashboardTab({ schoolYear, term, refreshKey }: { schoolYear: string; term: string; refreshKey: number }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState<ExportFilter>(NO_FILTER);
  useEffect(() => { setFilter(NO_FILTER); }, [schoolYear, term]);

  const load = useCallback(async () => {
    const r = await fetchRenewalDashboard(schoolYear, term);
    if (r.ok) { setData(r.data); setError(""); } else setError(r.error);
  }, [schoolYear, term]);
  useEffect(() => { setData(null); void load(); }, [load, refreshKey]);

  async function exportExcel() {
    if (!data) return;
    setBusy(true); setMessage(""); setError("");
    const r = await downloadRenewalExcel(schoolYear, term, data, filter);
    setBusy(false);
    if (r.ok) setMessage(`Excel file downloaded (${r.rows} scholar${r.rows === 1 ? "" : "s"}; ${describeFilter(filter)}). This export was recorded in the export log.`); else setError(r.error);
  }

  if (error && !data) return <p role="alert" className="text-[14px] text-red-700">Couldn't load the dashboard: {error}</p>;
  if (!data) return <p className="flex items-center gap-2 text-[14px] text-slate-700"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…</p>;

  const t = data.totals;
  const groups = stageGroupCounts(data.byStage).filter(g => g.count > 0);
  const maxGroup = Math.max(1, ...groups.map(g => g.count));
  const days = lastDays(data.perDay, 21);
  const maxDay = Math.max(1, ...days.map(d => Math.max(d.applied, d.renewed)));
  const ruleEntries = Object.entries(data.byRule).sort((a, b) => a[0].localeCompare(b[0]));
  const maxRule = Math.max(1, ...ruleEntries.map(([, c]) => c));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e6ecf5] bg-[#f7f9fc] px-4 py-3">
        <div>
          <h2 className="text-[16px] font-extrabold text-[#062444]">{data.termLabel}</h2>
          <p className="flex items-center gap-1.5 text-[14px] text-slate-700">
            <CalendarClock size={14} aria-hidden="true" />
            {data.window ? <>{formatDay(data.window.opensOn)} to {formatDay(data.window.closesOn)} · {data.window.isOpen ? `open, ${data.window.daysLeft} day${data.window.daysLeft === 1 ? "" : "s"} left` : "closed"}</> : "No renewal window for this term"}
          </p>
        </div>
        <button type="button" onClick={() => void exportExcel()} disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg border border-green-300 bg-green-50 px-4 py-2.5 text-[14px] font-bold text-green-800 hover:bg-green-100 disabled:opacity-60">
          {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <FileSpreadsheet size={15} aria-hidden="true" />} Download Excel{isFiltered(filter) ? " (filtered)" : ""}
        </button>
      </div>
      <details className="rounded-xl border border-[#e6ecf5] bg-white">
        <summary className="flex cursor-pointer items-center gap-2 px-4 py-2.5 text-[14px] font-bold text-[#062444]"><ChevronDown size={15} aria-hidden="true" /> Choose what goes into the Excel file <span className="font-normal text-slate-700">— {describeFilter(filter)}</span></summary>
        <div className="space-y-3 border-t border-[#e6ecf5] px-4 py-3">
          <p className="text-[14px] text-slate-700">Tick what you want. Nothing ticked means everyone. Only the chosen scholars leave the database, and the export log records the filter.</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Choices legend="School" options={data.filterOptions.schools.map(x => ({ key: x, label: x }))} picked={filter.schools} onChange={schools => setFilter(f => ({ ...f, schools }))} />
            <Choices legend="Year level" options={data.filterOptions.yearLevels.map(x => ({ key: x, label: x }))} picked={filter.yearLevels} onChange={yearLevels => setFilter(f => ({ ...f, yearLevels }))} />
            <Choices legend="Program" options={data.filterOptions.programs.map(x => ({ key: x, label: x }))} picked={filter.programs} onChange={programs => setFilter(f => ({ ...f, programs }))} />
            <Choices legend="Status" options={FILTER_GROUPS} picked={filter.groups} onChange={groups => setFilter(f => ({ ...f, groups }))} />
          </div>
          {isFiltered(filter) && <button type="button" onClick={() => setFilter(NO_FILTER)} className="text-[14px] font-semibold text-[#00709f] hover:underline">Clear the choices</button>}
        </div>
      </details>
      {message && <p role="status" className="text-[14px] font-semibold text-green-800">{message}</p>}
      {error && <p role="alert" className="text-[14px] text-red-700">{error}</p>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Scholars who can renew" value={t.canRenew} />
        <Stat label="Applied" value={t.applied} note={percentText(t.applied, t.canRenew)} tone="good" />
        <Stat label="Not applied yet" value={t.notApplied} tone={t.notApplied > 0 ? "warn" : "plain"} />
        <Stat label="Renewed" value={t.renewed} note={t.avgDaysToRenew == null ? "No renewal confirmed yet" : `${t.avgDaysToRenew} days on average from application`} tone="good" />
        <Stat label="Removed" value={t.removed} tone={t.removed > 0 ? "bad" : "plain"} />
        <Stat label="With the Division Head" value={data.divisionHead.waiting} note={data.divisionHead.sentBack ? `${data.divisionHead.sentBack} sent back to the evaluator` : undefined} />
        <Stat label="Late applications" value={t.late} note={t.lateWaiting ? `${t.lateWaiting} waiting for a decision` : undefined} tone={t.lateWaiting ? "warn" : "plain"} />
        <Stat label="Returned to the scholar" value={t.returned} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Where the applications are" hint="Grouped like the Applications board.">
          {groups.length === 0 ? <p>No applications yet.</p> : (
            <ul>{groups.map(g => <Bar key={g.key} label={g.label} count={g.count} max={maxGroup} />)}</ul>
          )}
          {groups.length > 0 && (
            <details className="mt-2"><summary className="cursor-pointer text-[14px] font-semibold text-[#00709f]">Every stage</summary>
              <ul className="mt-1">{groups.flatMap(g => g.stages).map(s => <li key={s.stage} className="flex justify-between py-0.5 text-[14px]"><span>{s.title}</span><strong>{s.count}</strong></li>)}</ul>
            </details>
          )}
        </Panel>

        <Panel title="Outcomes" hint="Only the evaluator's confirmation makes a renewal count as Renewed.">
          <ul className="space-y-1 text-[14px]">
            <li className="flex justify-between"><span>Renewed — regular</span><strong>{t.renewedRegular}</strong></li>
            <li className="flex justify-between"><span>Renewed — Probationary</span><strong>{t.renewedProbationary}</strong></li>
            <li className="flex justify-between"><span>Renewed — Reconsidered</span><strong>{t.renewedReconsidered}</strong></li>
            <li className="flex justify-between"><span>Removed</span><strong>{t.removed}</strong></li>
            <li className="flex justify-between border-t border-[#eef3fb] pt-1"><span>Division Head: approved Probationary</span><strong>{data.divisionHead.approvedProbationary}</strong></li>
            <li className="flex justify-between"><span>Division Head: reconsidered</span><strong>{data.divisionHead.reconsidered}</strong></li>
            <li className="flex justify-between"><span>Division Head: removed</span><strong>{data.divisionHead.removed}</strong></li>
          </ul>
        </Panel>

        <Panel title="Applications per day" hint="The last 21 days with activity.">
          {days.length === 0 ? <p>No applications yet.</p> : (
            <>
              <div className="flex h-28 items-end gap-1" role="img" aria-label={`Applications per day, last ${days.length} days: ${days.map(d => `${d.day} ${d.applied}`).join(", ")}`}>
                {days.map(d => (
                  <div key={d.day} className="flex flex-1 flex-col items-center justify-end gap-0.5" title={`${d.day}: ${d.applied} applied, ${d.renewed} renewed`}>
                    <div className="w-full rounded-t bg-[#062444]" style={{ height: `${Math.round((d.applied / maxDay) * 100)}%`, minHeight: d.applied > 0 ? 3 : 0 }} />
                  </div>
                ))}
              </div>
              <p className="mt-1 text-[13.5px] text-slate-700">{days[0].day} to {days[days.length - 1].day} · busiest day: {Math.max(...days.map(d => d.applied))} applications</p>
              <details className="mt-1"><summary className="cursor-pointer text-[14px] font-semibold text-[#00709f]">Show as a table</summary>
                <table className="mt-1 w-full text-left text-[14px]"><thead><tr><th className="py-1 pr-3">Day</th><th className="py-1 pr-3">Applied</th><th className="py-1">Renewed</th></tr></thead>
                  <tbody>{days.filter(d => d.applied > 0 || d.renewed > 0).map(d => <tr key={d.day}><td className="py-0.5 pr-3">{d.day}</td><td className="py-0.5 pr-3">{d.applied}</td><td className="py-0.5">{d.renewed}</td></tr>)}</tbody></table>
              </details>
            </>
          )}
        </Panel>

        <Panel title="Which rule applied" hint="A: all passed · B: one failed · C2 / C1P: two or more failed (or one after probation) · D: INC · S: Summer.">
          {ruleEntries.length === 0 ? <p>Nothing yet.</p> : <ul>{ruleEntries.map(([rule, c]) => <Bar key={rule} label={rule} count={c} max={maxRule} tone="bg-sky-700" />)}</ul>}
        </Panel>

        <Panel title="SDP, grades and INC">
          <ul className="space-y-1 text-[14px]">
            <li className="flex justify-between"><span>On hold: SDP not complied</span><strong>{data.sdpAndGrades.sdpOnHold}</strong></li>
            <li className="flex justify-between"><span>Waiting for the school's grades</span><strong>{data.sdpAndGrades.waitingGrades}</strong></li>
            <li className="flex justify-between"><span>Needing the evaluator's review</span><strong>{data.sdpAndGrades.reviewNeeded}</strong></li>
            <li className="flex justify-between"><span>With a failed subject</span><strong>{data.sdpAndGrades.withFailed}</strong></li>
            <li className="flex justify-between border-t border-[#eef3fb] pt-1"><span>Open INC subjects</span><strong>{data.inc.open}</strong></li>
            <li className="flex justify-between"><span>… without a deadline yet</span><strong>{data.inc.noDeadline}</strong></li>
            <li className="flex justify-between"><span>… due within 7 days</span><strong>{data.inc.dueIn7Days}</strong></li>
            <li className="flex justify-between"><span>… overdue</span><strong className={data.inc.overdue > 0 ? "text-red-800" : ""}>{data.inc.overdue}</strong></li>
          </ul>
        </Panel>

        <Panel title="Consultations and documents">
          <ul className="space-y-1 text-[14px]">
            <li className="flex justify-between"><span>Consultations required</span><strong>{data.consultations.required}</strong></li>
            <li className="flex justify-between"><span>… done</span><strong>{data.consultations.done} <span className="font-normal text-slate-700">({percentOf(data.consultations.done, data.consultations.required)}%)</span></strong></li>
            <li className="flex justify-between"><span>… booked (upcoming)</span><strong>{data.consultations.bookedUpcoming}</strong></li>
            <li className="flex justify-between"><span>… still to be booked</span><strong>{data.consultations.needBooking}</strong></li>
            <li className="flex justify-between"><span>Missed appointments (no-shows)</span><strong>{data.consultations.noShows}</strong></li>
            <li className="flex justify-between border-t border-[#eef3fb] pt-1"><span>Documents waiting for review</span><strong className={data.documents.waitingReview > 0 ? "text-amber-900" : ""}>{data.documents.waitingReview}</strong></li>
            <li className="flex justify-between"><span>Documents approved / returned</span><strong>{data.documents.approved} / {data.documents.returned}</strong></li>
          </ul>
        </Panel>
      </div>

      <Panel title="By school">
        {data.bySchool.length === 0 ? <p>No schools yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-[14px]">
              <thead><tr className="border-b border-[#e6ecf5] text-[#062444]"><th scope="col" className="py-1.5 pr-3">School</th><th scope="col" className="py-1.5 pr-3">Applied</th><th scope="col" className="py-1.5 pr-3">Renewed</th><th scope="col" className="py-1.5 pr-3">Removed</th><th scope="col" className="py-1.5 pr-3">In progress</th><th scope="col" className="py-1.5">Not applied</th></tr></thead>
              <tbody>
                {data.bySchool.map(s => (
                  <tr key={s.school} className="border-b border-[#eef3fb] last:border-0">
                    <th scope="row" className="py-1.5 pr-3 font-semibold">{s.school}</th><td className="py-1.5 pr-3">{s.applied}</td><td className="py-1.5 pr-3">{s.renewed}</td><td className="py-1.5 pr-3">{s.removed}</td><td className="py-1.5 pr-3">{s.pending}</td><td className="py-1.5">{s.notApplied}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
