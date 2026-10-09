import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, ClipboardList, Lightbulb, CheckCircle2 } from "lucide-react";
import { SectionCard } from "./SectionCard";
import {
  fetchApprovedSDPActivities, fetchAttendedSDPActivityIds, fetchScholarSDPProgress, SDP_CATEGORIES,
  type SDPActivity, type SDPCreditCounts,
} from "../../sdpApi";
import { pubmatUrl } from "@/sead/pubmatApi";
import { DefaultPubmat, AttendedBadge, EndedBadge, NextScheduleBadge, isPastDate, formatShortDate } from "./activityCardKit";

/**
 * For a recurring activity, status has to look at EVERY schedule (the base
 * dateTime plus every occurrence in recurringDates), not just the base date
 * — a series isn't "Ended" just because its first occurrence already
 * passed. Returns the soonest upcoming date if any schedule hasn't
 * happened yet; null (and ended=true) once every schedule has passed. A
 * one-time activity just uses its own single date.
 */
function activityStatus(act: SDPActivity): { ended: boolean; nextDate: string | null } {
  if (act.activityType !== "recurring") {
    return { ended: isPastDate(act.dateTime), nextDate: null };
  }
  const allDates = [act.dateTime, ...act.recurringDates.map(o => o.date)].filter(Boolean).sort();
  if (allDates.length === 0) return { ended: false, nextDate: null };
  const upcoming = allDates.find(d => !isPastDate(d));
  return upcoming ? { ended: false, nextDate: upcoming } : { ended: true, nextDate: null };
}

function ActivityDetailModal({ activity, onClose }: { activity: SDPActivity; onClose: () => void }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="bg-[#062444] px-6 py-5 flex items-start justify-between">
          <div>
            <p className="text-[#F3BC00] text-xs font-bold uppercase tracking-wide mb-1">SDP Activity</p>
            <h3 className="font-bold text-white text-xl leading-tight">{activity.name}</h3>
          </div>
          <button onClick={onClose} className="p-1 text-white/60 hover:text-white shrink-0 ml-4"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-3 max-h-96 overflow-y-auto">
          {[
            { label: "Name of Activity", value: activity.name },
            { label: "Organization", value: activity.organization },
            { label: "Date / Time", value: activity.dateTime ? `${formatShortDate(activity.dateTime)}, ${new Date(activity.dateTime).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : "—" },
            { label: "Venue", value: activity.venue },
            { label: "Credit per Attendance", value: String(activity.credits) },
          ].map(({ label, value }) => (
            <div key={label} className="flex gap-3">
              <span className="text-xs text-gray-400 w-32 shrink-0 font-medium pt-0.5">{label}</span>
              <span className="text-sm text-gray-800 font-semibold">{value || "—"}</span>
            </div>
          ))}
        </div>
        <div className="px-6 pb-5">
          <button onClick={onClose} className="w-full bg-gray-100 text-gray-700 py-2.5 rounded-xl font-bold text-sm">Close</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/** Same compact card structure as CalendarAndActivitiesPanel's Activities list and SubmissionActivitiesList's collapsed rows — consistent sizing across every activity list in the scholar portal. */
function ActivityCard({ act, attended, onClick }: { act: SDPActivity; attended: boolean; onClick: () => void }) {
  const pubmat = pubmatUrl(act.pubmatPath);
  const categoryLabel = act.category ? (SDP_CATEGORIES.find(c => c.key === act.category)?.label ?? act.category) : "General";
  const status = activityStatus(act);
  return (
    <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }} onClick={onClick}
      className="w-full bg-white rounded-xl shadow-sm p-3 flex items-start gap-3 text-left hover:shadow-md transition-all border border-gray-100 min-h-[104px]">
      {/* Pubmat (or a default seal when none was uploaded) with the Attended/Ended/Next-schedule mark directly beneath it. */}
      <div className="flex w-16 shrink-0 flex-col items-center gap-1.5">
        <img src={pubmat ?? DefaultPubmat} alt="" className="h-16 w-16 rounded-lg object-cover" />
        {attended ? <AttendedBadge /> : status.ended ? <EndedBadge /> : status.nextDate ? <NextScheduleBadge /> : null}
      </div>

      <div className="min-w-0 flex-1 self-center">
        <p className="font-bold text-[#062444] text-[12.5px] leading-snug line-clamp-2">{act.name}</p>
        {act.organization && <p className="mt-1 text-[11px] text-gray-500 line-clamp-1">{act.organization}</p>}
        {/* A recurring activity with an upcoming occurrence shows THAT date here instead of the (possibly long-past) base dateTime — the next schedule is what a scholar actually needs to see. */}
        {(status.nextDate ?? act.dateTime) && <p className="mt-1 text-[11px] text-gray-400">{formatShortDate(status.nextDate ?? act.dateTime)}</p>}
      </div>

      {/* Category, pinned to the rightmost edge — small square badge instead of a pill so it reads as a tag, not a headline. The credit count sits right below it so a scholar can see at a glance what attending is worth. */}
      <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-md bg-[#0088cc]/10 p-1 text-center text-[#0088cc]">
        <span className="text-[8px] font-bold leading-[1.15]">{categoryLabel}</span>
        <span className="text-[7px] font-semibold text-[#0088cc]/70">{act.credits} credit{act.credits === 1 ? "" : "s"}</span>
      </div>
    </motion.button>
  );
}

const CREDITS_REQUIRED = 3;

/**
 * Per-category progress toward the 3 credits needed to complete it (for
 * the current grading period — see fetch_scholar_sdp_progress()), mirrors
 * the checkmark/circle badges already shown on the scholar's own Profile.
 * Credit above the requirement isn't capped or banked — the count shows
 * the real total (6/3, 4/3).
 */
/** Breaks a two-word category label onto two lines (matches the <br/> already used for these same labels in SDPMonitoringTab's checklist headers) so all three cards wrap the same way instead of "Formation Program" alone staying on one line. */
function twoLineLabel(label: string) {
  const splitAt = label.lastIndexOf(" ");
  if (splitAt === -1) return label;
  return <>{label.slice(0, splitAt)}<br />{label.slice(splitAt + 1)}</>;
}

function CreditProgress({ credits }: { credits: SDPCreditCounts }) {
  return (
    <div className="grid grid-cols-3 gap-1.5 sm:gap-2.5 mb-5">
      {SDP_CATEGORIES.map(c => {
        const count = credits[c.key] ?? 0;
        const complete = count >= CREDITS_REQUIRED;
        return (
          <div key={c.key} className={`rounded-lg sm:rounded-xl border px-1.5 py-1.5 sm:p-3 ${complete ? "bg-green-50 border-green-200" : "bg-[#f7f9fc] border-transparent"}`}>
            <div className="flex items-center justify-between gap-1 mb-1 sm:mb-1.5">
              <span className="text-[8.5px] sm:text-[11px] font-bold text-[#062444] leading-tight line-clamp-2">{twoLineLabel(c.label)}</span>
              {complete && <CheckCircle2 className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-green-600 shrink-0" />}
            </div>
            <div className="flex items-center gap-1 sm:gap-2">
              <div className="flex-1 h-1 sm:h-1.5 rounded-full bg-white overflow-hidden">
                <div className={`h-full rounded-full ${complete ? "bg-green-500" : "bg-[#0088cc]"}`} style={{ width: `${Math.min(100, (count / CREDITS_REQUIRED) * 100)}%` }} />
              </div>
              <span className="text-[8.5px] sm:text-[10.5px] font-bold text-slate-500 shrink-0">{count}/{CREDITS_REQUIRED}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface SDPPanelProps {
  scholarIdNumber: string;
}

/**
 * Cloned from the reference mobile app's SDPPage, adapted to fit inline in
 * this app's panel layout (SectionCard wrapper, our navy/gold tokens) and
 * wired to real Supabase data instead of local mock state. Every SDP
 * activity is staff-created and open to all scholars immediately — scholars
 * can no longer submit their own proposals (that flow, and its
 * pending/approval review step, was removed).
 */
export function SDPPanel({ scholarIdNumber }: SDPPanelProps) {
  const [activities, setActivities] = useState<SDPActivity[]>([]);
  const [attendedIds, setAttendedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [selectedActivity, setSelectedActivity] = useState<SDPActivity | null>(null);
  const [credits, setCredits] = useState<SDPCreditCounts>({ community_service: 0, community_volunteerism: 0, formation_program: 0 });

  async function loadAll() {
    setLoading(true);
    const [a, progress, attended] = await Promise.all([
      fetchApprovedSDPActivities(), fetchScholarSDPProgress(), fetchAttendedSDPActivityIds(scholarIdNumber),
    ]);
    setActivities(a);
    setCredits(progress.credits);
    setAttendedIds(attended);
    setLoading(false);
  }
  useEffect(() => { loadAll(); }, [scholarIdNumber]);

  return (
    <SectionCard icon={<Lightbulb size={14} />} title="Scholars' Development Program (SDP)">
      {!loading && <CreditProgress credits={credits} />}

      <div className="flex items-center gap-2 mb-3">
        <h4 className="text-[#062444] font-bold text-sm flex-1">SDP Activities</h4>
        <span className="text-slate-400 text-xs">{activities.length} item{activities.length !== 1 ? "s" : ""}</span>
      </div>

      <div className="space-y-3">
        {loading ? (
          <p className="text-sm text-slate-400 text-center py-8">Loading…</p>
        ) : activities.length === 0 ? (
          <div className="text-center py-10 text-slate-400 bg-[#f7f9fc] rounded-2xl">
            <ClipboardList className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No SDP activities yet.</p>
          </div>
        ) : (
          activities.map(act => <ActivityCard key={act.id} act={act} attended={attendedIds.has(act.id)} onClick={() => setSelectedActivity(act)} />)
        )}
      </div>

      <AnimatePresence>
        {selectedActivity && <ActivityDetailModal activity={selectedActivity} onClose={() => setSelectedActivity(null)} />}
      </AnimatePresence>
    </SectionCard>
  );
}
