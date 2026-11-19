import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveReload } from "@/lib/liveUpdates";
import { CalendarPlus, ChevronLeft, ChevronRight, Loader2, Pencil, Trash2 } from "lucide-react";
import { consultHalf, formatSlot, formatTimeOnly, manilaDay, manilaInstant, manilaToday, rangeMinutesIn, slotCount, type ConsultHalf } from "@/lib/renewal";
import {
  deleteAvailability, fetchCalendarRanges, fetchCalendarStaff, fetchCalendarSummary, fetchMyAvailability, fetchMySlots, saveAvailability,
  type AffectedBooking, type AvailabilityRange, type CalendarSlot, type CalendarStaff, type SaveRangeResult,
} from "../appointmentsApi";
import { addDays, CALENDAR_REMEMBER_KEY, EMPTY_HALF, halfKey, indexSummary, isDay, rangesNote, readRememberedCalendar, weekStart, type CalendarView, type HalfCount } from "@/lib/calendarDayView";
import { ModalShell } from "../components/SeadUiShell";
import { SlotDetailModal } from "./SlotDetailModal";
import { BookingListModal, PagedBookingListModal } from "./BookingListModal";

type View = CalendarView;
function readStored(): ReturnType<typeof readRememberedCalendar> {
  try { return readRememberedCalendar(window.sessionStorage.getItem(CALENDAR_REMEMBER_KEY)); } catch { return null; }
}
const dayLabel = (ymd: string) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/**
 * "Appointments": consultation staff set the time ranges they are available. Scholars book a TYPE of consultation (each with its own minutes) for a
 * morning (AM) or an afternoon (PM); the minutes of the ranges decide how many fit. The calendar shows, for each morning and afternoon, the minutes booked
 * and who booked what; each booked appointment is marked Attended or No-show. Marking Attended opens the pre-filled Daily Record.
 *
 * The all-staff (read-only) calendar of the evaluator reads only the NUMBERS of each morning and afternoon (so a busy day or week is never cut off) and the booking list of one morning or afternoon
 * PAGE BY PAGE when it is opened; it has a date picker, Previous / Next and Today, and remembers the view, the day and the staff member. A staff member's own calendar reads their own bookings, as before.
 */
export function AppointmentsTab({ readOnly = false, onOpenRecord }: { readOnly?: boolean; onOpenRecord?: (recordId: string) => void } = {}) {
  const stored = useMemo(() => (readOnly ? readStored() : null), [readOnly]);
  const [view, setView] = useState<View>(stored?.view ?? "week");
  const [staffList, setStaffList] = useState<CalendarStaff[]>([]);
  const [staffFilter, setStaffFilter] = useState<string>(stored?.staff ?? "");
  const [anchor, setAnchor] = useState(stored?.anchor ?? manilaToday());
  const [ranges, setRanges] = useState<AvailabilityRange[]>([]);
  const [rangesTotal, setRangesTotal] = useState(0);
  const [slots, setSlots] = useState<CalendarSlot[]>([]);      // the staff member's own bookings (own calendar only)
  const [summary, setSummary] = useState<Map<string, HalfCount>>(new Map());      // the numbers of each morning and afternoon (all-staff calendar only)
  const [missing, setMissing] = useState(false);
  const request = useRef(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AvailabilityRange | "new" | null>(null);
  const [selected, setSelected] = useState<CalendarSlot | null>(null);
  const [listFor, setListFor] = useState<{ day: string; half: ConsultHalf } | null>(null);      // the booking list of one morning or afternoon
  const [confirmRemove, setConfirmRemove] = useState<{ range: AvailabilityRange; booked: AffectedBooking[] } | null>(null);

  const days = useMemo(() => {
    const first = view === "week" ? weekStart(anchor) : anchor;
    return Array.from({ length: view === "week" ? 7 : 1 }, (_, i) => addDays(first, i));
  }, [view, anchor]);

  // remember the view, the day and the staff member of the all-staff calendar (also after another tool or a reload)
  useEffect(() => {
    if (!readOnly) return;
    try { window.sessionStorage.setItem(CALENDAR_REMEMBER_KEY, JSON.stringify({ view, anchor, staff: staffFilter })); } catch { /* private window: it just is not remembered */ }
  }, [readOnly, view, anchor, staffFilter]);

  const load = useCallback(async () => {
    const mine = ++request.current;
    const from = new Date(`${days[0]}T00:00:00+08:00`).toISOString();
    const to = new Date(`${addDays(days[days.length - 1], 1)}T00:00:00+08:00`).toISOString();
    if (readOnly) {
      const [a, s] = await Promise.all([fetchCalendarRanges(from, to, staffFilter || null), fetchCalendarSummary(from, to, staffFilter || null)]);
      if (mine !== request.current) return;      // another day was asked meanwhile
      if (!a.ok || !s.ok) {
        const f = !a.ok ? a : (s as { ok: false; error: string; missing: boolean });
        if (f.missing) setMissing(true); else setError(f.error);
      } else { setRanges(a.rows); setRangesTotal(a.total); setSummary(indexSummary(s.rows)); setMissing(false); setError(""); }
    } else {
      const [a, s] = await Promise.all([fetchMyAvailability(from, to), fetchMySlots(from, to)]);
      if (mine !== request.current) return;
      if (!a.ok) setError(a.error); else if (!s.ok) setError(s.error);
      else { setRanges(a.rows); setRangesTotal(a.rows.length); setSlots(s.rows); setError(""); }
    }
    setLoading(false);
  }, [days, readOnly, staffFilter]);
  useEffect(() => { setLoading(true); void load(); }, [load]);
  useLiveReload(load);
  useEffect(() => {
    if (!readOnly) return;
    void fetchCalendarStaff().then(r => { if (r.ok) setStaffList(r.rows); });
  }, [readOnly]);

  const step = view === "week" ? 7 : 1;
  const today = manilaToday();

  async function removeRange(range: AvailabilityRange, confirm: boolean) {
    const r: SaveRangeResult = await deleteAvailability(range.id, confirm);
    if (r.ok) { setConfirmRemove(null); await load(); return; }
    if (r.needsConfirm) { setConfirmRemove({ range, booked: r.booked }); return; }
    setError(r.error);
  }

  return (
    <div>
      <p className="text-[14px] text-slate-700 mb-4">{readOnly
        ? "The consultation staff's calendars, for your information only. Scholars book a type of consultation for a morning or an afternoon; the available minutes decide how many fit. Press “Booking list” on a morning or afternoon to see who booked, and press a scholar to open that scholar's renewal."
        : "Set when you are available. Scholars book a type of consultation (each takes its own minutes) for a morning or an afternoon, up to the minutes you are available. Press “Booking list” on a morning or afternoon to see who booked, the type and the status, and to mark each appointment Attended or No-show."}</p>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button onClick={() => setAnchor(addDays(anchor, -step))} aria-label="Previous" className="rounded-lg border border-[#062444]/25 p-2 text-[#062444] hover:bg-[#f7f9fc]"><ChevronLeft size={16} aria-hidden="true" /></button>
        <button onClick={() => setAnchor(today)} className="rounded-lg border border-[#062444]/25 px-3 py-2 text-[14px] font-semibold text-[#062444] hover:bg-[#f7f9fc]">Today</button>
        <button onClick={() => setAnchor(addDays(anchor, step))} aria-label="Next" className="rounded-lg border border-[#062444]/25 p-2 text-[#062444] hover:bg-[#f7f9fc]"><ChevronRight size={16} aria-hidden="true" /></button>
        {readOnly && <input type="date" value={anchor} onChange={e => { if (isDay(e.target.value)) setAnchor(e.target.value); }} aria-label="Go to a day" className="rounded-lg border border-[#062444]/25 bg-white px-2.5 py-2 text-[14px] text-slate-900" />}
        <h2 className="text-[15px] font-bold text-[#062444] mx-2">{view === "week" ? `${dayLabel(days[0])} – ${dayLabel(days[6])}` : dayLabel(days[0])}</h2>
        <div className="flex rounded-lg border border-[#062444]/25 overflow-hidden" role="group" aria-label="Calendar view">
          {(["day", "week"] as View[]).map(v => (
            <button key={v} onClick={() => setView(v)} aria-pressed={view === v} className={`px-3 py-2 text-[14px] font-semibold ${view === v ? "bg-[#062444] text-white" : "bg-white text-[#062444] hover:bg-[#f7f9fc]"}`}>{v === "day" ? "Day" : "Week"}</button>
          ))}
        </div>
        {readOnly ? (
          <label className="ml-auto flex items-center gap-2 text-[14px] font-semibold text-[#062444]">Staff
            <select value={staffFilter} onChange={e => setStaffFilter(e.target.value)} className="rounded-lg border border-[#062444]/25 px-3 py-2 text-[14px] font-normal bg-white">
              <option value="">All consultation staff</option>
              {staffList.map(s => <option key={s.staffId} value={s.staffId}>{s.staffName}</option>)}
            </select>
          </label>
        ) : (
          <button onClick={() => setEditing("new")} className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-[#062444] px-4 py-2 text-[14px] font-bold text-white hover:bg-[#0a3a6e]"><CalendarPlus size={15} aria-hidden="true" /> Add availability</button>
        )}
      </div>

      {missing && <p role="status" className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[14px] text-amber-950">The calendar needs the latest database update (supabase_migration_consultation_calendar_paging.sql). Ask the IT admin to run it.</p>}
      {error && <p role="alert" className="mb-3 text-[14px] text-red-700">{error}</p>}
      {readOnly && !loading && rangesNote(ranges.length, rangesTotal) && <p role="status" className="mb-3 text-[14px] text-slate-800">{rangesNote(ranges.length, rangesTotal)}</p>}
      {loading && !readOnly && <p className="text-[14px] text-slate-700 flex items-center gap-2 mb-3"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…</p>}
      {loading && readOnly && (
        <div className={view === "week" ? "grid gap-3 grid-cols-1 lg:grid-cols-2 xl:grid-cols-4" : "grid gap-3 grid-cols-1"} aria-busy="true" aria-label="Loading the calendar">
          {days.map(d => <div key={d} className="rounded-xl border border-[#e6ecf5] bg-white p-3"><div className="h-4 w-28 animate-pulse rounded bg-slate-200" /><div className="mt-3 h-10 animate-pulse rounded bg-slate-200" /><div className="mt-2 h-10 animate-pulse rounded bg-slate-200" /></div>)}
        </div>
      )}

      <div className={`${view === "week" ? "grid gap-3 grid-cols-1 lg:grid-cols-2 xl:grid-cols-4" : "grid gap-3 grid-cols-1"} ${readOnly && loading ? "hidden" : ""}`}>
        {days.map(day => {
          const dayRanges = ranges.filter(r => manilaDay(r.startsAt) === day);
          return (
            <section key={day} className={`rounded-xl border bg-white ${day === today ? "border-[#062444]" : "border-[#e6ecf5]"}`} aria-label={dayLabel(day)}>
              <h3 className={`px-3 py-2 text-[14px] font-bold border-b border-[#e6ecf5] ${day === today ? "bg-[#062444] text-white rounded-t-xl" : "text-[#062444] bg-[#f7f9fc] rounded-t-xl"}`}>{dayLabel(day)}{day === today ? " · today" : ""}</h3>
              <div className="p-3 space-y-3">
                {dayRanges.length === 0 && <p className="text-[14px] text-slate-600">Not available.</p>}
                {dayRanges.map(r => {
                  const started = new Date(r.startsAt).getTime() <= Date.now();
                  return (
                    <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#e6ecf5] bg-[#fafcff] px-2.5 py-2">
                      <p className="text-[14px] font-bold text-[#062444]">{formatTimeOnly(r.startsAt)} – {formatTimeOnly(r.endsAt)} <span className="font-normal text-slate-700">· {r.minutes} minutes{readOnly && r.staffName ? ` · ${r.staffName}` : ""}</span></p>
                      {!started && !readOnly && (
                        <span className="flex gap-3">
                          <button onClick={() => setEditing(r)} className="inline-flex items-center gap-1 text-[14px] font-semibold text-[#00709f] hover:underline"><Pencil size={13} aria-hidden="true" /> Edit</button>
                          <button onClick={() => void removeRange(r, false)} className="inline-flex items-center gap-1 text-[14px] font-semibold text-red-700 hover:underline"><Trash2 size={13} aria-hidden="true" /> Remove</button>
                        </span>
                      )}
                    </div>
                  );
                })}
                {(["AM", "PM"] as ConsultHalf[]).map(half => {
                  const capacity = dayRanges.reduce((sum, r) => sum + rangeMinutesIn(r.startsAt, r.endsAt, day, half), 0);
                  const bookings = readOnly ? [] : slots.filter(s => s.state !== "open" && manilaDay(s.startsAt) === day && consultHalf(s.startsAt) === half);
                  const info: HalfCount = readOnly ? (summary.get(halfKey(day, half)) ?? EMPTY_HALF) : {
                    total: bookings.length, booked: bookings.filter(b => b.state === "booked").length, attended: bookings.filter(b => b.state === "attended").length,
                    noShow: bookings.filter(b => b.state === "no_show").length, usedMinutes: bookings.reduce((sum, b) => sum + (b.minutes ?? 10), 0),
                  };
                  if (capacity === 0 && info.total === 0) return null;
                  const used = info.usedMinutes;
                  return (
                    <div key={half} className="rounded-lg border border-[#e6ecf5]">
                      <p className="px-2.5 py-1.5 text-[14px] font-bold text-[#062444] bg-[#f7f9fc] rounded-t-lg">{half === "AM" ? "Morning (AM)" : "Afternoon (PM)"} <span className="font-normal text-slate-700">· {used} of {capacity} minutes booked</span></p>
                      <div className="p-2">
                        {info.total === 0 ? <p className="text-[14px] text-slate-700 px-1">No bookings yet.</p> : (
                          <button type="button" onClick={() => setListFor({ day, half })} className="w-full rounded-md border border-[#062444]/40 bg-white px-3 py-2 text-left text-[14px] font-bold text-[#062444] hover:bg-[#f7f9fc]">
                            Booking list ({info.total})
                            <span className="block text-[13px] font-normal text-slate-700">{info.booked} booked · {info.attended} attended · {info.noShow} no-show</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {editing && !readOnly && <RangeForm initial={editing === "new" ? null : editing} defaultDay={anchor} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} />}
      {listFor && readOnly && (
        <PagedBookingListModal title={`Booking list · ${dayLabel(listFor.day)} · ${listFor.half === "AM" ? "Morning (AM)" : "Afternoon (PM)"}`} day={listFor.day} half={listFor.half} staffId={staffFilter || null}
          counts={summary.get(halfKey(listFor.day, listFor.half)) ?? EMPTY_HALF} onOpen={s => { setListFor(null); if (s.recordId) onOpenRecord?.(s.recordId); }} onClose={() => setListFor(null)} />
      )}
      {listFor && !readOnly && (
        <BookingListModal title={`Booking list · ${dayLabel(listFor.day)} · ${listFor.half === "AM" ? "Morning (AM)" : "Afternoon (PM)"}`}
          slots={slots.filter(s => s.state !== "open" && manilaDay(s.startsAt) === listFor.day && consultHalf(s.startsAt) === listFor.half)} showStaff={readOnly}
          openable={s => (readOnly ? !!s.recordId : true)}
          onOpen={s => { if (readOnly) { setListFor(null); if (s.recordId) onOpenRecord?.(s.recordId); } else setSelected(s); }} onClose={() => setListFor(null)} />
      )}
      {selected && !readOnly && <SlotDetailModal slot={selected} onClose={() => setSelected(null)} onChanged={async () => { setSelected(null); await load(); }} />}
      {confirmRemove && (
        <ModalShell title="Scholars have booked this range" onClose={() => setConfirmRemove(null)} wide>
          <p className="text-[14px] text-slate-800">If you remove this range, there are not enough minutes left for these bookings, so they are cancelled and the scholars are notified so they can book another time:</p>
          <ul className="list-disc pl-5 text-[14px] text-slate-800">{confirmRemove.booked.map(b => <li key={b.slotId}><strong>{b.name}</strong> — {formatSlot(b.startsAt)}</li>)}</ul>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setConfirmRemove(null)} className="rounded-lg border border-[#062444]/25 px-4 py-2 text-[14px] font-semibold text-[#062444]">Keep the range</button>
            <button onClick={() => void removeRange(confirmRemove.range, true)} className="rounded-lg bg-red-700 px-4 py-2 text-[14px] font-bold text-white hover:bg-red-800">Remove and notify them</button>
          </div>
        </ModalShell>
      )}
    </div>
  );
}

/** Add or edit one availability range: a date and a start / end time (Philippine time). If the change would remove booked slots, the staff member is asked to confirm first. */
function RangeForm({ initial, defaultDay, onClose, onSaved }: { initial: AvailabilityRange | null; defaultDay: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const toHm = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Manila", hour12: false });
  const [date, setDate] = useState(initial ? manilaDay(initial.startsAt) : defaultDay);
  const [start, setStart] = useState(initial ? toHm(initial.startsAt) : "09:00");
  const [end, setEnd] = useState(initial ? toHm(initial.endsAt) : "11:00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [warn, setWarn] = useState<AffectedBooking[] | null>(null);

  const s = manilaInstant(date, start), e = manilaInstant(date, end);
  const n = s && e ? slotCount(s, e) : null;
  const input = "mt-1 w-full rounded-lg border border-[#062444]/25 px-3 py-2 text-[14px] font-normal outline-none focus:border-[#062444] bg-white";

  async function save(confirm: boolean) {
    if (!s || !e) { setError("Please choose a date and the start and end time."); return; }
    setBusy(true); setError("");
    const r = await saveAvailability(initial?.id ?? null, s, e, confirm);
    setBusy(false);
    if (r.ok) { await onSaved(); return; }
    if (r.needsConfirm) { setWarn(r.booked); return; }
    setError(r.error);
  }

  return (
    <ModalShell title={initial ? "Edit availability" : "Add availability"} onClose={onClose} wide>
      <label className="block text-[14px] font-semibold text-[#062444]">Date<input type="date" value={date} min={manilaToday()} onChange={e2 => setDate(e2.target.value)} className={input} /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-[14px] font-semibold text-[#062444]">From<input type="time" step={600} value={start} onChange={e2 => setStart(e2.target.value)} className={input} /></label>
        <label className="block text-[14px] font-semibold text-[#062444]">Until<input type="time" step={600} value={end} onChange={e2 => setEnd(e2.target.value)} className={input} /></label>
      </div>
      <p className="text-[14px] text-slate-700 rounded-lg bg-[#f7f9fc] border border-[#e6ecf5] px-3 py-2">
        {n && s && e ? <>This gives <strong>{n * 10} minutes</strong> for consultations ({rangeMinutesIn(s, e, date, "AM")} in the morning, {rangeMinutesIn(s, e, date, "PM")} in the afternoon). Scholars book a type of consultation for a morning or an afternoon, and each booking uses the minutes of its type. Times are Philippine time.</> : "The range must be a whole number of 10-minute steps (for example 9:00 to 11:00)."}
      </p>
      {warn && (
        <div className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-2.5 text-[14px] text-amber-950">
          <p className="font-bold mb-1">After this change there are not enough minutes for these bookings (the latest ones are cancelled):</p>
          <ul className="list-disc pl-5">{warn.map(b => <li key={b.slotId}>{b.name} — {formatSlot(b.startsAt)}</li>)}</ul>
          <p className="mt-1">They will be notified and can book another time.</p>
        </div>
      )}
      {error && <p role="alert" className="text-[14px] text-red-700">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onClose} disabled={busy} className="rounded-lg border border-[#062444]/25 px-4 py-2 text-[14px] font-semibold text-[#062444]">Cancel</button>
        <button onClick={() => void save(!!warn)} disabled={busy || !n} className="inline-flex items-center gap-2 rounded-lg bg-[#062444] px-4 py-2 text-[14px] font-bold text-white disabled:opacity-50">
          {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />} {warn ? "Save and notify them" : "Save"}
        </button>
      </div>
    </ModalShell>
  );
}
