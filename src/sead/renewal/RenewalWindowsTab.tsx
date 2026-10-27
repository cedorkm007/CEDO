import { useEffect, useState } from "react";
import { FlaskConical, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { RENEWAL_TERMS, formatDay, renewalBasis, termLabelOf, windowState } from "@/lib/renewal";
import { isValidSchoolYear } from "@/lib/academicPeriods";
import { clearWindowTestData, deleteRenewalWindow, fetchWindowSchools, lookupScholars, saveRenewalWindow, type RenewalWindowRow, type ScholarChoice, type WindowSchool } from "../renewalApi";
import { ModalShell } from "../components/SeadUiShell";

const STATE_TEXT = { upcoming: "Not open yet", open: "Open", late: "Closed — late applications go to the evaluator", closed: "Closed" } as const;

/** Open a renewal window per term (start and end date). Late applications after the end date go to the "Late" list. */
export function RenewalWindowsTab({ windows, onChanged }: { windows: RenewalWindowRow[]; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState<RenewalWindowRow | "new" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  // the schools to tick (null until loaded; legacy = the database update has not been run yet, so the choice is hidden)
  const [schools, setSchools] = useState<WindowSchool[] | null>(null);
  const [schoolsLegacy, setSchoolsLegacy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void fetchWindowSchools().then(r => { if (cancelled) return; if (r.ok) setSchools(r.schools); else setSchoolsLegacy(!!r.legacy); });
    return () => { cancelled = true; };
  }, []);

  async function clearTest(w: RenewalWindowRow) {
    if (!window.confirm(`Clear the test data of ${termLabelOf(w.schoolYear, w.term)}?\n\nThis deletes the renewals of the ${w.testers.length} test scholar${w.testers.length === 1 ? "" : "s"} for this term (their history, documents, referrals, notices and certificate records) and frees their booked consultation slots. It cannot be undone. A scholar's status (for example Probationary) is not changed.`)) return;
    const r = await clearWindowTestData(w.id);
    if (!r.ok) { setError(r.error); setMessage(""); return; }
    const c = r.cleared;
    setError(""); setMessage(`Cleared: ${c.records} renewal${c.records === 1 ? "" : "s"}, ${c.slotsReleased} consultation slot${c.slotsReleased === 1 ? "" : "s"} freed, ${c.referrals} referral${c.referrals === 1 ? "" : "s"}, ${c.certificates} certificate record${c.certificates === 1 ? "" : "s"}.${c.filesLeft.length ? ` ${c.filesLeft.length} uploaded file${c.filesLeft.length === 1 ? "" : "s"} stay in the private folders until you delete them in the Supabase dashboard: ${c.filesLeft.join(", ")}.` : ""}`);
    await onChanged();
  }

  async function remove(w: RenewalWindowRow) {
    if (!window.confirm(`Delete the renewal window for ${termLabelOf(w.schoolYear, w.term)}? This only works if nobody has applied.`)) return;
    const r = await deleteRenewalWindow(w.id);
    if (!r.ok) { setError(r.error); return; }
    setError(""); await onChanged();
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <h2 className="text-[15px] font-bold text-[#062444]">Renewal windows</h2>
          <p className="text-[14px] text-slate-700">Scholars apply once per term. Each window has a start and an end date.</p>
        </div>
        <button onClick={() => setEditing("new")} className="inline-flex items-center gap-1.5 rounded-lg bg-[#062444] px-4 py-2 text-[14px] font-bold text-white hover:bg-[#0a3a6e]"><Plus size={15} aria-hidden="true" /> Open a renewal window</button>
      </div>
      {error && <p role="alert" className="mb-2 text-[14px] text-red-700">{error}</p>}
      {message && <p role="status" className="mb-2 text-[14px] text-green-800">{message}</p>}
      {windows.length === 0 ? <p className="rounded-xl border border-dashed border-[#e6ecf5] px-4 py-8 text-center text-[14px] text-slate-700">No renewal window yet. Open one so scholars can apply.</p> : (
        <ul className="space-y-2">
          {windows.map(w => {
            const state = windowState(w.opensOn, w.closesOn, w.lateAllowed);
            const basis = renewalBasis(w.schoolYear, w.term);
            return (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e6ecf5] bg-white px-4 py-3">
                <div>
                  <p className="text-[15px] font-bold text-[#062444]">{termLabelOf(w.schoolYear, w.term)}</p>
                  <p className="text-[14px] text-slate-700">{formatDay(w.opensOn)} to {formatDay(w.closesOn)} · <strong>{STATE_TEXT[state]}</strong>{!w.lateAllowed && " · late applications refused"}</p>
                  {basis && <p className="text-[13.5px] text-slate-600">Checks {termLabelOf(basis.schoolYear, basis.term)}</p>}
                  {w.note && <p className="text-[13.5px] text-slate-700">Note: {w.note}</p>}
                  <p className="text-[13.5px] text-slate-700">{w.schoolIds.length === 0 ? "For the scholars of all schools" : <>For the scholars of <strong>{w.schoolIds.length} school{w.schoolIds.length === 1 ? "" : "s"}</strong>: {w.schoolIds.map(id => schools?.find(s => s.schoolId === id)?.name ?? "a school").join(", ")}</>}</p>
                  {w.testers.length > 0 && <p className="mt-1 inline-flex flex-wrap items-center gap-1.5 rounded-md bg-amber-100 px-2 py-1 text-[13.5px] font-bold text-amber-950"><FlaskConical size={14} aria-hidden="true" /> TESTERS ONLY — only these {w.testers.length} scholar{w.testers.length === 1 ? "" : "s"} can see it: <span className="font-normal">{w.testers.join(", ")}</span></p>}
                </div>
                <div className="flex flex-wrap gap-3">
                  {w.testers.length > 0 && <button onClick={() => void clearTest(w)} className="inline-flex items-center gap-1 text-[14px] font-semibold text-amber-900 hover:underline"><FlaskConical size={14} aria-hidden="true" /> Clear test data</button>}
                  <button onClick={() => setEditing(w)} className="inline-flex items-center gap-1 text-[14px] font-semibold text-[#00709f] hover:underline"><Pencil size={14} aria-hidden="true" /> Edit</button>
                  <button onClick={() => void remove(w)} className="inline-flex items-center gap-1 text-[14px] font-semibold text-red-700 hover:underline"><Trash2 size={14} aria-hidden="true" /> Delete</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {editing && <WindowForm initial={editing === "new" ? null : editing} schools={schoolsLegacy ? undefined : schools ?? []} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await onChanged(); }} />}
    </div>
  );
}

function WindowForm({ initial, schools, onClose, onSaved }: { initial: RenewalWindowRow | null; schools?: WindowSchool[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [schoolYear, setSchoolYear] = useState(initial?.schoolYear ?? "");
  const [term, setTerm] = useState<string>(initial?.term ?? RENEWAL_TERMS[0]);
  const [opensOn, setOpensOn] = useState(initial?.opensOn ?? "");
  const [closesOn, setClosesOn] = useState(initial?.closesOn ?? "");
  const [lateAllowed, setLateAllowed] = useState(initial?.lateAllowed ?? true);
  const [note, setNote] = useState(initial?.note ?? "");
  const [testersOnly, setTestersOnly] = useState((initial?.testers.length ?? 0) > 0);
  // which schools: all, or only the ticked ones (schools === undefined means the database update has not been run, so the choice is not offered)
  const [onlySchools, setOnlySchools] = useState((initial?.schoolIds.length ?? 0) > 0);
  const [pickedSchools, setPickedSchools] = useState<Set<string>>(() => new Set(initial?.schoolIds ?? []));
  const realSchools = (schools ?? []).filter(s => s.schoolId !== null);
  const noSchoolCount = (schools ?? []).find(s => s.schoolId === null)?.scholars ?? 0;
  const pickedCount = realSchools.filter(s => pickedSchools.has(s.schoolId!)).length;
  const pickedScholars = realSchools.filter(s => pickedSchools.has(s.schoolId!)).reduce((n, s) => n + s.scholars, 0);
  const [chosen, setChosen] = useState<ScholarChoice[]>((initial?.testers ?? []).map(id => ({ scholarIdNumber: id, name: "", school: "", program: "", yearLevel: "", status: "" })));
  // the names of the scholars already chosen
  useEffect(() => {
    const ids = initial?.testers ?? [];
    if (ids.length === 0) return;
    let cancelled = false;
    void lookupScholars({ ids }).then(r => { if (!cancelled && r.ok) setChosen(prev => prev.map(c => r.rows.find(x => x.scholarIdNumber === c.scholarIdNumber) ?? c)); });
    return () => { cancelled = true; };
  }, [initial]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const basis = isValidSchoolYear(schoolYear) ? renewalBasis(schoolYear.trim(), term) : null;
  const input = "mt-1 w-full rounded-lg border border-[#062444]/25 px-3 py-2 text-[14px] font-normal outline-none focus:border-[#062444] bg-white";

  async function save() {
    setError("");
    if (!isValidSchoolYear(schoolYear)) { setError("The school year must look like 2026-2027."); return; }
    if (!opensOn || !closesOn) { setError("Please choose the opening and closing dates."); return; }
    const testers = chosen.map(c => c.scholarIdNumber);
    if (testersOnly && testers.length === 0) { setError("Choose at least one test scholar, or choose \"Everyone\"."); return; }
    if (schools && onlySchools && pickedCount === 0) { setError("Tick at least one school, or choose \"All schools\"."); return; }
    if (initial && initial.testers.length > 0 && !testersOnly && !window.confirm("This window is now TESTERS ONLY. Opening it to everyone makes it visible to every scholar, and every scholar who has not applied gets the \"Renewal is now open\" alert at the next 8:00-18:00 check. Continue?")) return;
    setBusy(true);
    // Only send the list when it matters, so the call also works before the Phase 8b SQL file is installed.
    const r = await saveRenewalWindow({ id: initial?.id ?? null, schoolYear, term, opensOn, closesOn, lateAllowed, note, ...(testersOnly ? { testers } : (initial?.testers.length ?? 0) > 0 ? { testers: [] } : {}),
      // the schools are sent only when they matter (so saving also works before the database update)
      ...(schools && onlySchools ? { schools: realSchools.filter(s => pickedSchools.has(s.schoolId!)).map(s => s.schoolId!) } : schools && (initial?.schoolIds.length ?? 0) > 0 ? { schools: [] } : {}) });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    await onSaved();
  }

  return (
    <ModalShell title={initial ? "Edit renewal window" : "Open a renewal window"} onClose={onClose} wide>
      <div className="space-y-3">
        <label className="block text-[14px] font-semibold text-[#062444]">School year (the year being renewed for)
          <input value={schoolYear} onChange={e => setSchoolYear(e.target.value)} disabled={!!initial} placeholder="e.g. 2026-2027" className={input} />
        </label>
        <label className="block text-[14px] font-semibold text-[#062444]">Term
          <select value={term} onChange={e => setTerm(e.target.value)} disabled={!!initial} className={input}>{RENEWAL_TERMS.map(t => <option key={t} value={t}>{t === "Summer" ? "Summer / Midyear" : t}</option>)}</select>
        </label>
        {basis && <p className="text-[13.5px] text-slate-700 rounded-lg bg-[#f7f9fc] border border-[#e6ecf5] px-3 py-2">Scholars' SDP and grades will be checked for <strong>{termLabelOf(basis.schoolYear, basis.term)}</strong>.</p>}
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-[14px] font-semibold text-[#062444]">Opens on<input type="date" value={opensOn} onChange={e => setOpensOn(e.target.value)} className={input} /></label>
          <label className="block text-[14px] font-semibold text-[#062444]">Closes on<input type="date" value={closesOn} onChange={e => setClosesOn(e.target.value)} className={input} /></label>
        </div>
        <label className="flex items-center gap-2 text-[14px] text-slate-800"><input type="checkbox" checked={lateAllowed} onChange={e => setLateAllowed(e.target.checked)} /> Allow late applications after the closing date (the evaluator accepts or declines each one)</label>
        <label className="block text-[14px] font-semibold text-[#062444]">Message for scholars (optional)<textarea value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={500} className={input} /></label>
        {schools && (
          <fieldset className="rounded-lg border border-[#e6ecf5] bg-[#f7f9fc] px-3 py-3">
            <legend className="px-1 text-[14px] font-bold text-[#062444]">Which schools can renew in this window</legend>
            <label className="flex items-start gap-2 text-[14px] text-slate-800"><input type="radio" name="window-schools" checked={!onlySchools} onChange={() => setOnlySchools(false)} className="mt-1" /> <span><strong>All schools</strong>: every scholar can renew in this window.</span></label>
            <label className="mt-2 flex items-start gap-2 text-[14px] text-slate-800"><input type="radio" name="window-schools" checked={onlySchools} onChange={() => setOnlySchools(true)} className="mt-1" /> <span><strong>Only the schools I tick</strong>: only the scholars enrolled in those schools can see this window, be told about it, apply and be counted in its lists.</span></label>
            {onlySchools && (
              <div className="mt-2">
                <div className="flex flex-wrap items-center gap-3 text-[14px]">
                  <button type="button" onClick={() => setPickedSchools(new Set(realSchools.map(s => s.schoolId!)))} className="font-semibold text-[#00709f] hover:underline">Tick all</button>
                  <button type="button" onClick={() => setPickedSchools(new Set())} className="font-semibold text-[#00709f] hover:underline">Clear</button>
                  <span className="text-slate-700">{pickedCount} school{pickedCount === 1 ? "" : "s"} ticked · about <strong>{pickedScholars}</strong> active scholar{pickedScholars === 1 ? "" : "s"}</span>
                </div>
                <ul className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-[#e6ecf5] bg-white divide-y divide-[#eef3fb]">
                  {realSchools.map(s => (
                    <li key={s.schoolId}>
                      <label className="flex items-center gap-2.5 px-3 py-2 text-[14px] text-slate-800 cursor-pointer hover:bg-[#f7f9fc]">
                        <input type="checkbox" checked={pickedSchools.has(s.schoolId!)} onChange={e => setPickedSchools(prev => { const next = new Set(prev); if (e.target.checked) next.add(s.schoolId!); else next.delete(s.schoolId!); return next; })} />
                        <span className="flex-1">{s.name}</span><span className="text-slate-600">{s.scholars} scholar{s.scholars === 1 ? "" : "s"}</span>
                      </label>
                    </li>
                  ))}
                </ul>
                {noSchoolCount > 0 && <p className="mt-2 text-[13.5px] text-amber-950 rounded-md bg-amber-50 border border-amber-300 px-2.5 py-1.5">{noSchoolCount} active scholar{noSchoolCount === 1 ? " has" : "s have"} no school set, so {noSchoolCount === 1 ? "this scholar cannot" : "they cannot"} be matched to a school and will not be included. Set their school in the Scholars tool first.</p>}
                <p className="mt-2 text-[13.5px] text-slate-700">A scholar who has already applied keeps their application even if their school is un-ticked later.</p>
              </div>
            )}
          </fieldset>
        )}
        <fieldset className="rounded-lg border border-[#e6ecf5] bg-[#f7f9fc] px-3 py-3">
          <legend className="px-1 text-[14px] font-bold text-[#062444]">Who can see this window</legend>
          <label className="flex items-start gap-2 text-[14px] text-slate-800"><input type="radio" name="window-audience" checked={!testersOnly} onChange={() => setTestersOnly(false)} className="mt-1" /> <span><strong>Everyone</strong> — every scholar sees it, gets the "Renewal is now open" alert and can apply.</span></label>
          <label className="mt-2 flex items-start gap-2 text-[14px] text-slate-800"><input type="radio" name="window-audience" checked={testersOnly} onChange={() => setTestersOnly(true)} className="mt-1" /> <span><strong>Testers only</strong> — only the scholars you choose below see it, get alerts, can apply, and are counted in the lists, the dashboard and the Excel file. Nobody else notices anything. Use it to test with test accounts.</span></label>
          {testersOnly && <TesterPicker chosen={chosen} onChange={setChosen} />}
        </fieldset>
        {error && <p role="alert" className="text-[14px] text-red-700">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} disabled={busy} className="rounded-lg border border-[#062444]/25 px-4 py-2 text-[14px] font-semibold text-[#062444]">Cancel</button>
          <button onClick={() => void save()} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-[#062444] px-4 py-2 text-[14px] font-bold text-white disabled:opacity-60">{busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />} Save window</button>
        </div>
      </div>
    </ModalShell>
  );
}

/** Picks the test scholars: search by name or ID, press "Add", and the chosen ones show as removable chips. Only the chosen scholars will see the window. */
function TesterPicker({ chosen, onChange }: { chosen: ScholarChoice[]; onChange: (next: ScholarChoice[]) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ScholarChoice[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ids = new Set(chosen.map(c => c.scholarIdNumber));

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); setError(""); return; }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setBusy(true);
      const r = await lookupScholars({ query });
      if (cancelled) return;
      setBusy(false);
      if (r.ok) { setResults(r.rows); setError(""); } else setError(r.error);
    }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query]);

  return (
    <div className="mt-2">
      <p className="text-[14px] font-semibold text-[#062444]">Chosen test scholars ({chosen.length})</p>
      {chosen.length === 0 ? <p className="text-[14px] text-slate-700">Nobody yet. Search below and press "Add".</p> : (
        <ul className="mt-1 flex flex-wrap gap-2">
          {chosen.map(c => (
            <li key={c.scholarIdNumber} className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 py-1 pl-3 pr-1.5 text-[14px] text-amber-950">
              <span><strong>{c.name || c.scholarIdNumber}</strong>{c.name ? ` · ${c.scholarIdNumber}` : ""}</span>
              <button type="button" onClick={() => onChange(chosen.filter(x => x.scholarIdNumber !== c.scholarIdNumber))} aria-label={`Remove ${c.name || c.scholarIdNumber}`} className="rounded-full p-1 hover:bg-amber-200"><X size={14} aria-hidden="true" /></button>
            </li>
          ))}
        </ul>
      )}
      <label className="mt-3 block text-[14px] font-semibold text-[#062444]">Find a scholar (name or ID, at least 2 letters)
        <input value={query} onChange={e => setQuery(e.target.value)} className="mt-1 w-full rounded-lg border border-[#062444]/25 px-3 py-2 text-[14px] font-normal outline-none focus:border-[#062444] bg-white" placeholder="e.g. Dela Cruz or 2108" />
      </label>
      {busy && <p className="mt-1 text-[14px] text-slate-700">Searching…</p>}
      {error && <p role="alert" className="mt-1 text-[14px] text-red-700">{error}</p>}
      {query.trim().length >= 2 && !busy && !error && results.length === 0 && <p className="mt-1 text-[14px] text-slate-700">No active scholar matches.</p>}
      {results.length > 0 && (
        <ul className="mt-2 max-h-56 divide-y divide-[#e6ecf5] overflow-y-auto rounded-lg border border-[#e6ecf5] bg-white">
          {results.map(r => (
            <li key={r.scholarIdNumber} className="flex items-center justify-between gap-3 px-3 py-2 text-[14px]">
              <span><strong className="text-[#062444]">{r.name}</strong> · {r.scholarIdNumber}<br /><span className="text-slate-700">{r.school} · {r.program} · {r.yearLevel}</span></span>
              {ids.has(r.scholarIdNumber)
                ? <span className="font-bold text-green-800">Added</span>
                : <button type="button" onClick={() => onChange([...chosen, r])} className="rounded-lg border border-[#062444]/40 px-3 py-1 font-bold text-[#062444] hover:bg-[#f7f9fc]">Add</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
