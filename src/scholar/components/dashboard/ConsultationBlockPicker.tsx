import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { HALF_WORD, type ConsultHalf } from "@/lib/renewal";
import {
  bookConsultationBlock, bookReferralConsultation, fetchConsultTypes, fetchOpenBlocks, fetchReferralBlocks, rescheduleConsultationBlock, rescheduleReferralConsultation,
  type ConsultType, type OpenBlock,
} from "../../renewalApi";

const MANILA = "Asia/Manila";
/** "Tue, Oct 20" for a Philippine calendar day ("2026-10-20"). */
const dayText = (ymd: string) => new Date(`${ymd}T12:00:00+08:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: MANILA });

/**
 * Book (or change) a consultation by TYPE, day and morning / afternoon: the scholar picks the type (each takes its own minutes), a day that has room for it,
 * and morning (AM) or afternoon (PM). The database picks the staff member and decides how many fit (the staff's available minutes). `legacy` is reported to the
 * caller when the database update has not been run yet, so the old 10-minute picker can be used instead.
 */
export function ConsultationBlockPicker({ recordId, reschedule, currentType, referral, onLegacy, onCancel, onDone }: {
  recordId: string; reschedule: boolean; currentType: string | null;
  /** When the consultation comes from a CEDO referral, the reason is fixed (staff chose it) and the booking belongs to the referral, not to a renewal. */
  referral?: { id: string; reasonLabel: string; minutes: number };
  onLegacy: () => void; onCancel: () => void; onDone: () => Promise<void>;
}) {
  const [types, setTypes] = useState<ConsultType[] | null>(null);
  const [typeKey, setTypeKey] = useState<string>("");
  const [blocks, setBlocks] = useState<OpenBlock[] | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [half, setHalf] = useState<ConsultHalf | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (referral) { setTypes([{ key: "referral", label: referral.reasonLabel, minutes: referral.minutes, suggested: true }]); setTypeKey("referral"); return; }
    let cancelled = false;
    void fetchConsultTypes(recordId).then(r => {
      if (cancelled) return;
      if (r.ok) {
        setTypes(r.types);
        setTypeKey(r.types.find(t => t.key === currentType)?.key ?? r.types.find(t => t.suggested)?.key ?? "");
      } else if (r.legacy) onLegacy(); else setError(r.error);
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId, referral?.id]);

  useEffect(() => {
    if (!typeKey) { setBlocks(null); return; }
    let cancelled = false;
    setBlocks(null); setDay(null); setHalf(null); setError("");
    void (referral ? fetchReferralBlocks(referral.id) : fetchOpenBlocks(recordId, typeKey)).then(r => { if (cancelled) return; if (r.ok) setBlocks(r.blocks); else { setBlocks([]); setError(r.error); } });
    return () => { cancelled = true; };
  }, [recordId, typeKey, referral?.id]);

  const days = useMemo(() => Array.from(new Set((blocks ?? []).map(b => b.day))), [blocks]);
  const shownDay = day ?? days[0] ?? null;
  const halves = (blocks ?? []).filter(b => b.day === shownDay);
  const chosenType = types?.find(t => t.key === typeKey) ?? null;

  async function confirm() {
    if (!typeKey || !shownDay || !half) return;
    setBusy(true); setError("");
    const r = referral
      ? (reschedule ? await rescheduleReferralConsultation(referral.id, shownDay, half) : await bookReferralConsultation(referral.id, shownDay, half))
      : (reschedule ? await rescheduleConsultationBlock(recordId, typeKey, shownDay, half) : await bookConsultationBlock(recordId, typeKey, shownDay, half));
    setBusy(false);
    if (!r.ok) {
      setError(r.error); setHalf(null);
      const again = referral ? await fetchReferralBlocks(referral.id) : await fetchOpenBlocks(recordId, typeKey); if (again.ok) setBlocks(again.blocks);
      return;
    }
    await onDone();
  }

  return (
    <div className="mt-3 border-t border-[#e6ecf5] pt-3">
      {!types && !error && <p className="text-[14px] text-slate-600 flex items-center gap-2"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…</p>}
      {types && (
        <>
          <p className="text-[14px] font-semibold text-[#062444] mb-1.5">{referral ? "1. The reason CEDO gave for this consultation" : "1. What is the consultation about?"}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3" role="radiogroup" aria-label="Type of consultation">
            {types.map(t => (
              <button key={t.key} role="radio" aria-checked={typeKey === t.key} disabled={!!referral} onClick={() => setTypeKey(t.key)}
                className={`rounded-lg border px-3 py-2 text-left text-[14px] ${typeKey === t.key ? "border-[#062444] bg-sky-50 ring-2 ring-[#062444]" : "border-[#062444]/25 bg-white hover:bg-[#f7f9fc]"}`}>
                <span className="block font-bold text-[#062444]">{t.label}</span>
                <span className="block text-[13px] text-slate-700">{t.minutes} minutes{t.suggested ? " · matches your case" : ""}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {typeKey && !blocks && !error && <p className="text-[14px] text-slate-600 flex items-center gap-2"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading the available days…</p>}
      {blocks && blocks.length === 0 && !error && (
        <p className="text-[14px] text-slate-700">There is no room for this type of consultation right now (a day must be at least 12 hours away). Please check again later — the CEDO staff add availability regularly.</p>
      )}
      {blocks && blocks.length > 0 && shownDay && (
        <>
          <p className="text-[14px] font-semibold text-[#062444] mb-1.5">2. Choose a day</p>
          <div className="flex flex-wrap gap-2 mb-3" role="group" aria-label="Days with room">
            {days.map(d => (
              <button key={d} onClick={() => { setDay(d); setHalf(null); }} aria-pressed={shownDay === d}
                className={`rounded-lg border px-3 py-1.5 text-[14px] font-semibold ${shownDay === d ? "border-[#062444] bg-[#062444] text-white" : "border-[#062444]/25 bg-white text-[#062444] hover:bg-[#f7f9fc]"}`}>
                {dayText(d)}
              </button>
            ))}
          </div>
          <p className="text-[14px] font-semibold text-[#062444] mb-1.5">3. Morning or afternoon?</p>
          <div className="grid grid-cols-2 gap-2 max-w-md" role="group" aria-label="Morning or afternoon">
            {(["AM", "PM"] as ConsultHalf[]).map(h => {
              const b = halves.find(x => x.half === h);
              return (
                <button key={h} disabled={!b} onClick={() => setHalf(h)} aria-pressed={half === h}
                  className={`rounded-lg border px-3 py-2.5 text-left text-[14px] disabled:opacity-50 ${half === h ? "border-[#062444] bg-sky-50 ring-2 ring-[#062444]" : "border-[#062444]/25 bg-white hover:bg-[#f7f9fc]"}`}>
                  <span className="block font-bold text-[#062444]">{h === "AM" ? "Morning (AM)" : "Afternoon (PM)"}</span>
                  <span className="block text-[13px] text-slate-700">{b ? `${b.spots} place${b.spots === 1 ? "" : "s"} left` : "Full or not available"}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[13.5px] text-slate-600">You do not get an exact time: please come to the CEDO office during the {half ? (half === "AM" ? "morning" : "afternoon") : "morning or afternoon"} you choose. We will tell you who your consultation is with.</p>
        </>
      )}

      {error && <p role="alert" className="mt-2 text-[14px] text-red-700">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={() => void confirm()} disabled={!typeKey || !shownDay || !half || busy} className="inline-flex items-center gap-2 rounded-lg bg-[#062444] px-4 py-2 text-[14px] font-bold text-white disabled:opacity-50">
          {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
          {shownDay && half && chosenType ? `${reschedule ? "Move to" : "Book"} ${dayText(shownDay)} · ${HALF_WORD[half]}` : reschedule ? "Choose a new time" : "Choose a type, a day and morning or afternoon"}
        </button>
        <button onClick={onCancel} disabled={busy} className="rounded-lg border border-[#062444]/25 px-4 py-2 text-[14px] font-semibold text-[#062444]">Close</button>
      </div>
    </div>
  );
}
