import { useCallback, useEffect, useState } from "react";
import { useLiveReload } from "@/lib/liveUpdates";
import { CalendarCheck, CalendarX, Loader2, UserX } from "lucide-react";
import { CONSULT_CHANGE_CUTOFF_HOURS, formatSlot, termLabelOf } from "@/lib/renewal";
import { fetchMyAppointments, fetchMyReferrals, fetchMyRenewals, fetchMySelfConsultation, type MyAppointment, type MyReferral, type MyRenewalOverview, type MySelfConsultation } from "../../renewalApi";
import { SelfConsultationSection } from "./SelfConsultationSection";
import { ReferralConsultationSection } from "./ReferralConsultationSection";
import { ConsultationSection } from "./ConsultationSection";
import { NOTIFICATIONS_CHANGED } from "./NotificationBell";

/**
 * The Consultation tile: book, see and change face-to-face consultations (changes and cancellations are possible up to 12 hours before), and
 * the scholar's earlier appointments. Booking lives here and in the Renewal tile — it is the same booking either way.
 */
export function ConsultationPanel() {
  const [overview, setOverview] = useState<MyRenewalOverview | null>(null);
  const [appointments, setAppointments] = useState<MyAppointment[] | null>(null);
  const [referrals, setReferrals] = useState<MyReferral[]>([]);
  // a consultation booked any time: null = none booked; selfEnabled false = the database update (booking any time) has not been run yet
  const [mine, setMine] = useState<MySelfConsultation | null>(null);
  const [selfEnabled, setSelfEnabled] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [o, a, rf, sf] = await Promise.all([fetchMyRenewals(), fetchMyAppointments(), fetchMyReferrals(), fetchMySelfConsultation()]);
    if (!o.ok) setError(o.error); else if (!a.ok) setError(a.error);
    else { setOverview(o.overview); setAppointments(a.rows); setReferrals(rf.ok ? rf.rows : []); setSelfEnabled(sf.ok); setMine(sf.ok ? sf.row : null); setError(""); }
    window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
  }, []);
  useEffect(() => { void load(); }, [load]);
  useLiveReload(load);

  if (error) return <p role="alert" className="text-[14px] text-red-700">Couldn't load your consultations: {error}</p>;
  if (!overview || !appointments) return <p className="text-[14px] text-slate-600 flex items-center gap-2"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading your consultations…</p>;

  const needing = overview.windows.filter(w => w.record && (w.booking || w.consultState !== "not_needed"));
  const upcoming = appointments.filter(a => a.state === "booked");
  const past = appointments.filter(a => a.state !== "booked");

  return (
    <div className="space-y-5">
      <p className="text-[14px] text-slate-700">Face-to-face consultations at the CEDO office. You can book one whenever a staff member has time available{selfEnabled ? "" : " for your case"}. You choose what it is about, a day, morning or afternoon{selfEnabled ? " and, if you wish, who you would like to see" : ""}. You can change or cancel as often as you need, up to {CONSULT_CHANGE_CUTOFF_HOURS} hours before it starts.</p>

      {referrals.length > 0 && (
        <section aria-label="Consultations CEDO referred you for" className="space-y-3">
          {referrals.map(r => <ReferralConsultationSection key={r.referralId} referral={r} onChanged={load} />)}
        </section>
      )}

      {selfEnabled && <SelfConsultationSection booking={mine} onChanged={load} />}

      {!selfEnabled && needing.length === 0 && upcoming.length === 0 && referrals.length === 0 && (
        <div className="rounded-xl border border-[#e6ecf5] bg-[#f7f9fc] px-4 py-5 text-[14px] text-slate-800">
          <p className="font-bold text-[#062444] mb-1">You have no consultation to book right now</p>
          <p>If your renewal needs a consultation, it will appear here and you can book it. We will also tell you in your notifications.</p>
        </div>
      )}

      {needing.map(w => (
        <section key={w.window.id} aria-label={`Consultation for ${termLabelOf(w.window.schoolYear, w.window.term)}`}>
          <h3 className="mb-2 text-[15px] font-bold text-[#062444]">For your renewal for {termLabelOf(w.window.schoolYear, w.window.term)}</h3>
          <ConsultationSection data={w} onChanged={load} />
        </section>
      ))}

      {past.length > 0 && (
        <section aria-label="Earlier appointments">
          <h3 className="mb-2 text-[15px] font-bold text-[#062444]">Earlier appointments</h3>
          <ul className="space-y-2">
            {past.map(a => (
              <li key={a.slotId} className="flex flex-wrap items-center gap-2 rounded-lg border border-[#e6ecf5] bg-white px-3.5 py-2.5 text-[14px] text-slate-800">
                {a.state === "attended" ? <CalendarCheck size={16} className="text-green-700" aria-hidden="true" /> : a.state === "no_show" ? <UserX size={16} className="text-red-700" aria-hidden="true" /> : <CalendarX size={16} aria-hidden="true" />}
                <span className="font-semibold">{formatSlot(a.startsAt)}</span> with {a.staffName}
                <span className={`rounded-full border px-2 py-0.5 text-[13px] font-bold ${a.state === "attended" ? "border-green-300 bg-green-50 text-green-900" : "border-red-300 bg-red-50 text-red-800"}`}>{a.state === "attended" ? "Attended" : "Missed"}</span>
                {a.typeLabel && <span className="text-slate-600">· {a.typeLabel}</span>}
                {a.termLabel && <span className="text-slate-600">· {a.termLabel}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
