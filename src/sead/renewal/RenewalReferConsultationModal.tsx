import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { ModalShell } from "../components/SeadUiShell";
import { fetchReferBlocks, fetchReferStaff, fetchReferTypes, referBook, type ReferBlock, type ReferStaff, type ReferType } from "../renewalReferApi";

const dayText = (d: string) => new Date(`${d}T00:00:00+08:00`).toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" });
const halfText = (h: "AM" | "PM") => (h === "AM" ? "Morning" : "Afternoon");

/**
 * "Refer for Consultation": the evaluator chooses the consultation type, the day (morning or afternoon) and the consultation staff member, the same choices a scholar has in the scholar portal,
 * and books it FOR the scholar. The scholar is told and does not have to book. Only the booking is made here (the database checks who may and that the case has an INC, a DRP or a failed subject).
 */
export function RenewalReferConsultationModal({ recordId, scholarName, summary, onClose, onDone }: { recordId: string; scholarName: string; summary: string; onClose: () => void; onDone: () => void }) {
  const [types, setTypes] = useState<ReferType[] | null>(null);
  const [type, setType] = useState("");
  const [blocks, setBlocks] = useState<ReferBlock[] | null>(null);
  const [pick, setPick] = useState<{ day: string; half: "AM" | "PM" } | null>(null);
  const [staff, setStaff] = useState<ReferStaff[] | null>(null);
  const [staffId, setStaffId] = useState("");
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const r = await fetchReferTypes(recordId);
      if (!live) return;
      if (!r.ok) { if (r.missing) setMissing(true); else setError(r.error); return; }
      setTypes(r.types); setType(r.types.find(t => t.suggested)?.key ?? r.types[0]?.key ?? "");
    })();
    return () => { live = false; };
  }, [recordId]);
  useEffect(() => {
    if (!type) return;
    let live = true;
    setBlocks(null); setPick(null); setStaff(null); setStaffId("");
    void (async () => {
      const r = await fetchReferBlocks(recordId, type);
      if (!live) return;
      if (!r.ok) { setError(r.error); setBlocks([]); return; }
      setError(""); setBlocks(r.blocks);
    })();
    return () => { live = false; };
  }, [recordId, type]);
  useEffect(() => {
    if (!pick || !type) { setStaff(null); return; }
    let live = true;
    setStaff(null); setStaffId("");
    void (async () => {
      const r = await fetchReferStaff(type, pick.day, pick.half);
      if (!live) return;
      if (!r.ok) { setError(r.error); setStaff([]); return; }
      setStaff(r.staff);
    })();
    return () => { live = false; };
  }, [type, pick]);

  const days = useMemo(() => {
    const map = new Map<string, ReferBlock[]>();
    for (const b of blocks ?? []) map.set(b.day, [...(map.get(b.day) ?? []), b]);
    return [...map.entries()];
  }, [blocks]);
  const shown = showAll ? days : days.slice(0, 10);
  const chosenType = types?.find(t => t.key === type);
  const chosenStaff = staff?.find(s => s.staffId === staffId);

  async function book() {
    if (!pick || !type) return;
    setBusy(true); setError("");
    const r = await referBook(recordId, type, pick.day, pick.half, staffId || null);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    onDone();
  }

  return (
    <ModalShell title={`Refer for Consultation: ${scholarName}`} onClose={onClose} wide>
      <div className="space-y-4 px-6 py-5 text-[14px] text-slate-900">
        {missing ? <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-950">This needs the latest database update (supabase_migration_renewal_refer_consultation.sql). Until it is run, the consultation cannot be booked from here.</p> : (
          <>
            <p>{summary} Choose when and with whom. The consultation is booked <strong>for the scholar</strong>, who is told and <strong>does not have to book</strong>.</p>
            {!types ? <p className="flex items-center gap-2 text-slate-700"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…</p> : (
              <>
                <div>
                  <p className="mb-1 font-bold text-[#062444]">1. What the consultation is about</p>
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Consultation type">
                    {types.map(t => (
                      <button key={t.key} type="button" aria-pressed={type === t.key} onClick={() => setType(t.key)}
                        className={`rounded-full border px-3 py-1.5 font-semibold ${type === t.key ? "border-[#062444] bg-[#062444] text-white" : "border-[#062444]/25 bg-white text-[#062444] hover:bg-[#f7f9fc]"}`}>
                        {t.label} <span className="font-normal opacity-80">· {t.minutes} min{t.suggested ? " · suggested" : ""}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-1 font-bold text-[#062444]">2. Day and morning or afternoon</p>
                  {!blocks ? <p className="flex items-center gap-2 text-slate-700"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading the available times…</p>
                    : days.length === 0 ? <p className="rounded-lg border border-dashed border-[#e6ecf5] px-3 py-4 text-slate-700">No time is open for this type in the next 60 days. A consultation staff member has to add availability in the Consultation tool first.</p>
                    : (
                      <>
                        <ul className="space-y-1.5">
                          {shown.map(([day, list]) => (
                            <li key={day} className="flex flex-wrap items-center gap-2">
                              <span className="w-44 shrink-0 font-semibold">{dayText(day)}</span>
                              {list.map(b => (
                                <button key={b.half} type="button" aria-pressed={pick?.day === day && pick.half === b.half} onClick={() => setPick({ day, half: b.half })}
                                  className={`rounded-lg border px-2.5 py-1 font-semibold ${pick?.day === day && pick.half === b.half ? "border-[#062444] bg-[#062444] text-white" : "border-[#062444]/25 bg-white text-[#062444] hover:bg-[#f7f9fc]"}`}>
                                  {halfText(b.half)} <span className="font-normal opacity-80">· {b.spots} spot{b.spots === 1 ? "" : "s"}</span>
                                </button>
                              ))}
                            </li>
                          ))}
                        </ul>
                        {days.length > 10 && !showAll && <button type="button" onClick={() => setShowAll(true)} className="mt-2 font-semibold text-[#00709f] hover:underline">Show all {days.length} days</button>}
                      </>
                    )}
                </div>
                {pick && (
                  <div>
                    <p className="mb-1 font-bold text-[#062444]">3. Consultation staff</p>
                    {!staff ? <p className="flex items-center gap-2 text-slate-700"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…</p> : (
                      <fieldset className="space-y-1">
                        <legend className="sr-only">Consultation staff</legend>
                        <label className="flex items-center gap-2"><input type="radio" name="refer-staff" checked={staffId === ""} onChange={() => setStaffId("")} className="h-4 w-4" /> Anyone available (the staff member with the most time left)</label>
                        {staff.map(s => <label key={s.staffId} className="flex items-center gap-2"><input type="radio" name="refer-staff" checked={staffId === s.staffId} onChange={() => setStaffId(s.staffId)} className="h-4 w-4" /> {s.name} <span className="text-slate-700">· {s.freeMinutes} min free</span></label>)}
                      </fieldset>
                    )}
                  </div>
                )}
              </>
            )}
            {pick && chosenType && <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sky-950">Booking <strong>{chosenType.label}</strong> ({chosenType.minutes} min) on <strong>{dayText(pick.day)}</strong>, {halfText(pick.half).toLowerCase()}, with <strong>{chosenStaff ? chosenStaff.name : "the first available staff member"}</strong>.</p>}
            {error && <p role="alert" className="text-red-700">{error}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-[#062444]/25 px-4 py-2 font-semibold text-[#062444]">Cancel</button>
              <button type="button" onClick={() => void book()} disabled={busy || !pick || !type} className="rounded-lg bg-[#062444] px-4 py-2 font-bold text-white hover:bg-[#0a3a6e] disabled:opacity-50">{busy ? "Booking…" : "Book the consultation"}</button>
            </div>
          </>
        )}
      </div>
    </ModalShell>
  );
}
