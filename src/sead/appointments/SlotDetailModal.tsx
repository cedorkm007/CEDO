import { useState } from "react";
import { CheckCircle2, Loader2, UserX } from "lucide-react";
import { RenewalStageBadge } from "@/app/components/RenewalStageBadge";
import { formatSlot } from "@/lib/renewal";
import { fetchSlotPrefill, markSlot, setHardCopyReceived, type AttendedPrefill, type CalendarSlot } from "../appointmentsApi";
import { ModalShell } from "../components/SeadUiShell";
import { AddDailyRecordModal } from "../components/AddDailyRecordModal";

/** One booked appointment: who, what case, and the actions — Attended (opens the pre-filled Daily Record) or No-show. */
export function SlotDetailModal({ slot, onClose, onChanged }: { slot: CalendarSlot; onClose: () => void; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState<"attended" | "no_show" | "form" | "hard" | null>(null);
  const [error, setError] = useState("");
  const [prefill, setPrefill] = useState<AttendedPrefill | null>(null);
  const started = new Date(slot.startsAt).getTime() <= Date.now();

  async function mark(outcome: "attended" | "no_show") {
    if (outcome === "no_show" && !window.confirm(`Mark ${slot.scholarName} as a no-show? They will be told to book a new time.`)) return;
    setBusy(outcome); setError("");
    const r = await markSlot(slot.slotId, outcome);
    setBusy(null);
    if (!r.ok) { setError(r.error); return; }
    if (outcome === "attended" && r.prefill) { setPrefill(r.prefill); return; }
    await onChanged();
  }
  async function openRecord() {
    setBusy("form"); setError("");
    const r = await fetchSlotPrefill(slot.slotId);
    setBusy(null);
    if (!r.ok) { setError(r.error); return; }
    setPrefill(r.prefill);
  }
  async function tickHardCopy() {
    if (!slot.recordId) return;
    setBusy("hard"); setError("");
    const r = await setHardCopyReceived(slot.recordId, true);
    setBusy(null);
    if (!r.ok) { setError(r.error); return; }
    await onChanged();
  }

  if (prefill) {
    return <AddDailyRecordModal prefill={prefill} onClose={() => { setPrefill(null); void onChanged(); }} onCreated={() => { void onChanged(); }} />;
  }

  return (
    <ModalShell title="Consultation appointment" onClose={onClose} wide>
      <div className="space-y-1 text-[14px] text-slate-800">
        <p className="text-[16px] font-bold text-[#062444]">{slot.scholarName}</p>
        <p>{slot.scholarIdNumber} · {formatSlot(slot.startsAt)}</p>
        <p>{slot.termLabel ? `Renewal for ${slot.termLabel}` : ""}{slot.caseSummary ? ` · ${slot.caseSummary}` : ""}</p>
        {slot.stage && <div className="pt-1"><RenewalStageBadge stage={slot.stage} full /></div>}
        {slot.noShowCount > 0 && <p className="text-red-800 font-semibold">Missed {slot.noShowCount} earlier consultation{slot.noShowCount === 1 ? "" : "s"} for this renewal.</p>}
        {slot.isSummer && <p>Summer renewal: the prospectus hard copy should be brought. Hard copy received: <strong>{slot.hardCopy ? "yes" : "not yet"}</strong>.</p>}
      </div>

      {slot.state === "booked" && (
        <div className="pt-3">
          <div className="flex flex-wrap gap-2">
            <button onClick={() => void mark("attended")} disabled={busy !== null} className="inline-flex items-center gap-1.5 rounded-lg bg-green-800 px-4 py-2 text-[14px] font-bold text-white hover:bg-green-900 disabled:opacity-60">
              {busy === "attended" ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <CheckCircle2 size={15} aria-hidden="true" />} Attended
            </button>
            <button onClick={() => void mark("no_show")} disabled={busy !== null || !started} className="inline-flex items-center gap-1.5 rounded-lg border border-red-700 px-4 py-2 text-[14px] font-bold text-red-800 hover:bg-red-50 disabled:opacity-50">
              {busy === "no_show" ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <UserX size={15} aria-hidden="true" />} No-show
            </button>
          </div>
          {!started && <p className="mt-1.5 text-[13.5px] text-slate-700">No-show can be marked once the appointment time has started.</p>}
          <p className="mt-1.5 text-[13.5px] text-slate-700">“Attended” opens the Daily Record, already filled in from the scholar's grades.</p>
        </div>
      )}
      {slot.state === "attended" && (
        <div className="pt-3 space-y-2">
          <p className="text-[14px] text-green-900 font-semibold">Attended.</p>
          {!slot.dailyRecordId && <button onClick={() => void openRecord()} disabled={busy !== null} className="rounded-lg bg-[#062444] px-4 py-2 text-[14px] font-bold text-white hover:bg-[#0a3a6e] disabled:opacity-60">Fill in the Daily Record</button>}
          {slot.dailyRecordId && <p className="text-[14px] text-slate-800">The Daily Record was saved (see Daily Records).</p>}
          {slot.isSummer && !slot.hardCopy && <button onClick={() => void tickHardCopy()} disabled={busy !== null} className="rounded-lg border border-[#062444]/40 px-4 py-2 text-[14px] font-bold text-[#062444] hover:bg-[#f7f9fc] disabled:opacity-60">Prospectus hard copy received</button>}
        </div>
      )}
      {slot.state === "no_show" && <p className="pt-3 text-[14px] text-red-800 font-semibold">Marked as a no-show. The scholar was told to book a new time.</p>}
      {error && <p role="alert" className="pt-2 text-[14px] text-red-700">{error}</p>}
    </ModalShell>
  );
}
