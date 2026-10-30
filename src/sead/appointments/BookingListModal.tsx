import { ModalShell } from "../components/SeadUiShell";
import type { CalendarSlot } from "../appointmentsApi";

const STATUS_LABEL: Record<string, string> = { booked: "Booked", attended: "Attended", no_show: "No-show" };
const STATUS_STYLE: Record<string, string> = {
  booked: "border-sky-400 bg-sky-50 text-sky-950", attended: "border-green-400 bg-green-50 text-green-950", no_show: "border-red-300 bg-red-50 text-red-900",
};

/**
 * The booking list of one morning or afternoon: the scholars who booked it, the type of each booking and its status (Booked, Attended or No-show). Pressing a scholar opens the
 * appointment (to mark it Attended or No-show) for the consultation staff, or the scholar's renewal for the evaluator; a booking that has nothing to open is just listed.
 */
export function BookingListModal({ title, slots, showStaff, openable, onOpen, onClose }: {
  title: string; slots: CalendarSlot[]; showStaff: boolean;
  /** Whether pressing this booking opens something (the appointment, or the renewal). */
  openable: (s: CalendarSlot) => boolean; onOpen: (s: CalendarSlot) => void; onClose: () => void;
}) {
  const count = (state: string) => slots.filter(s => s.state === state).length;
  return (
    <ModalShell title={title} onClose={onClose} wide>
      {slots.length === 0 ? <p className="text-[14px] text-slate-700">No bookings for this schedule.</p> : (
        <>
          <p className="text-[14px] text-slate-800"><strong>{slots.length}</strong> booking{slots.length === 1 ? "" : "s"}: {count("booked")} booked · {count("attended")} attended · {count("no_show")} no-show</p>
          <ul className="space-y-1.5" aria-label="Booking list">
            {slots.map(s => {
              const inner = (
                <>
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold text-[#062444]">{s.scholarName ?? "—"}{s.scholarIdNumber ? <span className="font-normal text-slate-600"> · {s.scholarIdNumber}</span> : null}</span>
                    <span className={`rounded-full border px-2.5 py-0.5 text-[13px] font-semibold ${STATUS_STYLE[s.state] ?? "border-slate-300 bg-white text-slate-800"}`}>{STATUS_LABEL[s.state] ?? s.state}</span>
                  </span>
                  <span className="block text-[13.5px] text-slate-700">{s.typeLabel ?? "Consultation"} · {s.minutes ?? 10} min{!s.recordId ? " · Referral" : ""}{showStaff && s.staffName ? ` · ${s.staffName}` : ""}</span>
                </>
              );
              return (
                <li key={s.slotId}>
                  {openable(s)
                    ? <button type="button" onClick={() => onOpen(s)} className="w-full rounded-lg border border-[#e6ecf5] bg-white px-3 py-2 text-left text-[14px] hover:bg-[#f7f9fc]">{inner}</button>
                    : <div className="w-full rounded-lg border border-[#e6ecf5] bg-white px-3 py-2 text-left text-[14px]">{inner}</div>}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </ModalShell>
  );
}
