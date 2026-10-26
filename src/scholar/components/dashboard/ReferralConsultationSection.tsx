import { useState } from "react";
import { CalendarClock, CalendarPlus } from "lucide-react";
import { CONSULT_CHANGE_CUTOFF_HOURS, formatSlot } from "@/lib/renewal";
import { cancelReferralConsultation, type MyReferral } from "../../renewalApi";
import { ConsultationBlockPicker } from "./ConsultationBlockPicker";

/**
 * A consultation CEDO staff referred the scholar for. Staff chose only the reason; here the scholar chooses a day and morning or afternoon (the booking decides who the
 * consultation is with), and can change or cancel it up to 12 hours before. Cancelling puts the referral back to "choose a day".
 */
export function ReferralConsultationSection({ referral, onChanged }: { referral: MyReferral; onChanged: () => Promise<void> }) {
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const booked = referral.status === "booked" && !!referral.startsAt;

  async function cancel() {
    if (!window.confirm("Cancel this consultation? You can choose another day afterwards.")) return;
    setBusy(true); setError("");
    const r = await cancelReferralConsultation(referral.referralId);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    await onChanged();
  }

  return (
    <div className="rounded-lg border border-[#062444]/15 bg-white px-4 py-3.5" aria-label="Consultation CEDO referred you for">
      <h4 className="text-[14px] font-bold text-[#062444] mb-1.5 flex items-center gap-1.5"><CalendarClock size={15} aria-hidden="true" /> CEDO referred you for a consultation</h4>
      <p className="text-[14px] text-slate-800">Reason: <strong>{referral.reasonLabel}</strong> · {referral.minutes} minutes</p>
      {booked ? (
        <div className="mt-1">
          <p className="text-[14px] text-slate-800"><strong>{formatSlot(referral.startsAt)}</strong> with {referral.staffName}, at the CEDO office. Please come during those hours.</p>
          {referral.canChange ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <button onClick={() => setPicking(v => !v)} disabled={busy} className="rounded-lg border border-[#062444]/25 px-3.5 py-2 text-[14px] font-semibold text-[#062444] hover:bg-[#f7f9fc]">{picking ? "Keep this time" : "Change the time"}</button>
              <button onClick={() => void cancel()} disabled={busy} className="rounded-lg border border-red-700 px-3.5 py-2 text-[14px] font-semibold text-red-800 hover:bg-red-50">Cancel my consultation</button>
            </div>
          ) : (
            <p className="mt-2 text-[14px] text-slate-700">It starts in less than {CONSULT_CHANGE_CUTOFF_HOURS} hours, so it can no longer be changed or cancelled online. Please contact the CEDO office if you cannot come.</p>
          )}
        </div>
      ) : (
        <div className="mt-1">
          <p className="text-[14px] text-slate-800">Please choose a day and morning or afternoon for your consultation.</p>
          {!picking && (
            <button onClick={() => setPicking(true)} className="mt-2 inline-flex items-center gap-2 rounded-lg bg-[#062444] px-4 py-2.5 text-[14px] font-bold text-white hover:bg-[#0a3a6e]"><CalendarPlus size={15} aria-hidden="true" /> Choose a day and time</button>
          )}
        </div>
      )}
      {picking && (
        <ConsultationBlockPicker recordId="" reschedule={booked} currentType={null} referral={{ id: referral.referralId, reasonLabel: referral.reasonLabel, minutes: referral.minutes }}
          onLegacy={() => setPicking(false)} onCancel={() => setPicking(false)} onDone={async () => { setPicking(false); await onChanged(); }} />
      )}
      {error && <p role="alert" className="mt-2 text-[14px] text-red-700">{error}</p>}
    </div>
  );
}
