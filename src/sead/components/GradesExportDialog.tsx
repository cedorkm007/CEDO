import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Modal } from "./Modal";
import { exportGradesToExcel } from "../gradesExport";
import { fetchSchoolSetups, fetchSchoolSummaries, type SchoolSetup, type SchoolSummary } from "../scholarsMonitoringData";
import { ALL_PERIODS_KEY, periodKey, periodOptions, sortPeriods, type AcademicPeriod, type PeriodRef } from "@/lib/academicPeriods";

const SELECT_CLS = "w-full border border-[#062444]/15 rounded-lg px-2.5 py-2 text-[14px] outline-none focus:border-[#0088cc] bg-white";
const LABEL_CLS = "block text-[13px] font-semibold text-slate-600 mb-1";

/** "Export to Excel": completion, submission status and GWA by school, program and period. */
export function GradesExportDialog({ periods, current, viewKey, onClose }: {
  periods: AcademicPeriod[]; current: PeriodRef; viewKey: string; onClose: () => void;
}) {
  const [periodChoice, setPeriodChoice] = useState(viewKey);
  const [schoolId, setSchoolId] = useState("");
  const [schools, setSchools] = useState<SchoolSummary[]>([]);
  const [setups, setSetups] = useState<Map<string, SchoolSetup> | null>(null);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => {
    void fetchSchoolSummaries().then(setSchools);
    void fetchSchoolSetups().then(setSetups);
  }, []);

  const options = useMemo(() => periodOptions(periods, current, { includeAll: true, withStatus: true }), [periods, current]);

  async function run() {
    if (!setups) return;
    setWorking(true); setError(""); setDone(""); setProgress("Starting…");
    const chosen = periodChoice === ALL_PERIODS_KEY ? sortPeriods(periods) : periods.filter(p => periodKey(p.schoolYear, p.term) === periodChoice);
    const result = await exportGradesToExcel({ filters: { schoolId }, periods: chosen, setups, onProgress: setProgress });
    setWorking(false); setProgress("");
    if (!result.ok) { setError(result.error); return; }
    setDone(`Saved ${result.fileName} — ${result.scholars.toLocaleString()} scholars, ${result.periods} period${result.periods === 1 ? "" : "s"}.${result.capped ? " The scholar list was cut at its limit; export one school at a time to get everyone." : ""}`);
  }

  return (
    <Modal title="Export to Excel" onClose={working ? () => {} : onClose}>
      <p className="text-[14px] text-slate-700 mb-4">
        Creates a spreadsheet with three sheets: <strong>By school</strong> and <strong>By program</strong> (completion, submission status, average GWA and scholarship standing) and <strong>Scholars</strong> (each scholar's GWA and standing).
      </p>
      <div className="space-y-3 mb-4">
        <div>
          <label htmlFor="exp-period" className={LABEL_CLS}>Period</label>
          <select id="exp-period" value={periodChoice} onChange={e => setPeriodChoice(e.target.value)} disabled={working} className={SELECT_CLS}>
            {options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="exp-school" className={LABEL_CLS}>School</label>
          <select id="exp-school" value={schoolId} onChange={e => setSchoolId(e.target.value)} disabled={working} className={SELECT_CLS}>
            <option value="">All schools</option>
            {schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>
      {periodChoice === ALL_PERIODS_KEY && schoolId === "" && (
        <p className="text-[13.5px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">All schools across all periods reads a lot of grades and can take a few minutes. Keep this window open until the file downloads.</p>
      )}
      {progress && <p role="status" className="text-[14px] text-slate-700 mb-3">{progress}</p>}
      {error && <p role="alert" className="text-[14px] text-red-700 mb-3">Couldn't export: {error}</p>}
      {done && <p role="status" className="text-[14px] text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-3">{done}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} disabled={working} className="px-4 py-2 rounded-lg border border-[#062444]/20 text-[14px] font-semibold text-[#062444] disabled:opacity-60">{done ? "Close" : "Cancel"}</button>
        <button onClick={() => void run()} disabled={working || !setups || options.length === 0}
          className="flex items-center gap-1.5 bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-60 text-white text-[14px] font-semibold rounded-lg px-4 py-2">
          <Download size={15} aria-hidden="true" /> {working ? "Exporting…" : "Download Excel file"}
        </button>
      </div>
    </Modal>
  );
}
