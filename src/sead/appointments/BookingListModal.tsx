import { useEffect, useRef, useState } from "react";
import { ModalShell } from "../components/SeadUiShell";
import { CALENDAR_BOOKINGS_PAGE_SIZE, fetchCalendarBookingsPage, type CalendarSlot } from "../appointmentsApi";
import { ServerPagination } from "@/app/components/ServerPagination";
import type { Half, HalfCount } from "@/lib/calendarDayView";

const STATUS_LABEL: Record<string, string> = { booked: "Booked", attended: "Attended", no_show: "No-show" };
const STATUS_STYLE: Record<string, string> = {
  booked: "border-sky-400 bg-sky-50 text-sky-950", attended: "border-green-400 bg-green-50 text-green-950", no_show: "border-red-300 bg-red-50 text-red-900",
};


function BookingInner({ s, showStaff }: { s: CalendarSlot; showStaff: boolean }) {
  return (
    <>
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold text-[#062444]">{s.scholarName ?? "—"}{s.scholarIdNumber ? <span className="font-normal text-slate-600"> · {s.scholarIdNumber}</span> : null}</span>
        <span className={`rounded-full border px-2.5 py-0.5 text-[13px] font-semibold ${STATUS_STYLE[s.state] ?? "border-slate-300 bg-white text-slate-800"}`}>{STATUS_LABEL[s.state] ?? s.state}</span>
      </span>
      <span className="block text-[13.5px] text-slate-700">{s.typeLabel ?? "Consultation"} · {s.minutes ?? 10} min{!s.recordId ? " · Referral" : ""}{showStaff && s.staffName ? ` · ${s.staffName}` : ""}</span>
    </>
  );
}

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
              const inner = <BookingInner s={s} showStaff={showStaff} />;
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

/**
 * The booking list of one morning or afternoon in the all-staff (read-only) calendar, read PAGE BY PAGE (50 a page, with the true total): the numbers on top come from the calendar itself,
 * the bookings are read only when the list is opened. Pressing a scholar opens that scholar's renewal.
 */
export function PagedBookingListModal({ title, day, half, staffId, counts, onOpen, onClose }: {
  title: string; day: string; half: Half; staffId: string | null; counts: HalfCount; onOpen: (s: CalendarSlot) => void; onClose: () => void;
}) {
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<CalendarSlot[] | null>(null);
  const [total, setTotal] = useState(counts.total);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const request = useRef(0);
  useEffect(() => {
    const mine = ++request.current;
    setLoading(true);
    void fetchCalendarBookingsPage(day, half, staffId, page, CALENDAR_BOOKINGS_PAGE_SIZE).then(r => {
      if (mine !== request.current) return;      // a newer page was asked meanwhile
      setLoading(false);
      if (!r.ok) { setError(r.missing ? "The calendar needs the latest database update (supabase_migration_consultation_calendar_paging.sql). Ask the IT admin to run it." : r.error); setRows([]); return; }
      setError(""); setRows(r.rows); setTotal(r.total);
    });
  }, [day, half, staffId, page]);
  return (
    <ModalShell title={title} onClose={onClose} wide>
      <p className="text-[14px] text-slate-800"><strong>{counts.total}</strong> booking{counts.total === 1 ? "" : "s"}: {counts.booked} booked · {counts.attended} attended · {counts.noShow} no-show</p>
      {error && <p role="alert" className="text-[14px] text-red-700">{error}</p>}
      {rows === null || (loading && rows.length === 0) ? (
        <ul className="space-y-1.5" aria-busy="true" aria-label="Loading the booking list">
          {Array.from({ length: 5 }, (_, i) => <li key={i} className="rounded-lg border border-[#e6ecf5] bg-white px-3 py-3"><div className="h-4 w-56 animate-pulse rounded bg-slate-200" /><div className="mt-2 h-3.5 w-72 animate-pulse rounded bg-slate-200" /></li>)}
        </ul>
      ) : rows.length === 0 ? <p className="text-[14px] text-slate-700">{error ? "" : "No bookings for this schedule."}</p> : (
        <ul className={`space-y-1.5 ${loading ? "opacity-60" : ""}`} aria-label="Booking list">
          {rows.map(s => (
            <li key={s.slotId}>
              {s.recordId
                ? <button type="button" onClick={() => onOpen(s)} className="w-full rounded-lg border border-[#e6ecf5] bg-white px-3 py-2 text-left text-[14px] hover:bg-[#f7f9fc]"><BookingInner s={s} showStaff /></button>
                : <div className="w-full rounded-lg border border-[#e6ecf5] bg-white px-3 py-2 text-left text-[14px]"><BookingInner s={s} showStaff /></div>}
            </li>
          ))}
        </ul>
      )}
      <ServerPagination page={page} pageSize={CALENDAR_BOOKINGS_PAGE_SIZE} total={total} onPageChange={p => setPage(Math.max(1, p))} noun="bookings" disabled={loading} />
    </ModalShell>
  );
}
