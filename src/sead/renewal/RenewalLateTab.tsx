import { useCallback, useEffect, useState } from "react";
import { useLiveReload } from "@/lib/liveUpdates";
import { Loader2 } from "lucide-react";
import { RenewalStageBadge } from "@/app/components/RenewalStageBadge";
import { formatDay } from "@/lib/renewal";
import { decideLateApplication, fetchRenewalBoard, type BoardRow } from "../renewalApi";
import { ReasonDialog } from "./ReasonDialog";

/** Applications that came after the window closed: the evaluator accepts or declines each one, with a reason. */
export function RenewalLateTab({ schoolYear, term, onOpen, onChanged, refreshKey }: { schoolYear: string; term: string; onOpen: (id: string) => void; onChanged: () => void; refreshKey: number }) {
  const [rows, setRows] = useState<BoardRow[] | null>(null);
  const [error, setError] = useState("");
  const [deciding, setDeciding] = useState<{ row: BoardRow; accept: boolean } | null>(null);

  const load = useCallback(async () => {
    const r = await fetchRenewalBoard(schoolYear, term);
    if (r.ok) { setRows(r.rows.filter(x => x.isLate)); setError(""); } else setError(r.error);
  }, [schoolYear, term]);
  useEffect(() => { setRows(null); void load(); }, [load, refreshKey]);
  useLiveReload(load);

  if (error) return <p role="alert" className="text-[14px] text-red-700">{error}</p>;
  if (!rows) return <p className="text-[14px] text-slate-700 flex items-center gap-2"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…</p>;
  const waiting = rows.filter(r => r.stage === "late_pending");
  const decided = rows.filter(r => r.stage !== "late_pending");

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-[15px] font-bold text-[#062444] mb-2">Late — needs evaluator acceptance ({waiting.length})</h2>
        {waiting.length === 0 ? <p className="rounded-xl border border-dashed border-[#e6ecf5] px-4 py-6 text-[14px] text-slate-700">No late applications are waiting.</p> : (
          <ul className="space-y-2">
            {waiting.map(r => (
              <li key={r.recordId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e6ecf5] bg-white px-4 py-3">
                <div>
                  <button onClick={() => onOpen(r.recordId)} className="font-bold text-[#00709f] hover:underline text-[14px]">{r.name}</button>
                  <p className="text-[13.5px] text-slate-700">{r.scholarIdNumber} · {r.school} · applied {formatDay(r.appliedAt)}</p>
                  {r.scholarNote && <p className="text-[13.5px] text-slate-700 mt-0.5">Note: “{r.scholarNote}”</p>}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setDeciding({ row: r, accept: true })} className="rounded-lg bg-[#062444] px-3.5 py-2 text-[14px] font-bold text-white hover:bg-[#0a3a6e]">Accept</button>
                  <button onClick={() => setDeciding({ row: r, accept: false })} className="rounded-lg border border-red-700 px-3.5 py-2 text-[14px] font-bold text-red-800 hover:bg-red-50">Decline</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2 className="text-[15px] font-bold text-[#062444] mb-2">Already decided ({decided.length})</h2>
        {decided.length === 0 ? <p className="text-[14px] text-slate-700">None yet.</p> : (
          <ul className="space-y-2">
            {decided.map(r => (
              <li key={r.recordId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e6ecf5] bg-white px-4 py-3">
                <button onClick={() => onOpen(r.recordId)} className="font-bold text-[#00709f] hover:underline text-[14px]">{r.name}</button>
                <span className="text-[13.5px] text-slate-700">{r.lateDecision === "declined" ? "Declined" : "Accepted"}</span>
                <RenewalStageBadge stage={r.stage} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {deciding && (
        <ReasonDialog
          title={`${deciding.accept ? "Accept" : "Decline"} the late application`}
          intro={<>{deciding.row.name} applied after the window closed. The scholar will be told your reason.</>}
          label="Reason" confirmLabel={deciding.accept ? "Accept application" : "Decline application"} danger={!deciding.accept}
          onCancel={() => setDeciding(null)}
          onConfirm={async reason => {
            const r = await decideLateApplication(deciding.row.recordId, deciding.accept, reason);
            if (!r.ok) return r.error;
            setDeciding(null); onChanged(); await load(); return null;
          }}
        />
      )}
    </div>
  );
}
