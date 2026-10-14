import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { DIVISION_HEAD_CASE_LABEL, DIVISION_HEAD_DECISION_LABEL, formatDay } from "@/lib/renewal";
import { ModalShell } from "../components/SeadUiShell";
import { ReferralFormPanel } from "../components/ReferralFormPanel";
import { fetchDivisionHeadQueue, type DivisionHeadCase } from "../divisionHeadApi";

const dayOf = (iso: string) => formatDay(iso.slice(0, 10));

/**
 * "Division Head" tab of Scholar Renewal: the cases waiting for the Division Head's decision, the ones sent back to the evaluator, and the
 * decisions of the last 60 days. The Division Head opens a case to sign and decide (the same Referral Form screen as ever); the evaluator
 * can open the same list to see where each case is.
 */
export function RenewalDivisionHeadTab({ canDecide, onOpenRecord, onChanged, refreshKey }: {
  canDecide: boolean; onOpenRecord: (recordId: string) => void; onChanged: () => void; refreshKey: number;
}) {
  const [rows, setRows] = useState<DivisionHeadCase[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<DivisionHeadCase | null>(null);

  const load = useCallback(async () => {
    const r = await fetchDivisionHeadQueue();
    if (r.ok) { setRows(r.rows); setError(""); } else setError(r.error);
  }, []);
  useEffect(() => { void load(); }, [load, refreshKey]);

  if (error) return <p role="alert" className="text-[14px] text-red-700">Couldn't load the Division Head's list: {error}</p>;
  if (!rows) return <p className="flex items-center gap-2 text-[14px] text-slate-700"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…</p>;

  const waiting = rows.filter(r => r.state === "waiting");
  const sentBack = rows.filter(r => r.state === "sent_back");
  const decided = rows.filter(r => r.state === "decided");

  const group = (title: string, hint: string, list: DivisionHeadCase[]) => (
    <section className="mb-6" aria-label={title}>
      <h2 className="text-[15px] font-extrabold text-[#062444]">{title} <span className="font-semibold text-slate-700">({list.length})</span></h2>
      <p className="mb-2 text-[14px] text-slate-700">{hint}</p>
      {list.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[#e6ecf5] px-4 py-5 text-center text-[14px] text-slate-700">Nothing here.</p>
      ) : (
        <ul className="space-y-2.5">
          {list.map(c => (
            <li key={c.recordId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e6ecf5] bg-white px-4 py-3">
              <div className="min-w-0">
                <p className="text-[14px] font-bold text-[#062444]">{c.scholarName} <span className="font-semibold text-slate-700">· {c.scholarIdNumber}</span></p>
                <p className="text-[14px] text-slate-700">{c.school} · {c.program} · {c.yearLevel}</p>
                <p className="mt-0.5 text-[14px] text-slate-700">
                  {c.termLabel} · {DIVISION_HEAD_CASE_LABEL[c.caseType]} · {c.failedCount} failed subject{c.failedCount === 1 ? "" : "s"}
                  {c.consultationDoneAt ? ` · consultation ${dayOf(c.consultationDoneAt)}` : " · no consultation yet"}{c.noShowCount > 0 ? ` · missed ${c.noShowCount}` : ""}
                </p>
                {c.state === "decided" && c.decision && <p className="mt-0.5 text-[14px] font-semibold text-green-800">{DIVISION_HEAD_DECISION_LABEL[c.decision]}{c.decidedAt ? ` · ${dayOf(c.decidedAt)}` : ""}</p>}
                {c.state === "sent_back" && <p className="mt-0.5 text-[14px] font-semibold text-amber-900">Sent back to the evaluator</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setOpen(c)} className="rounded-lg bg-[#062444] px-4 py-2 text-[14px] font-bold text-white hover:bg-[#0a3a6e]">
                  {c.state === "waiting" && canDecide ? "Review and decide" : "Open"}<span className="sr-only"> {c.scholarName}</span>
                </button>
                <button type="button" onClick={() => onOpenRecord(c.recordId)} className="rounded-lg border border-[#062444]/25 bg-white px-4 py-2 text-[14px] font-semibold text-[#062444] hover:bg-[#f7f9fc]">
                  Full case<span className="sr-only"> of {c.scholarName}</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <div>
      {group("Waiting for the Division Head", canDecide ? "These cases need your decision and signature." : "These cases are with the Division Head.", waiting)}
      {group("Sent back to the evaluator", "The Division Head asked for more review. The evaluator sends the case again when ready.", sentBack)}
      {group("Decided in the last 60 days", "", decided)}
      {open && (
        <ModalShell title={`${open.scholarName} — renewal for ${open.termLabel}`} onClose={() => setOpen(null)} wide>
          <ReferralFormPanel mode={canDecide && open.state === "waiting" ? "approve" : "view"} referralId={open.referralId}
            onDone={() => { setOpen(null); void load(); onChanged(); }} />
        </ModalShell>
      )}
    </div>
  );
}
