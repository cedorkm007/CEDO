import { useState } from "react";
import { CalendarClock, CalendarPlus } from "lucide-react";
import { CONSULT_CHANGE_CUTOFF_HOURS, formatSlot } from "@/lib/renewal";
import { cancelSelfConsultation, type MySelfConsultation } from "../../renewalApi";
import { ConsultationBlockPicker } from "./ConsultationBlockPicker";

/**
 * A consultation the scholar books by themselves, any time: no renewal and no referral is needed, only that a staff member has indicated availability in the Consultation tool.
 * The scholar chooses what it is about, a day, morning or afternoon and, if they wish, which available staff member; it can be changed or cancelled up to 12 hours before.
 */
export function SelfConsultationSection({ booking, onChanged }: { booking: MySelfConsultation | null; onChanged: () => Promise<void> }) {
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // the picker can say the database update is missing: then there is nothing to pick
  const [legacy, setLegacy] = useState(false);

  async function cancel() {
    if (!window.confirm("Cancel this consultation? You can book another one afterwards.")) return;
    setBusy(true); setError("");
    const r = await cancelSelfConsultation();
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    await onChanged();
  }

  return (
    <div className="rounded-lg border border-[#062444]/15 bg-white px-4 py-3.5" aria-label="Book a consultation any time">
      <h4 className="text-[14px] font-bold text-[#062444] mb-1.5 flex items-center gap-1.5"><CalendarClock size={15} aria-hidden="true" /> Book a consultation any time</h4>
      {booking ? (
        <div className="mt-1">
          <p className="text-[14px] text-slate-800"><strong>{formatSlot(booking.startsAt)}</strong> with {booking.staffName}, at the CEDO office · {booking.typeLabel} ({booking.minutes} minutes). Please come during those hours.</p>
          {booking.canChange ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <button onClick={() => setPicking(v => !v)} disabled={busy} className="rounded-lg border border-[#062444]/25 px-3.5 py-2 text-[14px] font-semibold text-[#062444] hover:bg-[#f7f9fc]">{picking ? "Keep this time" : "Change the time or the staff"}</button>
              <button onClick={() => void cancel()} disabled={busy} className="rounded-lg border border-red-700 px-3.5 py-2 text-[14px] font-semibold text-red-800 hover:bg-red-50">Cancel my consultation</button>
            </div>
          ) : (
            <p className="mt-2 text-[14px] text-slate-700">It starts in less than {CONSULT_CHANGE_CUTOFF_HOURS} hours, so it can no longer be changed or cancelled online. Please contact the CEDO office if you cannot come.</p>
          )}
        </div>
      ) : (
        <div className="mt-1">
          <p className="text-[14px] text-slate-800">Want to talk to CEDO about something? You can book a consultation whenever a staff member has time available: choose what it is about, a day, morning or afternoon, and who you would like to see.</p>
          {!picking && (
            <button onClick={() => setPicking(true)} className="mt-2 inline-flex items-center gap-2 rounded-lg bg-[#062444] px-4 py-2.5 text-[14px] font-bold text-white hover:bg-[#0a3a6e]"><CalendarPlus size={15} aria-hidden="true" /> Book a consultation</button>
          )}
        </div>
      )}
      {picking && !legacy && (
        <ConsultationBlockPicker recordId="" self reschedule={!!booking} currentType={booking?.typeKey ?? null} onLegacy={() => { setLegacy(true); setPicking(false); }}
          onCancel={() => setPicking(false)} onDone={async () => { setPicking(false); await onChanged(); }} />
      )}
      {error && <p role="alert" className="mt-2 text-[14px] text-red-700">{error}</p>}
    </div>
  );
}
