import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Search } from "lucide-react";
import { ACADEMIC_STATUS_LABEL, PASSING_GWA_EXPLANATION, describeScale, formatPassingGwa, parsePassingGwa, passingGwaProblem, type AcademicStatus, type GwaScale } from "@/lib/academicStatus";
import { fetchAcademicSettings, forgetAcademicStatusMap, saveAcademicPassingGwa, saveAcademicProgram, type AcademicProgramRow, type AcademicSchoolRow, type AcademicSettings } from "../academicStatusApi";

type Filter = "all" | "not_set" | "academic" | "non_academic";
const FILTERS: { key: Filter; label: string }[] = [{ key: "all", label: "All programs" }, { key: "not_set", label: "Not set yet" }, { key: "academic", label: "Academic" }, { key: "non_academic", label: "Non-academic" }];

/** One program row of the chosen school: its academic status and, for a special program, its own passing GWA (on the school's scale). Saved with its own button. */
function ProgramRow({ schoolId, scale, p, onSaved }: { schoolId: string; scale: GwaScale | null; p: AcademicProgramRow; onSaved: () => void }) {
  const [status, setStatus] = useState<AcademicStatus | "">(p.status ?? "");
  const [special, setSpecial] = useState(p.specialPassingGwa != null);
  const [gwa, setGwa] = useState(p.specialPassingGwa != null ? p.specialPassingGwa.toFixed(2) : "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { setStatus(p.status ?? ""); setSpecial(p.specialPassingGwa != null); setGwa(p.specialPassingGwa != null ? p.specialPassingGwa.toFixed(2) : ""); }, [p.status, p.specialPassingGwa]);
  const problem = status !== "" && special ? (scale ? passingGwaProblem(gwa, false, scale) : "This school has no grading setup yet, so a program of it cannot have its own passing GWA.") : null;
  const changed = (status || null) !== p.status || (status !== "" && special ? parsePassingGwa(gwa) : null) !== p.specialPassingGwa;
  async function save() {
    setBusy(true); setMsg(null);
    const r = await saveAcademicProgram(schoolId, p.program, status === "" ? null : status, status !== "" && special ? parsePassingGwa(gwa) : null);
    setBusy(false);
    if (r.ok) { forgetAcademicStatusMap(); setMsg({ ok: true, text: "Saved" }); onSaved(); } else setMsg({ ok: false, text: r.error });
  }
  return (
    <tr className={`border-t border-[#eef3fb] align-top ${p.status ? "" : "bg-amber-50/60"}`}>
      <td className="px-3 py-2.5 font-semibold text-slate-900">{p.program}{!p.status && <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-amber-400 bg-amber-50 px-2 py-0.5 text-[12.5px] font-bold text-amber-900"><AlertTriangle size={12} aria-hidden="true" /> Not set (counts as Academic)</span>}</td>
      <td className="px-3 py-2.5 text-slate-800">{p.scholars}</td>
      <td className="px-3 py-2.5">
        <select value={status} onChange={e => setStatus(e.target.value as AcademicStatus | "")} aria-label={`Academic status of ${p.program}`} className="rounded-lg border border-[#062444]/25 bg-white px-2.5 py-1.5 text-[14px]">
          <option value="">Not set</option>
          <option value="academic">{ACADEMIC_STATUS_LABEL.academic}</option>
          <option value="non_academic">{ACADEMIC_STATUS_LABEL.non_academic}</option>
        </select>
      </td>
      <td className="px-3 py-2.5">
        <label className="flex items-center gap-2 text-[14px] text-slate-800">
          <input type="checkbox" checked={special} disabled={status === ""} onChange={e => setSpecial(e.target.checked)} aria-label={`${p.program} has its own passing GWA`} />
          Special program (its own passing GWA)
        </label>
        {special && status !== "" && (
          <div className="mt-1.5">
            <input value={gwa} onChange={e => setGwa(e.target.value.replace(/[^0-9.,]/g, "").slice(0, 6))} inputMode="decimal" placeholder={scale ? ((scale.min + scale.max) / 2).toFixed(2) : ""} aria-label={`Passing GWA of ${p.program}`} className="w-24 rounded-lg border border-[#062444]/25 bg-white px-2.5 py-1.5 text-[14px]" />
            {problem && <p role="status" className="mt-1 text-[13.5px] text-amber-900">{problem}</p>}
          </div>
        )}
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        <button onClick={() => void save()} disabled={busy || !changed || !!problem} className="inline-flex items-center gap-1.5 rounded-lg bg-[#062444] px-3 py-1.5 text-[13.5px] font-bold text-white hover:bg-[#0a3a6e] disabled:opacity-40">
          {busy && <Loader2 size={13} className="animate-spin" aria-hidden="true" />} Save
        </button>
        {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-1 text-[13.5px] ${msg.ok ? "text-green-800" : "text-red-700"}`}>{msg.text}</p>}
      </td>
    </tr>
  );
}

/**
 * Scholar Management Tools > Scholars > "Grades and Academic Management". The staff CHOOSE A SCHOOL; for that school they set the passing GWA of Academic and Non-academic programs
 * (on the school's own scale), and the list shows only the programs of that school's scholars, each placed under Academic or Non-academic (a special program has its own passing GWA).
 * The renewal uses it: a scholar whose GWA is worse than the passing GWA of their school's group needs to book a consultation. The database checks who may save (the Scholar Management tag) on every save.
 */
export function ScholarsGradesAcademicSubtab() {
  const [settings, setSettings] = useState<AcademicSettings | null>(null);
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [loadingSchool, setLoadingSchool] = useState(false);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  const [ac, setAc] = useState("");
  const [nonAc, setNonAc] = useState("");
  const [gwaMsg, setGwaMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [schoolQuery, setSchoolQuery] = useState("");
  const latest = useRef(0);

  const load = useCallback(async (id: string | null) => {
    const mine = ++latest.current;
    const r = await fetchAcademicSettings(id);
    if (mine !== latest.current) return;           // a newer choice of school came in meanwhile
    setLoadingSchool(false);
    if (!r.ok) { if (r.missing) setMissing(true); else setError(r.error); return; }
    setError(""); setSettings(r.settings); setSchoolId(r.settings.schoolId);
  }, []);
  useEffect(() => { void load(null); }, [load]);
  const school: AcademicSchoolRow | undefined = settings?.schools.find(s => s.id === schoolId);
  useEffect(() => { setAc(school?.academicPassingGwa != null ? school.academicPassingGwa.toFixed(2) : ""); setNonAc(school?.nonAcademicPassingGwa != null ? school.nonAcademicPassingGwa.toFixed(2) : ""); setGwaMsg(null); }, [school?.id, school?.academicPassingGwa, school?.nonAcademicPassingGwa]);   // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => (settings?.programs ?? []).filter(p =>
    (filter === "all" || (filter === "not_set" ? p.status === null : p.status === filter)) && (!query.trim() || p.program.toLowerCase().includes(query.trim().toLowerCase()))), [settings, filter, query]);
  const notSet = settings?.programs.filter(p => p.status === null).length ?? 0;
  const schoolOptions = useMemo(() => (settings?.schools ?? []).filter(s => !schoolQuery.trim() || s.id === schoolId || s.name.toLowerCase().includes(schoolQuery.trim().toLowerCase())), [settings, schoolQuery, schoolId]);

  if (missing) return <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[14px] text-amber-950">This tab needs the latest database update (supabase_migration_academic_per_school.sql). Ask the IT admin to run it.</p>;
  if (error) return <p role="alert" className="text-[14px] text-red-700">{error}</p>;
  if (!settings) return <p className="text-[14px] text-slate-700 flex items-center gap-2"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…</p>;
  if (settings.schools.length === 0) return <p className="text-[14px] text-slate-700">No school has scholars yet.</p>;

  const scale = school?.scale ?? null;
  const acProblem = scale ? passingGwaProblem(ac, true, scale) : null, nonProblem = scale ? passingGwaProblem(nonAc, true, scale) : null;
  function pickSchool(id: string) {
    setSchoolId(id); setLoadingSchool(true); setFilter("all"); setQuery(""); setGwaMsg(null);
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
      <section className="rounded-xl border border-[#e6ecf5] bg-white px-4 py-4" aria-label="School">
        <h2 className="text-[16px] font-bold text-[#062444]">School</h2>
        <p className="mt-1 text-[14px] text-slate-700">Choose the school first. Its passing GWA and the academic status of its programs are set below, for that school only.</p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-[14px] font-semibold text-[#062444]">Find a school
            <input value={schoolQuery} onChange={e => setSchoolQuery(e.target.value)} placeholder="Type part of the name" className="mt-1 block w-56 rounded-lg border border-[#062444]/25 bg-white px-3 py-2 text-[14px] font-normal" />
          </label>
          <label className="text-[14px] font-semibold text-[#062444]">School
            <select value={schoolId ?? ""} onChange={e => pickSchool(e.target.value)} className="mt-1 block max-w-[28rem] rounded-lg border border-[#062444]/25 bg-white px-3 py-2 text-[14px] font-normal">
              {schoolOptions.map(s => <option key={s.id} value={s.id}>{s.name} · {s.scholars} scholar{s.scholars === 1 ? "" : "s"}{s.notSet > 0 ? ` · ${s.notSet} not placed` : ""}</option>)}
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

      <section aria-label="Programs">
        <h2 className="text-[16px] font-bold text-[#062444]">Programs{school ? ` of ${school.name}` : ""}</h2>
        <p className="mt-1 text-[14px] text-slate-700">Only the programs of this school's scholars are listed. Place every program under Academic or Non-academic. A program that is not placed yet counts as Academic in the renewal until you place it{notSet > 0 ? `: ${notSet} program${notSet === 1 ? " is" : "s are"} not placed yet.` : "."}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Show programs">
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)} aria-pressed={filter === f.key} className={`rounded-full border px-3 py-1.5 text-[14px] font-semibold ${filter === f.key ? "border-[#062444] bg-[#062444] text-white" : "border-[#062444]/25 bg-white text-[#062444] hover:bg-[#f7f9fc]"}`}>
              {f.label}{f.key === "not_set" ? ` (${notSet})` : ""}
            </button>
          ))}
          <div className="relative ml-auto max-w-xs">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" aria-hidden="true" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search a program" aria-label="Search a program" className="w-full rounded-lg border border-[#062444]/25 bg-white py-2 pl-9 pr-3 text-[14px]" />
          </div>
        </div>
        <div className="mt-3 overflow-x-auto rounded-xl border border-[#e6ecf5] bg-white">
          <table className="w-full min-w-[760px] text-left text-[14px]">
            <caption className="sr-only">Programs of the scholars of the chosen school and their academic status</caption>
            <thead className="bg-[#f7f9fc] text-[#062444]"><tr>{["Program", "Scholars", "Academic status", "Passing GWA", ""].map((h, i) => <th key={i} scope="col" className="px-3 py-2.5 font-bold align-bottom">{h}</th>)}</tr></thead>
            <tbody>
              {loadingSchool ? <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-700"><Loader2 size={15} className="mr-2 inline animate-spin" aria-hidden="true" />Loading the programs…</td></tr>
                : shown.length === 0 ? <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-700">{(settings.programs.length === 0) ? "This school's scholars have no program yet." : "No program matches."}</td></tr>
                : shown.map(p => <ProgramRow key={`${school?.id}:${p.key}`} schoolId={school?.id ?? ""} scale={scale} p={p} onSaved={() => void load(school?.id ?? null)} />)}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
