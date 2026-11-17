import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Download, Loader2 } from "lucide-react";
import { ModalShell } from "../components/SeadUiShell";
import { fetchEnrollmentExportRows, fetchEnrollmentSummary, type EnrollmentSummary } from "../renewalEnrollmentApi";
import {
  buildEndorsementXlsx, defaultBatchLabel, DEFAULT_CHECKED_BY, DEFAULT_PREPARED_BY, endorsementFileName, isDay, manilaToday, rangeLabel, type Signatory,
} from "@/lib/renewalEnrollment";
import { termLabelOf } from "@/lib/renewal";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const addDays = (day: string, n: number): string => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const INPUT = "mt-1 block w-full rounded-lg border border-[#062444]/25 bg-white px-3 py-2 text-[14px] font-normal";

function SignatoryFields({ legend, value, onChange }: { legend: string; value: Signatory; onChange: (s: Signatory) => void }) {
  return (
    <fieldset className="rounded-lg border border-[#e6ecf5] px-3 pb-3 pt-1">
      <legend className="px-1 text-[13.5px] font-semibold text-[#062444]">{legend}</legend>
      <label className="mt-1 block text-[13.5px] font-semibold text-slate-800">Name<input value={value.name} onChange={e => onChange({ ...value, name: e.target.value })} className={INPUT} /></label>
      <label className="mt-2 block text-[13.5px] font-semibold text-slate-800">Position<input value={value.title} onChange={e => onChange({ ...value, title: e.target.value })} className={INPUT} /></label>
      <label className="mt-2 block text-[13.5px] font-semibold text-slate-800">Office<input value={value.unit} onChange={e => onChange({ ...value, unit: e.target.value })} className={INPUT} /></label>
    </fieldset>
  );
}

/**
 * Scholar Renewal > Renewed > "Export confirmed enrolled". The staff choose the dates the scholars were RENEWED (from – to); the file lists the scholars in those dates whose Enrollment confirmation
 * box is ticked, laid out like the office's allowance endorsement sheet. The database decides who is listed and records the export in the export log.
 */
export function RenewalEnrollmentExportDialog({ schoolYear, term, onClose }: { schoolYear: string; term: string; onClose: () => void }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [ready, setReady] = useState(false);              // the first/last renewal day were looked up and filled in
  const [summary, setSummary] = useState<EnrollmentSummary | null>(null);
  const [termInfo, setTermInfo] = useState<EnrollmentSummary | null>(null);
  const [batch, setBatch] = useState("");
  const [prepared, setPrepared] = useState<Signatory>(DEFAULT_PREPARED_BY);
  const [checked, setChecked] = useState<Signatory>(DEFAULT_CHECKED_BY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  const [done, setDone] = useState("");

  // the dates start at the first and the last day a scholar was renewed in this term
  useEffect(() => {
    let off = false;
    void fetchEnrollmentSummary(schoolYear, term, "", "").then(r => {
      if (off) return;
      if (!r.ok) { if (r.missing) setMissing(true); else setError(r.error); return; }
      setTermInfo(r.summary);
      const today = manilaToday();
      setFrom(r.summary.firstRenewed ?? today); setTo(r.summary.lastRenewed ?? today); setReady(true);
    });
    return () => { off = true; };
  }, [schoolYear, term]);

  const problem = !isDay(from) || !isDay(to) ? "Choose the first and the last day." : from > to ? "The first day cannot be after the last day." : "";
  // the numbers follow the dates
  useEffect(() => {
    if (!ready || problem) { setSummary(null); return; }
    let off = false;
    setSummary(null);
    void fetchEnrollmentSummary(schoolYear, term, from, to).then(r => { if (!off && r.ok) setSummary(r.summary); });
    return () => { off = true; };
  }, [ready, problem, from, to, schoolYear, term]);

  const label = batch.trim() || defaultBatchLabel(term, schoolYear, from, to);
  const today = manilaToday();
  const presets = useMemo(() => ([
    { key: "today", text: "Today", from: today, to: today },
    { key: "week", text: "Last 7 days", from: addDays(today, -6), to: today },
    ...(termInfo?.firstRenewed && termInfo.lastRenewed ? [{ key: "all", text: "Everyone renewed", from: termInfo.firstRenewed, to: termInfo.lastRenewed }] : []),
  ]), [today, termInfo]);

  async function download() {
    setBusy(true); setError(""); setDone("");
    const r = await fetchEnrollmentExportRows(schoolYear, term, from, to);
    if (!r.ok) { setBusy(false); setError(r.error); return; }
    if (r.rows.length === 0) { setBusy(false); setError("Nobody is confirmed enrolled in these dates."); return; }
    const bytes = await buildEndorsementXlsx(r.rows, { batchLabel: label, preparedBy: prepared, checkedBy: checked });
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: XLSX_MIME }));
    const a = document.createElement("a");
    a.href = url; a.download = endorsementFileName(term, schoolYear, from, to);
    document.body.appendChild(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setBusy(false);
    setDone(`Downloaded: ${r.rows.length} scholar${r.rows.length === 1 ? "" : "s"}. This export was recorded in the export log.`);
  }

  return (
    <ModalShell title="Export confirmed enrolled" onClose={onClose} wide>
      {missing ? (
        <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[14px] text-amber-950">This needs the latest database update (supabase_migration_renewal_enrollment_confirmation.sql). Ask the IT admin to run it.</p>
      ) : (
        <>
          <p className="text-[14px] text-slate-800">The scholars of {termLabelOf(schoolYear, term)} whose <strong>Enrollment confirmation</strong> box is ticked, and who were <strong>renewed</strong> in the dates below, as an allowance endorsement sheet (Excel).</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-[14px] font-semibold text-[#062444]">Renewed from<input type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} className={INPUT} disabled={!ready} /></label>
            <label className="text-[14px] font-semibold text-[#062444]">Renewed until<input type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} className={INPUT} disabled={!ready} /></label>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Quick dates">
            {presets.map(p => <button key={p.key} type="button" onClick={() => { setFrom(p.from); setTo(p.to); }} className="rounded-full border border-[#062444]/25 bg-white px-3 py-1 text-[13.5px] font-semibold text-[#062444] hover:bg-[#f7f9fc]">{p.text}</button>)}
          </div>
          {problem && ready && <p role="status" className="text-[14px] text-amber-900">{problem}</p>}
          <div className="rounded-lg bg-[#f7f9fc] px-3 py-2 text-[14px] text-slate-900" aria-live="polite">
            {!ready ? <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Looking up the dates…</span>
              : problem ? "—"
              : !summary ? <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Counting…</span>
              : <><strong>{summary.confirmedInRange.toLocaleString()}</strong> confirmed enrolled will be in the file ({summary.renewedInRange.toLocaleString()} scholar{summary.renewedInRange === 1 ? "" : "s"} renewed {rangeLabel(from, to).toLowerCase()}; {(summary.renewedInRange - summary.confirmedInRange).toLocaleString()} not ticked yet).</>}
          </div>
          <label className="block text-[14px] font-semibold text-[#062444]">Line under the title (optional)
            <input value={batch} onChange={e => setBatch(e.target.value)} placeholder={defaultBatchLabel(term, schoolYear, from, to)} className={INPUT} />
            <span className="mt-1 block text-[13px] font-normal text-slate-700">For example “3RD BATCH-OCTOBER 25, 2026”. Left empty, it says the term and the dates.</span>
          </label>
          <details className="rounded-lg border border-[#e6ecf5] px-3 py-2">
            <summary className="cursor-pointer text-[14px] font-semibold text-[#062444]">Names under the sheet (Prepared by / Checked by)</summary>
            <div className="mt-2 space-y-3">
              <SignatoryFields legend="Prepared by" value={prepared} onChange={setPrepared} />
              <SignatoryFields legend="Checked by" value={checked} onChange={setChecked} />
            </div>
          </details>
          {error && <p role="alert" className="text-[14px] text-red-700">{error}</p>}
          {done && <p role="status" className="flex items-start gap-1.5 text-[14px] text-green-800"><CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden="true" />{done}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-lg border border-[#062444]/25 bg-white px-4 py-2 text-[14px] font-semibold text-[#062444] hover:bg-[#f7f9fc]">Close</button>
            <button type="button" onClick={() => void download()} disabled={busy || !ready || !!problem || !summary || summary.confirmedInRange === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#062444] px-4 py-2 text-[14px] font-bold text-white hover:bg-[#0a3a6e] disabled:opacity-40">
              {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Download size={15} aria-hidden="true" />} Download Excel
            </button>
          </div>
        </>
      )}
    </ModalShell>
  );
}
