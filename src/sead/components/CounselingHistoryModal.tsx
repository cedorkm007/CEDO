import { useEffect, useState } from "react";
import { fetchCounselingHistoryForScholar, type DailyRecord } from "../scholarCounselingApi";
import { Modal } from "./Modal";

function formatDateVisited(iso: string): string {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/** "Counseling History" summary — every Daily Record ever logged for one scholar, most recent first (fetchCounselingHistoryForScholar already inherits that ordering from scholar_counseling_daily_records()). */
export function CounselingHistoryModal({
  scholarIdNumber, scholarName, onClose,
}: { scholarIdNumber: string; scholarName: string; onClose: () => void }) {
  const [records, setRecords] = useState<DailyRecord[] | null>(null);

  useEffect(() => {
    fetchCounselingHistoryForScholar(scholarIdNumber).then(setRecords);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scholarIdNumber]);

  return (
    <Modal title={`Consultation History — ${scholarName}`} onClose={onClose}>
      {!records ? (
        <p className="text-[13px] text-slate-400 text-center py-8">Loading…</p>
      ) : records.length === 0 ? (
        <p className="text-[13px] text-slate-400 text-center py-8 italic">No consultation visits logged yet.</p>
      ) : (
        <div className="space-y-3">
          {records.map(r => (
            <div key={r.id} className="rounded-xl border border-[#e6ecf5] bg-[#f8fafd] px-4 py-3.5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[13px] font-bold text-[#062444]">{formatDateVisited(r.dateVisited)}</p>
                <p className="text-[11.5px] text-slate-500">Consulted by {r.consultedByName || "—"}</p>
              </div>
              <dl className="space-y-1.5 text-[12.5px]">
                <div>
                  <dt className="font-semibold text-slate-500">Subject Failed/INC</dt>
                  <dd className="text-[#1a2432]">{r.failedSubjects || "—"}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-500">Findings</dt>
                  <dd className="text-[#1a2432] whitespace-pre-wrap">{r.findings || "—"}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-500">Staff Recommendations</dt>
                  <dd className="text-[#1a2432] whitespace-pre-wrap">{r.staffRecommendations || "—"}</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
