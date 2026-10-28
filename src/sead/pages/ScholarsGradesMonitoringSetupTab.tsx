import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import {
  fetchGradingSetup, fetchGradingSetupSchools, MARK_OUTCOME_LABEL, saveGradingSetup, type GradingSetupSchool, type MarkOutcome,
} from "../enteredGradesApi";
import { Modal } from "../components/Modal";

const inputCls = "w-full rounded-lg border border-[#062444]/25 px-2.5 py-2 text-[14px] outline-none focus:border-[#062444] bg-white";
interface Form { scaleMin: string; scaleMax: string; direction: "lower_is_better" | "higher_is_better"; passingMark: string; usesLetterGrades: boolean; letters: { letter: string; numericValue: string }[]; marks: { mark: string; meaning: string; outcome: MarkOutcome }[]; note: string }
const OUTCOMES = Object.keys(MARK_OUTCOME_LABEL) as MarkOutcome[];

function statusOf(s: GradingSetupSchool): { text: string; tone: string } {
  if (!s.hasSetup || s.passingMark == null) return { text: s.hasSetup ? "No passing mark yet" : "Not set up", tone: "bg-red-100 text-red-950 border-red-300" };
  if (s.setByStaff) return { text: "Set by staff (temporary)", tone: "bg-amber-100 text-amber-950 border-amber-300" };
  return { text: "Set by the school", tone: "bg-green-100 text-green-950 border-green-300" };
}

/**
 * Scholars' Grades Monitoring > Grading setup. Until a school sets up its own grading system in the School Portal, staff can set it up for the time being (the scale, the passing mark,
 * the letter grades and the non-numeric marks with what they mean) so that grades entered by scholars can be judged as passed or failed. A setup made here is marked "set by staff
 * (temporary)"; when the school saves its own, the mark goes away.
 */
export function ScholarsGradesMonitoringSetupTab() {
  const [schools, setSchools] = useState<GradingSetupSchool[] | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<GradingSetupSchool | null>(null);
  const [notice, setNotice] = useState("");
  const [typed, setTyped] = useState("");

  const load = useCallback(async () => {
    const r = await fetchGradingSetupSchools();
    if (r.ok) { setSchools(r.schools); setError(""); } else setError(r.missing ? "Grading setup needs the latest database update (the three supabase_migration_entered_grades files)." : r.error);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const shown = (schools ?? []).filter(s => !typed.trim() || s.name.toLowerCase().includes(typed.trim().toLowerCase()));

  return (
    <div>
      <p className="text-[14px] text-slate-700 mb-3">Set up a school's grading system for the time being, so grades that scholars enter can be judged as passed or failed. A school's own setup (made in the School Portal) is shown as “Set by the school”; saving here replaces it and marks it temporary until the school saves its own again.</p>
      {notice && <p role="status" className="mb-3 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-[14px] text-green-950">{notice}</p>}
      <input value={typed} onChange={e => setTyped(e.target.value)} placeholder="Search a school" aria-label="Search a school" className="mb-3 w-full max-w-sm rounded-lg border border-[#062444]/25 px-3 py-2 text-[14px] outline-none focus:border-[#062444] bg-white" />
      {error ? <p role="alert" className="text-[14px] text-red-700">{error}</p> : !schools ? <p className="text-[14px] text-slate-700 flex items-center gap-2"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…</p> : (
        <ul className="space-y-2">
          {shown.map(s => {
            const st = statusOf(s);
            return (
              <li key={s.schoolId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#e6ecf5] bg-white px-4 py-3 text-[14px]">
                <div>
                  <p className="font-bold text-[#062444]">{s.name}</p>
                  <p className="text-slate-800">{s.scholars} active scholar{s.scholars === 1 ? "" : "s"} · passing mark {s.passingMark ?? "not set"} · {s.letters} letter grade{s.letters === 1 ? "" : "s"} · {s.marks} other mark{s.marks === 1 ? "" : "s"}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full border px-2.5 py-0.5 text-[13px] font-semibold ${st.tone}`}>{st.text}</span>
                  <button onClick={() => { setNotice(""); setEditing(s); }} className="rounded-lg border border-[#062444]/25 bg-white px-3 py-1.5 font-semibold text-[#062444] hover:bg-[#f7f9fc]">{s.hasSetup ? "Edit" : "Set up"}</button>
                </div>
              </li>
            );
          })}
          {shown.length === 0 && <li className="rounded-xl border border-dashed border-[#e6ecf5] px-4 py-6 text-center text-[14px] text-slate-700">No school matches.</li>}
        </ul>
      )}
      {editing && <SetupModal school={editing} onClose={() => setEditing(null)} onSaved={async () => { setNotice(`The grading setup of ${editing.name} was saved (temporary, set by staff).`); setEditing(null); await load(); }} />}
    </div>
  );
}

function SetupModal({ school, onClose, onSaved }: { school: GradingSetupSchool; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState<Form | null>(null);
  const [own, setOwn] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    void fetchGradingSetup(school.schoolId).then(r => {
      if (!live) return;
      if (!r.ok) { setLoadError(r.error); return; }
      const c = r.setup.config;
      setOwn(!!c && !c.setByStaff && c.passingMark != null);
      setForm({
        scaleMin: String(c?.scaleMin ?? 1), scaleMax: String(c?.scaleMax ?? 5), direction: c?.direction ?? "lower_is_better", passingMark: c?.passingMark == null ? "" : String(c.passingMark),
        usesLetterGrades: c?.usesLetterGrades ?? false, letters: r.setup.letters, marks: r.setup.marks, note: c?.staffNote ?? "",
      });
    });
    return () => { live = false; };
  }, [school.schoolId]);

  const set = (patch: Partial<Form>) => setForm(f => (f ? { ...f, ...patch } : f));
  async function save() {
    if (!form) return;
    setBusy(true); setError("");
    const r = await saveGradingSetup(school.schoolId, form);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    await onSaved();
  }

  return (
    <Modal title={`Grading setup: ${school.name}`} onClose={onClose}>
      {loadError ? <p role="alert" className="text-[14px] text-red-700">{loadError}</p> : !form ? <p className="text-[14px] text-slate-700 flex items-center gap-2"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…</p> : (
        <div className="space-y-4 text-[14px] text-slate-900">
          {own && <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-950">This school set up its own grading system. Saving here replaces it and marks it as temporary (set by staff) until the school saves its own again.</p>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className="font-semibold text-[#062444]">Lowest grade<input value={form.scaleMin} onChange={e => set({ scaleMin: e.target.value })} inputMode="decimal" className={`${inputCls} mt-1 font-normal`} /></label>
            <label className="font-semibold text-[#062444]">Highest grade<input value={form.scaleMax} onChange={e => set({ scaleMax: e.target.value })} inputMode="decimal" className={`${inputCls} mt-1 font-normal`} /></label>
            <label className="font-semibold text-[#062444]">Passing mark<input value={form.passingMark} onChange={e => set({ passingMark: e.target.value })} inputMode="decimal" className={`${inputCls} mt-1 font-normal`} /></label>
            <label className="font-semibold text-[#062444]">A better grade is
              <select value={form.direction} onChange={e => set({ direction: e.target.value as Form["direction"] })} className={`${inputCls} mt-1 font-normal`}>
                <option value="lower_is_better">a lower number (1.0 is best)</option><option value="higher_is_better">a higher number (100 is best)</option>
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2 font-semibold text-[#062444]"><input type="checkbox" checked={form.usesLetterGrades} onChange={e => set({ usesLetterGrades: e.target.checked })} className="h-4 w-4" /> This school also uses letter grades (A, B, C…)</label>

          {form.usesLetterGrades && (
            <div>
              <p className="font-bold text-[#062444]">Letter grades and the number each one stands for</p>
              <div className="mt-1 space-y-1.5">
                {form.letters.map((l, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                    <input value={l.letter} onChange={e => set({ letters: form.letters.map((x, j) => (j === i ? { ...x, letter: e.target.value } : x)) })} placeholder="Letter" aria-label={`Letter ${i + 1}`} maxLength={12} className={inputCls} />
                    <input value={l.numericValue} onChange={e => set({ letters: form.letters.map((x, j) => (j === i ? { ...x, numericValue: e.target.value } : x)) })} placeholder="Number" aria-label={`Number of letter ${i + 1}`} inputMode="decimal" className={inputCls} />
                    <button onClick={() => set({ letters: form.letters.filter((_, j) => j !== i) })} aria-label={`Remove letter ${i + 1}`} className="rounded-lg border border-[#062444]/25 px-2 text-[#062444] hover:bg-[#f7f9fc]"><Trash2 size={15} aria-hidden="true" /></button>
                  </div>
                ))}
              </div>
              <button onClick={() => set({ letters: [...form.letters, { letter: "", numericValue: "" }] })} className="mt-1.5 inline-flex items-center gap-1.5 font-semibold text-[#00709f] hover:underline"><Plus size={14} aria-hidden="true" /> Add a letter</button>
            </div>
          )}

          <div>
            <p className="font-bold text-[#062444]">Other marks that are not numbers (for example F, W, NG) and what they mean for renewal</p>
            <p className="text-[13.5px] text-slate-700">INC and DRP are built in for every school and cannot be added here.</p>
            <div className="mt-1 space-y-1.5">
              {form.marks.map((m, i) => (
                <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[6rem_1fr_12rem_auto]">
                  <input value={m.mark} onChange={e => set({ marks: form.marks.map((x, j) => (j === i ? { ...x, mark: e.target.value } : x)) })} placeholder="Mark" aria-label={`Mark ${i + 1}`} maxLength={12} className={inputCls} />
                  <input value={m.meaning} onChange={e => set({ marks: form.marks.map((x, j) => (j === i ? { ...x, meaning: e.target.value } : x)) })} placeholder="What it stands for" aria-label={`Meaning of mark ${i + 1}`} maxLength={120} className={`${inputCls} col-span-2 sm:col-span-1`} />
                  <select value={m.outcome} onChange={e => set({ marks: form.marks.map((x, j) => (j === i ? { ...x, outcome: e.target.value as MarkOutcome } : x)) })} aria-label={`Outcome of mark ${i + 1}`} className={inputCls}>
                    {OUTCOMES.map(o => <option key={o} value={o}>{MARK_OUTCOME_LABEL[o]}</option>)}
                  </select>
                  <button onClick={() => set({ marks: form.marks.filter((_, j) => j !== i) })} aria-label={`Remove mark ${i + 1}`} className="rounded-lg border border-[#062444]/25 px-2 text-[#062444] hover:bg-[#f7f9fc]"><Trash2 size={15} aria-hidden="true" /></button>
                </div>
              ))}
            </div>
            <button onClick={() => set({ marks: [...form.marks, { mark: "", meaning: "", outcome: "failed" }] })} className="mt-1.5 inline-flex items-center gap-1.5 font-semibold text-[#00709f] hover:underline"><Plus size={14} aria-hidden="true" /> Add a mark</button>
          </div>

          <label className="block font-semibold text-[#062444]">Note (where this setup comes from; optional)
            <textarea value={form.note} onChange={e => set({ note: e.target.value })} rows={2} maxLength={500} className={`${inputCls} mt-1 font-normal`} />
          </label>
          {error && <p role="alert" className="text-red-700">{error}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} disabled={busy} className="rounded-lg border border-[#062444]/25 px-4 py-2 font-semibold text-[#062444]">Cancel</button>
            <button onClick={() => void save()} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-[#062444] px-4 py-2 font-bold text-white disabled:opacity-60">{busy && <Loader2 size={15} className="animate-spin" aria-hidden="true" />} Save the setup</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
