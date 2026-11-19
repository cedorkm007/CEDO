import { ModalShell } from "./SeadUiShell";
import type { DailyRecord } from "../scholarCounselingApi";

const STATUS_BADGE: Record<string, string> = {
  Regular: "bg-green-100 text-green-800", Probationary: "bg-red-100 text-red-700", "On leave": "bg-amber-100 text-amber-800", Reconsidered: "bg-blue-100 text-blue-800", Removed: "bg-slate-200 text-slate-700",
};
const longDay = (iso: string) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "—");

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-0.5 text-[14px]">
      <dt className="text-slate-600">{label}</dt>
      <dd className="min-w-0 whitespace-pre-wrap break-words text-slate-900">{children}</dd>
    </div>
  );
}

/**
 * The record's detail window (Consultation Tool > Daily Records > the eye button): everything about one visit, including what the table no longer shows (status, failed subjects,
 * findings, recommendations, who consulted). "View scholar profile" opens the scholar's profile as before.
 */
export function DailyRecordDetailModal({ record, onClose, onViewProfile, profileLoading }: { record: DailyRecord; onClose: () => void; onViewProfile: () => void; profileLoading: boolean }) {
  return (
    <ModalShell title="Daily Record" onClose={onClose} wide>
      <div>
        <p className="text-[16px] font-bold text-[#062444]">{record.name}</p>
        <p className="text-[13.5px] text-slate-700">{record.scholarIdNumber}</p>
      </div>
      <dl className="space-y-2 rounded-lg bg-[#f7f9fc] px-3 py-3">
        <Line label="Date visited">{longDay(record.dateVisited)}</Line>
        <Line label="Visit type">{record.visitType}</Line>
        <Line label="Status"><span className={`rounded-full px-2.5 py-0.5 text-[12.5px] font-bold uppercase tracking-wide ${STATUS_BADGE[record.status] ?? "bg-slate-100 text-slate-800"}`}>{record.status}</span></Line>
        <Line label="Consulted by">{record.consultedByName || "—"}</Line>
      </dl>
      <dl className="space-y-2 rounded-lg bg-[#f7f9fc] px-3 py-3">
        <Line label="Course">{record.course || "—"}</Line>
        <Line label="Year level">{record.yearLevel || "—"}</Line>
        <Line label="School">{record.school || "—"}</Line>
      </dl>
      <dl className="space-y-2">
        <Line label="Failed subject(s)">{record.failedSubjects || "—"}</Line>
        <Line label="Findings">{record.findings || "—"}</Line>
        <Line label="Staff recommendations">{record.staffRecommendations || "—"}</Line>
      </dl>
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className="rounded-lg border border-[#062444]/25 bg-white px-4 py-2 text-[13.5px] font-semibold text-[#062444] hover:bg-[#f7f9fc]">Close</button>
        <button type="button" onClick={onViewProfile} disabled={profileLoading} className="rounded-lg bg-[#062444] px-4 py-2 text-[13.5px] font-bold text-white hover:bg-[#0a3a6e] disabled:opacity-60">{profileLoading ? "Loading…" : "View scholar profile"}</button>
      </div>
    </ModalShell>
  );
}
