import { useEffect, useState } from "react";
import { X, Award, Clock } from "lucide-react";
import { fetchScholarSDPHistory, type SDPHistoryRow } from "../sdpMonitorApi";

interface SDPHistoryModalProps {
  scholarIdNumber: string;
  scholarName: string;
  onClose: () => void;
}

function HistoryTable({ rows, emptyLabel }: { rows: SDPHistoryRow[]; emptyLabel: string }) {
  if (rows.length === 0) {
    return <p className="text-[12.5px] text-slate-400 italic py-3">{emptyLabel}</p>;
  }
  return (
    <div className="border border-[#e6ecf5] rounded-lg overflow-hidden">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="bg-[#f8fafd] text-left text-[10.5px] uppercase tracking-wide text-[#0088cc]">
            <th className="px-3 py-2">Name of Activity</th>
            <th className="px-3 py-2">SDP Point(s) Credited</th>
            <th className="px-3 py-2">Date of Activity</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.activityId} className="border-t border-[#f0f3f8]">
              <td className="px-3 py-2 text-[#062444] font-medium">{r.activityName}</td>
              <td className="px-3 py-2 text-[#062444] font-bold">{r.points}</td>
              <td className="px-3 py-2 text-slate-500">{r.date ? new Date(r.date).toLocaleDateString() : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Shown from the "SDP Points" section of SDP Monitoring — one scholar's full point history. */
export function SDPHistoryModal({ scholarIdNumber, scholarName, onClose }: SDPHistoryModalProps) {
  const [attended, setAttended] = useState<SDPHistoryRow[]>([]);
  const [available, setAvailable] = useState<SDPHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { attended: a, available: v } = await fetchScholarSDPHistory(scholarIdNumber);
      setAttended(a);
      setAvailable(v);
      setLoading(false);
    })();
  }, [scholarIdNumber]);

  const totalPoints = attended.reduce((sum, r) => sum + r.points, 0);

  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center px-4 py-8 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-5 rounded-t-2xl">
          <div>
            <p className="text-[#F3BC00] text-[11px] font-bold uppercase tracking-wide mb-1">SDP History</p>
            <h3 className="text-white font-bold text-lg leading-tight">{scholarName}</h3>
            <p className="text-white/50 text-[11px] mt-1">Scholar ID {scholarIdNumber}</p>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white shrink-0"><X size={18} /></button>
        </div>

        <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
          {loading ? (
            <p className="text-sm text-slate-400 text-center py-6">Loading…</p>
          ) : (
            <>
              <div className="flex items-center gap-2 bg-[#F3BC00]/10 border border-[#F3BC00]/25 rounded-lg px-4 py-2.5">
                <Award size={16} className="text-[#F3BC00]" />
                <span className="text-[13px] font-bold text-[#062444]">{totalPoints} total SDP point{totalPoints === 1 ? "" : "s"}</span>
              </div>

              <div>
                <p className="text-[11px] font-semibold text-slate-500 uppercase mb-2">Attended Activities</p>
                <HistoryTable rows={attended} emptyLabel="No attended activities yet." />
              </div>

              <div>
                <p className="text-[11px] font-semibold text-slate-500 uppercase mb-2 flex items-center gap-1.5">
                  <Clock size={12} /> Available Activities
                </p>
                <HistoryTable rows={available} emptyLabel="No open activities right now." />
              </div>
            </>
          )}
        </div>

        <div className="px-6 pb-5">
          <button onClick={onClose} className="w-full bg-gray-100 text-gray-700 py-2.5 rounded-xl font-bold text-sm">Close</button>
        </div>
      </div>
    </div>
  );
}
