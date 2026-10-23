import { useEffect, useMemo, useState } from "react";
import { CalendarClock, CalendarPlus, Loader2 } from "lucide-react";
import { CONSULT_CHANGE_CUTOFF_HOURS, consultBlockedBy, formatSlot, formatTimeOnly, groupSlotsByDay } from "@/lib/renewal";
import { ConsultationBlockPicker } from "./ConsultationBlockPicker";
import { bookConsultation, cancelConsultation, fetchOpenSlots, rescheduleConsultation, type MyRenewalWindow, type OpenSlot } from "../../renewalApi";

/** Book, change or cancel the face-to-face consultation: pick the type (each takes its own minutes), a day and morning or afternoon; changes allowed up to 12 hours before. */
export function ConsultationSection({ data, onChanged }: { data: MyRenewalWindow; onChanged: () => Promise<void> }) {
  const record = data.record!;
  const [picking, setPicking] = useState(false);
  // The old 10-minute picker is kept for a database that has not had the consultation-types update yet.
  const [legacy, setLegacy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const booking = data.booking;
  const blockedBy = consultBlockedBy(data.consultState);
  if (!booking && blockedBy) {
    return (
      <div className="rounded-lg border border-[#062444]/15 bg-white px-4 py-3.5" aria-label="Consultation">
        <h4 className="text-[14px] font-bold text-[#062444] mb-1.5 flex items-center gap-1.5"><CalendarClock size={15} aria-hidden="true" /> Your consultation</h4>
        <p className="text-[14px] text-slate-800">
          {data.consultState.endsWith("_missing")
            ? `A face-to-face consultation is needed. First upload your ${blockedBy} below; you can book your consultation after the evaluator approves it.`
            : `Your ${blockedBy} was received. You can book your consultation as soon as the evaluator approves it — we will tell you.`}
        </p>
      </div>
    );
  }
  if (!booking && !data.consultNeeded) return null;

  async function cancel() {
    if (!window.confirm("Cancel your consultation? You can book another time afterwards.")) return;
    setBusy(true); setError("");
    const r = await cancelConsultation(record.id);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    await onChanged();
  }

  return (
    <div className="rounded-lg border border-[#062444]/15 bg-white px-4 py-3.5" aria-label="Consultation">
      <h4 className="text-[14px] font-bold text-[#062444] mb-1.5 flex items-center gap-1.5"><CalendarClock size={15} aria-hidden="true" /> Your consultation</h4>
      {record.noShowFlag && !booking && <p className="text-[14px] text-red-800 mb-2">You missed your last consultation, so please book a new time.</p>}
      {booking ? (
        <div>
          <p className="text-[14px] text-slate-800"><strong>{formatSlot(booking.startsAt)}</strong>{booking.typeLabel ? ` (${booking.typeLabel}, ${booking.minutes ?? 10} minutes)` : ""} with {booking.staffName}, at the CEDO office. Please come during those hours.{data.window.term === "Summer" ? " Bring the hard copy of your prospectus." : ""}</p>
          {booking.canChange ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <button onClick={() => setPicking(v => !v)} disabled={busy} className="rounded-lg border border-[#062444]/25 px-3.5 py-2 text-[14px] font-semibold text-[#062444] hover:bg-[#f7f9fc]">{picking ? "Keep this time" : "Change the time"}</button>
              <button onClick={() => void cancel()} disabled={busy} className="rounded-lg border border-red-700 px-3.5 py-2 text-[14px] font-semibold text-red-800 hover:bg-red-50">Cancel my consultation</button>
            </div>
          ) : (
            <p className="mt-2 text-[14px] text-slate-700">It starts in less than {CONSULT_CHANGE_CUTOFF_HOURS} hours, so it can no longer be changed or cancelled online. Please contact the CEDO office if you cannot come.</p>
          )}
          {booking.canChange && <p className="mt-1.5 text-[13.5px] text-slate-600">You can change or cancel as often as you need, up to {CONSULT_CHANGE_CUTOFF_HOURS} hours before it starts.</p>}
        </div>
      ) : (
        <div>
          <p className="text-[14px] text-slate-800">A face-to-face consultation with CEDO is needed for your case. Choose what it is about, then a day and morning or afternoon. Each type of consultation takes its own number of minutes.</p>
          {!picking && (
            <button onClick={() => setPicking(true)} className="mt-2 inline-flex items-center gap-2 rounded-lg bg-[#062444] px-4 py-2.5 text-[14px] font-bold text-white hover:bg-[#0a3a6e]"><CalendarPlus size={15} aria-hidden="true" /> Book a time</button>
          )}
        </div>
      )}
      {picking && !legacy && (
        <ConsultationBlockPicker recordId={record.id} reschedule={!!booking} currentType={booking?.consultType ?? null} onLegacy={() => setLegacy(true)} onCancel={() => setPicking(false)}
          onDone={async () => { setPicking(false); await onChanged(); }} />
      )}
      {picking && legacy && (
        <SlotPicker recordId={record.id} reschedule={!!booking} onCancel={() => setPicking(false)} onDone={async () => { setPicking(false); await onChanged(); }} />
      )}
      {error && <p role="alert" className="mt-2 text-[14px] text-red-700">{error}</p>}
    </div>
  );
}

function SlotPicker({ recordId, reschedule, onCancel, onDone }: { recordId: string; reschedule: boolean; onCancel: () => void; onDone: () => Promise<void> }) {
  const [slots, setSlots] = useState<OpenSlot[] | null>(null);
  const [error, setError] = useState("");
  const [day, setDay] = useState<string | null>(null);
  const [chosen, setChosen] = useState<OpenSlot | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchOpenSlots(recordId).then(r => { if (cancelled) return; if (r.ok) setSlots(r.slots); else setError(r.error); });
    return () => { cancelled = true; };
  }, [recordId]);

  const days = useMemo(() => groupSlotsByDay(slots ?? []), [slots]);
  const today = days.find(d => d.day === day) ?? days[0];

  async function confirm() {
    if (!chosen) return;
    setBusy(true); setError("");
    const r = reschedule ? await rescheduleConsultation(recordId, chosen.slotId) : await bookConsultation(recordId, chosen.slotId);
    setBusy(false);
    if (!r.ok) { setError(r.error); setChosen(null); const again = await fetchOpenSlots(recordId); if (again.ok) setSlots(again.slots); return; }
    await onDone();
  }

  return (
    <div className="mt-3 border-t border-[#e6ecf5] pt-3">
      {!slots && !error && <p className="text-[14px] text-slate-600 flex items-center gap-2"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading the available times…</p>}
      {slots && slots.length === 0 && <p className="text-[14px] text-slate-700">There are no open times right now (times must be at least {CONSULT_CHANGE_CUTOFF_HOURS} hours away). Please check again later — the CEDO staff add new times regularly.</p>}
      {slots && slots.length > 0 && today && (
        <>
          <p className="text-[14px] font-semibold text-[#062444] mb-1.5">Choose a day</p>
          <div className="flex flex-wrap gap-2 mb-3" role="group" aria-label="Days with open times">
            {days.map(d => (
              <button key={d.day} onClick={() => { setDay(d.day); setChosen(null); }} aria-pressed={today.day === d.day}
                className={`rounded-lg border px-3 py-1.5 text-[14px] font-semibold ${today.day === d.day ? "border-[#062444] bg-[#062444] text-white" : "border-[#062444]/25 bg-white text-[#062444] hover:bg-[#f7f9fc]"}`}>
                {formatSlot(d.slots[0].startsAt).split(" · ")[0]} <span className="font-normal">({d.slots.length})</span>
              </button>
            ))}
          </div>
          <p className="text-[14px] font-semibold text-[#062444] mb-1.5">Choose a time</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" role="group" aria-label="Open times">
            {today.slots.map(s => (
              <button key={s.slotId} onClick={() => setChosen(s)} aria-pressed={chosen?.slotId === s.slotId}
                className={`rounded-lg border px-2.5 py-2 text-left text-[14px] ${chosen?.slotId === s.slotId ? "border-[#062444] bg-sky-50 ring-2 ring-[#062444]" : "border-[#062444]/25 bg-white hover:bg-[#f7f9fc]"}`}>
                <span className="block font-bold text-[#062444]">{formatTimeOnly(s.startsAt)}</span>
                <span className="block text-[13px] text-slate-700">{s.staffName}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {error && <p role="alert" className="mt-2 text-[14px] text-red-700">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={() => void confirm()} disabled={!chosen || busy} className="inline-flex items-center gap-2 rounded-lg bg-[#062444] px-4 py-2 text-[14px] font-bold text-white disabled:opacity-50">
          {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />} {chosen ? `${reschedule ? "Move to" : "Book"} ${formatSlot(chosen.startsAt)}` : reschedule ? "Choose a new time" : "Choose a time"}
        </button>
        <button onClick={onCancel} disabled={busy} className="rounded-lg border border-[#062444]/25 px-4 py-2 text-[14px] font-semibold text-[#062444]">Close</button>
      </div>
    </div>
  );
}

