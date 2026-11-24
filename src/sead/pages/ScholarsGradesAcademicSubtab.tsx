import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { PASSING_GWA_EXPLANATION, describeScale, formatPassingGwa, parsePassingGwa, passingGwaProblem } from "@/lib/academicStatus";
import { AcademicBulkPanel } from "../components/AcademicBulkPanel";
import { AcademicNotSetPanel } from "../components/AcademicNotSetPanel";
import { fetchAcademicSettings, saveAcademicPassingGwa, type AcademicSchoolRow, type AcademicSettings } from "../academicStatusApi";

/**
 * Scholar Management Tools > Scholars > "Grades and Academic Management". The staff CHOOSE A SCHOOL; for that school they set the passing GWA of Academic and Non-academic programs
 * (on the school's own scale), and the list shows only the programs of that school's scholars, each placed under Academic or Non-academic (a special program has its own passing GWA).
 * The renewal uses it: a scholar whose GWA is worse than the passing GWA of their school's group needs to book a consultation. The database checks who may save (the Scholar Management tag) on every save.
 */
export function ScholarsGradesAcademicSubtab() {
  const [settings, setSettings] = useState<AcademicSettings | null>(null);
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  const [ac, setAc] = useState("");
  const [nonAc, setNonAc] = useState("");
  const [gwaMsg, setGwaMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [schoolQuery, setSchoolQuery] = useState("");
  const latest = useRef(0);

  const load = useCallback(async (id: string | null) => {
    const mine = ++latest.current;
    const r = await fetchAcademicSettings(id);
    if (mine !== latest.current) return;           // a newer choice of school came in meanwhile
    if (!r.ok) { if (r.missing) setMissing(true); else setError(r.error); return; }
    setError(""); setSettings(r.settings); setSchoolId(r.settings.schoolId);
  }, []);
  useEffect(() => { void load(null); }, [load]);
  const school: AcademicSchoolRow | undefined = settings?.schools.find(s => s.id === schoolId);
  useEffect(() => { setAc(school?.academicPassingGwa != null ? school.academicPassingGwa.toFixed(2) : ""); setNonAc(school?.nonAcademicPassingGwa != null ? school.nonAcademicPassingGwa.toFixed(2) : ""); setGwaMsg(null); }, [school?.id, school?.academicPassingGwa, school?.nonAcademicPassingGwa]);   // eslint-disable-line react-hooks/exhaustive-deps

  const schoolOptions = useMemo(() => (settings?.schools ?? []).filter(s => !schoolQuery.trim() || s.id === schoolId || s.name.toLowerCase().includes(schoolQuery.trim().toLowerCase())), [settings, schoolQuery, schoolId]);

  if (missing) return <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[14px] text-amber-950">This tab needs the latest database update (supabase_migration_academic_per_school.sql). Ask the IT admin to run it.</p>;
  if (error) return <p role="alert" className="text-[14px] text-red-700">{error}</p>;
  if (!settings) return <p className="text-[14px] text-slate-700 flex items-center gap-2"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…</p>;
  if (settings.schools.length === 0) return <p className="text-[14px] text-slate-700">No school has scholars yet.</p>;

  const scale = school?.scale ?? null;
  const acProblem = scale ? passingGwaProblem(ac, true, scale) : null, nonProblem = scale ? passingGwaProblem(nonAc, true, scale) : null;
  function pickSchool(id: string) {
    setSchoolId(id); setGwaMsg(null);
    void load(id);
  }
  async function saveGwa() {
    if (!school) return;
    setBusy(true); setGwaMsg(null);
    const r = await saveAcademicPassingGwa(school.id, parsePassingGwa(ac), parsePassingGwa(nonAc));
    setBusy(false);
    if (r.ok) { setGwaMsg({ ok: true, text: "Saved. The open renewals are checked again in the background within a few minutes." }); await load(school.id); } else setGwaMsg({ ok: false, text: r.error });
  }

  return (
    <div className="space-y-6">
      <AcademicNotSetPanel />
      <section className="rounded-xl border border-[#e6ecf5] bg-white px-4 py-4" aria-label="School">
        <h2 className="text-[16px] font-bold text-[#062444]">School</h2>
        <p className="mt-1 text-[14px] text-slate-700">Choose the school first. Its passing GWA and the academic status of its programs are set below, for that school only.</p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-[14px] font-semibold text-[#062444]">Find a school
            <input value={schoolQuery} onChange={e => setSchoolQuery(e.target.value)} placeholder="Type part of the name" className="mt-1 block w-56 rounded-lg border border-[#062444]/25 bg-white px-3 py-2 text-[14px] font-normal" />
          </label>
          <label className="text-[14px] font-semibold text-[#062444]">School
            <select value={schoolId ?? ""} onChange={e => pickSchool(e.target.value)} className="mt-1 block max-w-[28rem] rounded-lg border border-[#062444]/25 bg-white px-3 py-2 text-[14px] font-normal">
              {schoolOptions.map(s => <option key={s.id} value={s.id}>{s.name} · {s.scholars} scholar{s.scholars === 1 ? "" : "s"}</option>)}
            </select>
          </label>
        </div>
        {school && (scale
          ? <p className="mt-3 text-[14px] text-slate-800">Grades of {school.name} are on a scale of <strong>{describeScale(scale)}</strong>{school.scaleKind === "percent" ? " (the percent, as its GWA uses percentages)" : ""}. A passing GWA is a number on that scale.</p>
          : <p role="status" className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[14px] text-amber-950">{school.name} has no grading setup yet (its scale), so its passing GWA cannot be set and the GWA rule is not applied to its scholars (the rule of the failed subjects still is). Set the school's grading in Scholars' Grades Monitoring. You can still place its programs below.</p>)}
      </section>

      {school && (
        <section className="rounded-xl border border-[#e6ecf5] bg-white px-4 py-4" aria-label="Passing GWA">
          <h2 className="text-[16px] font-bold text-[#062444]">Passing GWA of {school.name}</h2>
          <p className="mt-1 text-[14px] text-slate-700">{PASSING_GWA_EXPLANATION}</p>
          <div className="mt-3 flex flex-wrap items-end gap-4">
            <label className="text-[14px] font-semibold text-[#062444]">Academic programs
              <input value={ac} disabled={!scale} onChange={e => setAc(e.target.value.replace(/[^0-9.,]/g, "").slice(0, 6))} inputMode="decimal" placeholder="not set" className="mt-1 block w-28 rounded-lg border border-[#062444]/25 bg-white px-3 py-2 text-[14px] font-normal disabled:bg-slate-100" />
            </label>
            <label className="text-[14px] font-semibold text-[#062444]">Non-academic programs
              <input value={nonAc} disabled={!scale} onChange={e => setNonAc(e.target.value.replace(/[^0-9.,]/g, "").slice(0, 6))} inputMode="decimal" placeholder="not set" className="mt-1 block w-28 rounded-lg border border-[#062444]/25 bg-white px-3 py-2 text-[14px] font-normal disabled:bg-slate-100" />
            </label>
            <button onClick={() => void saveGwa()} disabled={busy || !scale || !!acProblem || !!nonProblem} className="inline-flex items-center gap-1.5 rounded-lg bg-[#062444] px-4 py-2 text-[14px] font-bold text-white hover:bg-[#0a3a6e] disabled:opacity-40">
              {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />} Save passing GWA
            </button>
          </div>
          {(acProblem || nonProblem) && <p role="status" className="mt-2 text-[14px] text-amber-900">{acProblem ?? nonProblem}</p>}
          {gwaMsg && <p role={gwaMsg.ok ? "status" : "alert"} className={`mt-2 text-[14px] ${gwaMsg.ok ? "text-green-800" : "text-red-700"}`}>{gwaMsg.ok && <CheckCircle2 size={14} className="mr-1 inline" aria-hidden="true" />}{gwaMsg.text}</p>}
          <p className="mt-2 text-[13.5px] text-slate-600">Now: Academic {formatPassingGwa(school.academicPassingGwa)} · Non-academic {formatPassingGwa(school.nonAcademicPassingGwa)}. A special program has its own passing GWA (higher or lower): tick it in the table below.</p>
        </section>
      )}

      <section className="rounded-xl border border-[#e6ecf5] bg-white px-4 py-4" aria-label="Academic status of the scholars">
        <h2 className="text-[16px] font-bold text-[#062444]">Academic status of the scholars</h2>
        <p className="mt-1 text-[14px] text-slate-700">The academic status (Academic or Non-academic) now belongs to <strong>each scholar</strong>, not to the program: the renewal uses the scholar's status and the passing GWA of the scholar's school for it. Programs no longer decide anything (what was set for them has been moved to the scholars). Set a scholar's status with the file below; the new screen to set it for a whole school is the next step.</p>
      </section>

      <AcademicBulkPanel />
    </div>
  );
}
