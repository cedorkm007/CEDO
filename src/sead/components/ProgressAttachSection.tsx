import { useCallback, useEffect, useState } from "react";
import { Camera, CheckCircle2, Loader2 } from "lucide-react";
import { disableProgress, enableProgress, fetchHasQrAttendance, fetchProgressCounts, fetchProgressEnabled, type ProgressCounts } from "../progressMonitorApi";
import type { SDPActivity } from "../sdpMonitorApi";

/**
 * The "Progress Monitoring" tab of an SDP activity: attach it (or take it off). With it attached, scholars confirm their attendance in this activity with a picture taken with the
 * phone's camera (the place, the date and the time are printed on it) and a staff member approves each picture in SDP Monitoring > Progress Monitoring. An activity uses one way of
 * confirming attendance: it cannot have this and the QR attendance together (the database refuses the second one).
 */
export function ProgressAttachSection({ activity }: { activity: SDPActivity }) {
  const [hasQr, setHasQr] = useState(false);
  const [enabled, setEnabled] = useState<boolean | null | undefined>(undefined);      // undefined = loading, null = the database update has not been run
  const [counts, setCounts] = useState<ProgressCounts>({ pending: 0, approved: 0, rejected: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setHasQr(await fetchHasQrAttendance(activity.id));
    const e = await fetchProgressEnabled(activity.id);
    setEnabled(e);
    if (e) setCounts(await fetchProgressCounts(activity.id));
  }, [activity.id]);
  useEffect(() => { void load(); }, [load]);

  async function toggle(on: boolean) {
    setBusy(true); setError("");
    const r = on ? await enableProgress(activity.id) : await disableProgress(activity.id);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    await load();
  }

  if (enabled === undefined) return <p className="text-[13px] text-slate-600"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> Loading…</p>;
  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase text-slate-500"><Camera size={13} /> Progress Monitoring (confirm attendance with a picture)</p>
      <p className="mb-3 text-[13px] text-slate-700">
        With this attached, a scholar opens the activity in the Scholar Portal and presses <strong>Capture a Picture</strong>. The camera opens with the <strong>place, the date and the time</strong> printed on the picture,
        and the picture is sent at once. You approve or reject each one in <strong>SDP Monitoring &gt; Progress Monitoring</strong>. An approved picture gives the scholar the attendance and the SDP credit.
        An activity uses <strong>one</strong> way of confirming attendance: this or the QR attendance.
      </p>

      {enabled === null ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">Progress monitoring is not set up yet: CEDO still has to run a database update.</p>
      ) : enabled ? (
        <div className="space-y-3">
          <p className="flex items-center gap-1.5 text-[13.5px] font-bold text-green-800"><CheckCircle2 size={15} /> Progress monitoring is attached to this activity.</p>
          <div className="flex flex-wrap gap-2 text-[13.5px]">
            <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 font-semibold text-amber-800">{counts.pending} waiting</span>
            <span className="rounded-full border border-green-200 bg-green-50 px-3 py-1 font-semibold text-green-800">{counts.approved} approved</span>
            <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1 font-semibold text-red-700">{counts.rejected} rejected</span>
          </div>
          <button onClick={() => void toggle(false)} disabled={busy} className="rounded-lg border border-red-300 px-4 py-2 text-[13px] font-semibold text-red-700 disabled:opacity-50">{busy ? "Working…" : "Turn off progress monitoring"}</button>
        </div>
      ) : hasQr ? (
        <p className="rounded-lg border border-[#062444]/15 bg-[#f7f9fc] px-3 py-2 text-[13px] text-slate-800">QR attendance is already attached to this activity, so progress monitoring cannot be attached too.</p>
      ) : !activity.category ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">Choose an SDP category for this activity first (Activity Details tab), then attach progress monitoring: the approved pictures need a category to give credit in.</p>
      ) : (
        <button onClick={() => void toggle(true)} disabled={busy} className="rounded-lg bg-[#062444] px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50">{busy ? "Working…" : "+ Attach progress monitoring to this activity"}</button>
      )}
      {error && <p role="alert" className="mt-2 text-[13px] text-red-600">{error}</p>}
    </div>
  );
}
