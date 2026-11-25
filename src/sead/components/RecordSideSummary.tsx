import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { fetchRecordContext, type ContextVisit, type RecordContext } from "../scholarCounselingApi";
import { stageTitle } from "@/lib/renewal";
import { firstLine } from "@/lib/recordPopup";

const day = (iso: string) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-x-2 text-[13.5px]">
      <dt className="text-slate-600">{label}</dt>
      <dd className="min-w-0 break-words text-slate-900">{children}</dd>
    </div>
  );
}

function Visit({ v }: { v: ContextVisit }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-lg border border-[#e6ecf5] bg-white">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="flex w-full items-start gap-1.5 px-2.5 py-2 text-left hover:bg-[#f8fafd]">
        {open ? <ChevronDown size={14} className="mt-0.5 shrink-0 text-slate-600" aria-hidden="true" /> : <ChevronRight size={14} className="mt-0.5 shrink-0 text-slate-600" aria-hidden="true" />}
        <span className="min-w-0">
          <span className="block text-[13px] font-semibold text-[#062444]">{day(v.dateVisited)}{v.consultant ? ` · ${v.consultant}` : ""}</span>
          {!open && <span className="block truncate text-[12.5px] text-slate-700">{firstLine(v.findings)}</span>}
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-[#f0f3f8] px-3 py-2 text-[13px] text-slate-900">
          <p className="text-[12px] text-slate-600">{v.visitType}{v.editCount > 0 ? " · edited after the visit" : ""}</p>
          <div><p className="font-semibold text-slate-700">Findings</p><p className="whitespace-pre-wrap break-words">{v.findings || "—"}</p></div>
          <div><p className="font-semibold text-slate-700">Staff recommendations</p><p className="whitespace-pre-wrap break-words">{v.staffRecommendations || "—"}</p></div>
        </div>
      )}
    </li>
  );
}

/**
 * The left side of the record pop-up, to read while writing: who the scholar is, where the renewal stands, the failed and INC subjects, and the previous visits (newest first, 20 at a time;
 * press one to read its full text). It only reads; `excludeRecordId` leaves out the record that is open.
 */
export function RecordSideSummary({ scholarIdNumber, excludeRecordId }: { scholarIdNumber: string | null; excludeRecordId?: string | null }) {
  const [ctx, setCtx] = useState<RecordContext | null>(null);
  const [visits, setVisits] = useState<ContextVisit[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setCtx(null); setVisits([]); setError("");
    if (!scholarIdNumber) return;
    let live = true;
    setLoading(true);
    void fetchRecordContext(scholarIdNumber, excludeRecordId ?? null, 0).then(r => {
      if (!live) return;
      setLoading(false);
      if (r.ok) { setCtx(r.ctx); setVisits(r.ctx.visits); }
      else setError(r.missing ? "The scholar summary needs the latest database update (supabase_migration_daily_records_popup.sql). Ask the IT admin to run it." : r.error);
    });
    return () => { live = false; };
  }, [scholarIdNumber, excludeRecordId]);

  const more = useCallback(async () => {
    if (!scholarIdNumber) return;
    setLoading(true);
    const r = await fetchRecordContext(scholarIdNumber, excludeRecordId ?? null, visits.length);
    setLoading(false);
    if (r.ok) setVisits(v => [...v, ...r.ctx.visits.filter(x => !v.some(y => y.id === x.id))]);
    else setError(r.error);
  }, [scholarIdNumber, excludeRecordId, visits.length]);

  if (!scholarIdNumber) return <p className="text-[13.5px] text-slate-700">Choose the scholar to see their details and their previous visits here while you write.</p>;
  if (error) return <p role="alert" className="text-[13.5px] text-red-700">{error}</p>;
  if (!ctx) return <p className="text-[13.5px] text-slate-700" role="status">Loading the scholar's details…</p>;
  const s = ctx.scholar;
  const subjects = (list: { subject: string; grade: string }[]) => list.map(x => (x.grade ? `${x.subject} (${x.grade})` : x.subject)).join(", ");
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[15px] font-bold text-[#062444]">{s.name}</p>
        <p className="text-[13px] text-slate-700">{s.scholarIdNumber}</p>
      </div>
      <dl className="space-y-1.5">
        <Row label="School">{s.school || "—"}</Row>
        <Row label="Program">{s.program || "—"}</Row>
        <Row label="Year level">{s.yearLevel || "—"}</Row>
        <Row label="Status">{s.status || "—"}</Row>
        <Row label="Renewal">{ctx.renewal ? <>{stageTitle(ctx.renewal.stage)}<span className="block text-[12px] text-slate-600">{ctx.renewal.term} {ctx.renewal.schoolYear}</span></> : "No renewal yet"}</Row>
        <Row label="Failed subjects">{ctx.failedSubjects.length ? subjects(ctx.failedSubjects) : "None"}</Row>
        <Row label="INC subjects">{ctx.incSubjects.length ? subjects(ctx.incSubjects) : "None"}</Row>
        {ctx.openInc.length > 0 && <Row label="Open INC">{ctx.openInc.map(i => (i.deadline ? `${i.subject} (by ${day(i.deadline)})` : `${i.subject} (no deadline yet)`)).join(", ")}</Row>}
      </dl>
      <div>
        <p className="mb-1.5 text-[13.5px] font-bold text-[#062444]">Previous visits{ctx.visitsTotal > 0 ? ` (${ctx.visitsTotal})` : ""}</p>
        {visits.length === 0 ? <p className="text-[13px] text-slate-700">No previous visits.</p> : (
          <ul className="space-y-1.5">{visits.map(v => <Visit key={v.id} v={v} />)}</ul>
        )}
        {visits.length < ctx.visitsTotal && (
          <button type="button" onClick={() => void more()} disabled={loading} className="mt-2 text-[13px] font-semibold text-[#00709f] hover:underline disabled:opacity-60">{loading ? "Loading…" : `Show more (${ctx.visitsTotal - visits.length} left)`}</button>
        )}
      </div>
    </div>
  );
}
