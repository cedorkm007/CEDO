import { useState } from "react";
import { Plus, Save } from "lucide-react";
import { Modal } from "./Modal";
import { upsertAcademicPeriod } from "@/lib/academicPeriodsApi";
import {
  TERMS, termLabel, statusLabel, sortPeriods, periodKey, isValidSchoolYear, deadlineSummary,
  type AcademicPeriod, type PeriodRef, type PeriodStatus,
} from "@/lib/academicPeriods";

const STATUSES: PeriodStatus[] = ["open", "closed", "archived"];

const inputClass = "border border-[#062444]/20 rounded-lg px-2.5 py-1.5 text-[13px] text-[#062444] outline-none focus:border-[#0088cc] bg-white";

function PeriodRow({ period, isCurrent, onChanged }: { period: AcademicPeriod; isCurrent: boolean; onChanged: () => void }) {
  const [status, setStatus] = useState<PeriodStatus>(period.status);
  const [deadline, setDeadline] = useState(period.deadline ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dirty = status !== period.status || deadline !== (period.deadline ?? "");

  async function save() {
    setSaving(true);
    setError("");
    const result = await upsertAcademicPeriod({
      schoolYear: period.schoolYear, term: period.term, status,
      deadline: deadline || null, clearDeadline: deadline === "" && period.deadline !== null,
    });
    setSaving(false);
    if (!result.ok) { setError(result.error || "Couldn't save."); return; }
    onChanged();
  }

  const idBase = `period-${periodKey(period.schoolYear, period.term)}`;
  return (
    <div className="border border-[#e6ecf5] rounded-xl p-3.5 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
        <p className="font-bold text-[13.5px] text-[#062444]">
          {period.schoolYear} · {termLabel(period.term)}
          {isCurrent && <span className="ml-2 text-[11px] font-bold text-[#0088cc] bg-[#e6f4fb] rounded px-1.5 py-0.5">Current</span>}
        </p>
        {period.deadline && <p className="text-[12px] text-slate-600">{deadlineSummary(period.deadline, new Date())}</p>}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idBase}-status`} className="text-[11.5px] font-bold text-slate-600">Status</label>
          <select id={`${idBase}-status`} value={status} onChange={e => setStatus(e.target.value as PeriodStatus)} className={inputClass}>
            {STATUSES.map(s => <option key={s} value={s} disabled={s === "archived" && isCurrent}>{statusLabel(s)}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idBase}-deadline`} className="text-[11.5px] font-bold text-slate-600">Submission deadline (optional)</label>
          <input id={`${idBase}-deadline`} type="date" value={deadline} onChange={e => setDeadline(e.target.value)} className={inputClass} />
        </div>
        <button onClick={save} disabled={!dirty || saving}
          className="flex items-center gap-1.5 bg-[#062444] disabled:opacity-40 text-white text-[12.5px] font-semibold rounded-lg px-3.5 py-2">
          <Save size={13} /> {saving ? "Saving…" : "Save"}
        </button>
      </div>
      {status !== "open" && !isCurrent && dirty && (
        <p className="text-[12px] text-slate-600 mt-2">Schools will not be able to enter or change grades for this period.</p>
      )}
      {isCurrent && status !== "open" && (
        <p className="text-[12px] text-amber-700 mt-2">This is the Current Grading Period — while it is {statusLabel(status)}, schools cannot enter or change its grades.</p>
      )}
      {error && <p role="alert" className="text-[12.5px] text-red-600 mt-2">{error}</p>}
    </div>
  );
}

/**
 * Staff list of academic periods: add one, open / close / archive it, set a submission deadline.
 * Schools can only enter or change grades in an Open period (enforced in the database).
 * The Current Grading Period itself is still changed from the banner on the page, not here.
 */
export function AcademicPeriodsModal({ periods, current, onClose, onChanged }: {
  periods: AcademicPeriod[]; current: PeriodRef; onClose: () => void; onChanged: () => void;
}) {
  const [year, setYear] = useState("");
  const [term, setTerm] = useState<string>(TERMS[0]);
  const [status, setStatus] = useState<PeriodStatus>("open");
  const [deadline, setDeadline] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const currentKey = current.schoolYear ? periodKey(current.schoolYear, current.semester) : "";

  async function add() {
    setError("");
    if (!isValidSchoolYear(year)) { setError("School year must look like 2026-2027 (the second year is one more than the first)."); return; }
    setAdding(true);
    const result = await upsertAcademicPeriod({ schoolYear: year.trim(), term, status, deadline: deadline || null });
    setAdding(false);
    if (!result.ok) { setError(result.error || "Couldn't add the period."); return; }
    setYear(""); setDeadline("");
    onChanged();
  }

  return (
    <Modal title="Manage academic periods" onClose={onClose}>
      <p className="text-[13px] text-slate-600 mb-4">
        Schools can only enter or change grades in an <strong>Open</strong> period. Closing or archiving a period keeps every grade — it only stops schools from changing them.
      </p>

      <div className="border border-dashed border-[#062444]/25 rounded-xl p-3.5 mb-4 bg-[#f7f9fc]">
        <p className="font-bold text-[13px] text-[#062444] mb-2.5">Add a period</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="new-period-year" className="text-[11.5px] font-bold text-slate-600">School year</label>
            <input id="new-period-year" value={year} onChange={e => setYear(e.target.value)} placeholder="2026-2027" className={`${inputClass} w-32`} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="new-period-term" className="text-[11.5px] font-bold text-slate-600">Term</label>
            <select id="new-period-term" value={term} onChange={e => setTerm(e.target.value)} className={inputClass}>
              {TERMS.map(t => <option key={t} value={t}>{termLabel(t)}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="new-period-status" className="text-[11.5px] font-bold text-slate-600">Status</label>
            <select id="new-period-status" value={status} onChange={e => setStatus(e.target.value as PeriodStatus)} className={inputClass}>
              {STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="new-period-deadline" className="text-[11.5px] font-bold text-slate-600">Deadline (optional)</label>
            <input id="new-period-deadline" type="date" value={deadline} onChange={e => setDeadline(e.target.value)} className={inputClass} />
          </div>
          <button onClick={add} disabled={adding}
            className="flex items-center gap-1.5 bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-50 text-white text-[12.5px] font-semibold rounded-lg px-3.5 py-2">
            <Plus size={13} /> {adding ? "Adding…" : "Add period"}
          </button>
        </div>
        {error && <p role="alert" className="text-[12.5px] text-red-600 mt-2">{error}</p>}
      </div>

      {periods.length === 0 ? (
        <p className="text-[13px] text-slate-500 text-center py-6">No periods yet — add one above.</p>
      ) : (
        <div className="space-y-2.5">
          {sortPeriods(periods).map(p => (
            <PeriodRow key={`${p.id}-${p.status}-${p.deadline ?? ""}`} period={p} isCurrent={periodKey(p.schoolYear, p.term) === currentKey} onChanged={onChanged} />
          ))}
        </div>
      )}
    </Modal>
  );
}
