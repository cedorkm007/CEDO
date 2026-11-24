import { useEffect, useState } from "react";
import { AlertTriangle, Download, Loader2 } from "lucide-react";
import { NOT_SET_LIST_HEADERS, fetchNotSetList, fetchNotSetSummary, type NotSetSchool } from "../academicNotSetApi";
import { downloadTable } from "../creditedExport";

const BTN = "inline-flex items-center gap-1.5 rounded-lg border border-[#062444]/30 bg-white px-3 py-1.5 text-[13.5px] font-semibold text-[#062444] hover:bg-[#f7f9fc] disabled:opacity-40";
const SQL = "supabase_migration_academic_scholar_status.sql";
const n = (v: number) => v.toLocaleString("en-US");
const fileName = (school: string) => `No-academic-status_${school.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "all"}_${new Date().toISOString().slice(0, 10)}.xlsx`;

/**
 * Grades and Academic Management > the warning "N scholars have no academic status". A scholar with no status is checked as Academic in the renewal (as before) but is flagged here.
 * The count is split in two: schools WITH a passing GWA (the status changes the result of the renewal: these matter) and schools WITHOUT one (the GWA rule is off there). Each can be downloaded as a list.
 */
export function AcademicNotSetPanel() {
  const [schools, setSchools] = useState<NotSetSchool[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchNotSetSummary().then(r => { if (!alive) return; if (r.ok) setSchools(r.schools); else setError(r.missing ? `This needs the latest database update (${SQL}). Ask the IT admin to run it.` : r.error); });
    return () => { alive = false; };
  }, []);
  async function download(key: string, schoolId: string | null, label: string) {
    setBusy(key); setError("");
    const r = await fetchNotSetList(schoolId);
    setBusy(null);
    if (!r.ok) { setError(r.error); return; }
    await downloadTable([NOT_SET_LIST_HEADERS, ...r.rows], fileName(label), "xlsx", [18, 30, 34, 28, 12, 18, 24], "No academic status");
  }
  if (error) return <p role="alert" className="text-[14px] text-red-700">{error}</p>;
  if (!schools) return <p className="flex items-center gap-2 text-[14px] text-slate-700"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…</p>;
  const withRule = schools.filter(s => s.ruleOn && s.notSet > 0), noRule = schools.filter(s => !s.ruleOn && s.notSet > 0);
  const matters = withRule.reduce((a, s) => a + s.notSet, 0), off = noRule.reduce((a, s) => a + s.notSet, 0);
  if (matters + off === 0) return <p role="status" className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-[14px] text-green-900">Every scholar has an academic status.</p>;
  return (
    <section className="rounded-xl border border-amber-300 bg-amber-50/60 px-4 py-4" aria-label="Scholars with no academic status">
      <h2 className="flex items-center gap-2 text-[16px] font-bold text-amber-950"><AlertTriangle size={16} aria-hidden="true" /> {n(matters + off)} scholar{matters + off === 1 ? " has" : "s have"} no academic status</h2>
      <p className="mt-1 text-[14px] text-slate-800">A scholar with no status is checked as <strong>Academic</strong> in the renewal, as before. The status belongs to the scholar, so it has to be set for each scholar.</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-[14px] text-slate-800">
        <li><strong>{n(matters)}</strong> {matters === 1 ? "is" : "are"} in schools with a passing GWA set: for them the status <strong>changes the result</strong> of the renewal (the Academic and Non-academic numbers differ).</li>
        <li><strong>{n(off)}</strong> {off === 1 ? "is" : "are"} in schools with no passing GWA set: the GWA rule is <strong>off</strong> there for now, so the status changes nothing until a passing GWA is set.</li>
      </ul>
      <div className="mt-3 overflow-x-auto rounded-xl border border-[#e6ecf5] bg-white">
        <table className="w-full min-w-[640px] text-left text-[14px]">
          <caption className="sr-only">Scholars with no academic status, per school</caption>
          <thead className="bg-[#f7f9fc] text-[#062444]"><tr>{["School", "Scholars", "No status", "GWA rule", ""].map((h, i) => <th key={i} scope="col" className="px-3 py-2 font-bold">{h}</th>)}</tr></thead>
          <tbody>
            {[...withRule, ...noRule].map(s => (
              <tr key={s.schoolId ?? s.school} className="border-t border-[#eef3fb]">
                <td className="px-3 py-2 font-semibold text-slate-900">{s.school}</td>
                <td className="px-3 py-2">{n(s.scholars)}</td>
                <td className="px-3 py-2 font-semibold">{n(s.notSet)}</td>
                <td className="px-3 py-2">{s.ruleOn ? "On" : "Off (no passing GWA)"}</td>
                <td className="px-3 py-2"><button type="button" className={BTN} disabled={busy !== null} onClick={() => void download(s.schoolId ?? s.school, s.schoolId, s.school)}>{busy === (s.schoolId ?? s.school) ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} List</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3"><button type="button" className={BTN} disabled={busy !== null} onClick={() => void download("all", null, "all schools")}>{busy === "all" ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Download the list of all {n(matters + off)}</button></div>
    </section>
  );
}
