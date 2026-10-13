import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarPlus, ChevronLeft, ChevronRight, Loader2, Pencil, Trash2 } from "lucide-react";
import { formatSlot, formatTimeOnly, manilaDay, manilaInstant, manilaToday, slotCount } from "@/lib/renewal";
import {
  deleteAvailability, fetchMyAvailability, fetchMySlots, saveAvailability, type AffectedBooking, type AvailabilityRange, type CalendarSlot, type SaveRangeResult,
} from "../appointmentsApi";
import { ModalShell } from "../components/SeadUiShell";
import { SlotDetailModal } from "./SlotDetailModal";

type View = "week" | "day";

/** Adds days to a YYYY-MM-DD date (calendar arithmetic only, so no time-zone surprises). */
function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** The Monday of the week containing a date. */
function weekStart(ymd: string): string {
  const dow = new Date(`${ymd}T00:00:00Z`).getUTCDay();   // 0 = Sunday
  return addDays(ymd, dow === 0 ? -6 : 1 - dow);
}
const dayLabel = (ymd: string) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

const STATE_STYLE: Record<string, string> = {
  open: "border-slate-300 bg-white text-slate-800",
  booked: "border-sky-400 bg-sky-50 text-sky-950",
  attended: "border-green-400 bg-green-50 text-green-950",
  no_show: "border-red-300 bg-red-50 text-red-900",
};
const STATE_LABEL: Record<string, string> = { open: "Open", booked: "Booked", attended: "Attended", no_show: "No-show" };

/**
 * "Appointments": consultation staff set the time ranges they are available (each is split into 10-minute slots, one scholar per slot),
 * see them in a day / week calendar with who booked what, and mark each booked appointment Attended or No-show. Marking Attended opens
 * the pre-filled Daily Record.
 */
export function AppointmentsTab() {
  const [view, setView] = useState<View>("week");
  const [anchor, setAnchor] = useState(manilaToday());
  const [ranges, setRanges] = useState<AvailabilityRange[]>([]);
  const [slots, setSlots] = useState<CalendarSlot[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AvailabilityRange | "new" | null>(null);
  const [selected, setSelected] = useState<CalendarSlot | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<{ range: AvailabilityRange; booked: AffectedBooking[] } | null>(null);

  const days = useMemo(() => {
    const first = view === "week" ? weekStart(anchor) : anchor;
    return Array.from({ length: view === "week" ? 7 : 1 }, (_, i) => addDays(first, i));
  }, [view, anchor]);

  const load = useCallback(async () => {
    const from = new Date(`${days[0]}T00:00:00+08:00`).toISOString();
    const to = new Date(`${addDays(days[days.length - 1], 1)}T00:00:00+08:00`).toISOString();
    const [a, s] = await Promise.all([fetchMyAvailability(from, to), fetchMySlots(from, to)]);
    if (!a.ok) setError(a.error); else if (!s.ok) setError(s.error);
    else { setRanges(a.rows); setSlots(s.rows); setError(""); }
    setLoading(false);
  }, [days]);
  useEffect(() => { setLoading(true); void load(); }, [load]);

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
      <p className="text-[14px] text-slate-700 mb-4">Set when you are available. Each range is split into 10-minute slots, one scholar per slot. Scholars book from all open slots; you mark each appointment Attended or No-show.</p>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button onClick={() => setAnchor(addDays(anchor, -step))} aria-label="Previous" className="rounded-lg border border-[#062444]/25 p-2 text-[#062444] hover:bg-[#f7f9fc]"><ChevronLeft size={16} aria-hidden="true" /></button>
        <button onClick={() => setAnchor(today)} className="rounded-lg border border-[#062444]/25 px-3 py-2 text-[14px] font-semibold text-[#062444] hover:bg-[#f7f9fc]">Today</button>
        <button onClick={() => setAnchor(addDays(anchor, step))} aria-label="Next" className="rounded-lg border border-[#062444]/25 p-2 text-[#062444] hover:bg-[#f7f9fc]"><ChevronRight size={16} aria-hidden="true" /></button>
        <h2 className="text-[15px] font-bold text-[#062444] mx-2">{view === "week" ? `${dayLabel(days[0])} – ${dayLabel(days[6])}` : dayLabel(days[0])}</h2>
        <div className="flex rounded-lg border border-[#062444]/25 overflow-hidden" role="group" aria-label="Calendar view">
          {(["day", "week"] as View[]).map(v => (
            <button key={v} onClick={() => setView(v)} aria-pressed={view === v} className={`px-3 py-2 text-[14px] font-semibold ${view === v ? "bg-[#062444] text-white" : "bg-white text-[#062444] hover:bg-[#f7f9fc]"}`}>{v === "day" ? "Day" : "Week"}</button>
          ))}
        </div>
        <button onClick={() => setEditing("new")} className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-[#062444] px-4 py-2 text-[14px] font-bold text-white hover:bg-[#0a3a6e]"><CalendarPlus size={15} aria-hidden="true" /> Add availability</button>
      </div>

      {error && <p role="alert" className="mb-3 text-[14px] text-red-700">{error}</p>}
      {loading && <p className="text-[14px] text-slate-700 flex items-center gap-2 mb-3"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…</p>}

      <div className={view === "week" ? "grid gap-3 grid-cols-1 lg:grid-cols-2 xl:grid-cols-4" : "grid gap-3 grid-cols-1"}>
        {days.map(day => {
          const dayRanges = ranges.filter(r => manilaDay(r.startsAt) === day);
          return (
            <section key={day} className={`rounded-xl border bg-white ${day === today ? "border-[#062444]" : "border-[#e6ecf5]"}`} aria-label={dayLabel(day)}>
              <h3 className={`px-3 py-2 text-[14px] font-bold border-b border-[#e6ecf5] ${day === today ? "bg-[#062444] text-white rounded-t-xl" : "text-[#062444] bg-[#f7f9fc] rounded-t-xl"}`}>{dayLabel(day)}{day === today ? " · today" : ""}</h3>
              <div className="p-3 space-y-3">
                {dayRanges.length === 0 && <p className="text-[14px] text-slate-600">Not available.</p>}
                {dayRanges.map(r => {
                  const rs = slots.filter(s => s.availabilityId === r.id);
                  const started = new Date(r.startsAt).getTime() <= Date.now();
                  return (
                    <div key={r.id} className="rounded-lg border border-[#e6ecf5]">
                      <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-2 bg-[#fafcff] rounded-t-lg">
                        <p className="text-[14px] font-bold text-[#062444]">{formatTimeOnly(r.startsAt)} – {formatTimeOnly(r.endsAt)} <span className="font-normal text-slate-700">· {r.slotCount} slots · {r.bookedCount} booked</span></p>
                        {!started && (
                          <span className="flex gap-3">
                            <button onClick={() => setEditing(r)} className="inline-flex items-center gap-1 text-[14px] font-semibold text-[#00709f] hover:underline"><Pencil size={13} aria-hidden="true" /> Edit</button>
                            <button onClick={() => void removeRange(r, false)} className="inline-flex items-center gap-1 text-[14px] font-semibold text-red-700 hover:underline"><Trash2 size={13} aria-hidden="true" /> Remove</button>
                          </span>
                        )}
                      </div>
                      <ul className="p-2 grid gap-1.5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-1">
                        {(view === "day" ? rs : rs.filter(s => s.state !== "open")).map(s => (
                          <li key={s.slotId}>
                            <button onClick={() => s.state !== "open" && setSelected(s)} disabled={s.state === "open"}
                              className={`w-full rounded-md border px-2 py-1.5 text-left text-[14px] ${STATE_STYLE[s.state]} ${s.state === "open" ? "cursor-default" : "hover:shadow-sm"}`}>
                              <span className="font-bold">{formatTimeOnly(s.startsAt)}</span>{" "}
                              {s.state === "open" ? <span className="text-slate-700">Open</span> : <span>· {s.scholarName} <span className="font-semibold">({STATE_LABEL[s.state]})</span></span>}
                              {s.state !== "open" && s.caseSummary && <span className="block text-[13px] text-slate-700">{s.termLabel} · {s.caseSummary}</span>}
                            </button>
                          </li>
                        ))}
                        {view === "week" && rs.filter(s => s.state === "open").length > 0 && <li className="text-[14px] text-slate-700 px-1">{rs.filter(s => s.state === "open").length} open slot{rs.filter(s => s.state === "open").length === 1 ? "" : "s"}</li>}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {editing && <RangeForm initial={editing === "new" ? null : editing} defaultDay={anchor} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} />}
      {selected && <SlotDetailModal slot={selected} onClose={() => setSelected(null)} onChanged={async () => { setSelected(null); await load(); }} />}
      {confirmRemove && (
        <ModalShell title="Scholars have booked this range" onClose={() => setConfirmRemove(null)} wide>
          <p className="text-[14px] text-slate-800">If you remove this range, these scholars lose their booking and are notified so they can book another time:</p>
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
        {n ? <>This makes <strong>{n} slot{n === 1 ? "" : "s"}</strong> of 10 minutes, one scholar each. Times are Philippine time.</> : "The range must be a whole number of 10-minute slots (for example 9:00 to 11:00)."}
      </p>
      {warn && (
        <div className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-2.5 text-[14px] text-amber-950">
          <p className="font-bold mb-1">This change removes slots that scholars booked:</p>
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
