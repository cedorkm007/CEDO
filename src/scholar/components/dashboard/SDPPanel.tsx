import { useEffect, useState } from "react";
import { useLiveReload } from "@/lib/liveUpdates";
import { motion, AnimatePresence } from "motion/react";
import { X, ClipboardList, Lightbulb, CheckCircle2, Camera, Clock3, AlertTriangle } from "lucide-react";
import { SectionCard } from "./SectionCard";
import {
  fetchApprovedSDPActivities, fetchAttendedSDPActivityIds, fetchProgressActivityIds, fetchMyProgressSubmissions, getProgressPictureUrl, type ProgressSubmission, fetchScholarSDPOwed, fetchScholarSDPProgress, fetchScholarSDPRequirements, fetchScholarSDPView, type SDPOwedRow, SDP_CATEGORIES, subCategoryLabel, daySubName, manilaDay, scheduleDays,
  type SDPActivity, type SDPCreditCounts,
} from "../../sdpApi";
import { pubmatUrl } from "@/sead/pubmatApi";
import { termLabelOf } from "@/lib/renewal";
import { DefaultPubmat, AttendedBadge, EndedBadge, NextScheduleBadge, isPastDate, formatShortDate } from "./activityCardKit";
import { ProgressCameraModal } from "./ProgressCameraModal";

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

/** The picture the scholar sent (a link that lasts a few minutes), shown small. */
function MyPicture({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let off = false; void getProgressPictureUrl(path).then(u => { if (!off) setUrl(u); }); return () => { off = true; }; }, [path]);
  return url ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="The picture you sent" className="mt-2 max-h-56 w-full rounded-lg border border-gray-200 object-contain" /></a> : <p className="mt-2 text-[12px] text-gray-400">Loading your picture…</p>;
}

/** The "Capture a Picture" part of an activity that confirms attendance with a picture: what to do, and where the picture is (waiting, approved, rejected). */
function ProgressSection({ ended, submission, onCapture }: { ended: boolean; submission: ProgressSubmission | undefined; onCapture: () => void }) {
  const st = submission?.status;
  return (
    <div className="mt-4 rounded-xl border border-[#0088cc]/30 bg-[#eef6fc] p-3.5" aria-label="Picture confirmation">
      <p className="flex items-center gap-1.5 text-[13px] font-bold text-[#062444]"><Camera className="h-4 w-4" /> This activity is confirmed with a picture</p>
      {st === "approved" ? (
        <>
          <p className="mt-2 flex items-start gap-1.5 text-[13px] font-semibold text-green-800"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> Approved. You are credited for this activity.</p>
          {submission && <MyPicture path={submission.imagePath} />}
        </>
      ) : st === "pending" ? (
        <>
          <p className="mt-2 flex items-start gap-1.5 text-[13px] font-semibold text-amber-800"><Clock3 className="mt-0.5 h-4 w-4 shrink-0" /> Your picture is waiting for approval. You will see the result here.</p>
          {submission && <MyPicture path={submission.imagePath} />}
          {!ended && <button onClick={onCapture} className="mt-3 w-full rounded-lg border border-[#062444]/25 bg-white py-2.5 text-[13px] font-bold text-[#062444]">Take another picture (it replaces this one)</button>}
        </>
      ) : st === "rejected" ? (
        <>
          <p className="mt-2 flex items-start gap-1.5 text-[13px] font-semibold text-red-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Your picture was not approved. Please take a picture again.</p>
          {submission?.rejectReason && <p className="mt-1 text-[13px] text-red-700">Reason: {submission.rejectReason}</p>}
          {!ended && <button onClick={onCapture} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-[#062444] py-3 text-[14px] font-bold text-white"><Camera className="h-4 w-4" /> Capture a Picture</button>}
        </>
      ) : (
        <>
          <p className="mt-2 text-[13px] text-slate-700">To be credited for this activity, take a picture at the activity. Your camera and your location are used: the place, the date and the time are printed on the picture. An evaluator then approves it.</p>
          {ended
            ? <p className="mt-2 text-[13px] font-semibold text-slate-600">This activity has ended, so a picture can no longer be sent.</p>
            : <button onClick={onCapture} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-[#062444] py-3 text-[14px] font-bold text-white"><Camera className="h-4 w-4" /> Capture a Picture</button>}
        </>
      )}
    </div>
  );
}

/**
 * Has the time for the picture passed? The same rule as the database: a picture is accepted any day UNTIL THE LAST DATE of the activity (the whole of that day, Philippine time).
 * (Not the same as the "Ended" mark on the card, which turns on as soon as the activity has started.)
 */
function pictureTimeOver(act: SDPActivity): boolean {
  const last = scheduleDays(act).map(d => d.day).filter(Boolean).sort().pop();
  return !!last && manilaDay(new Date().toISOString()) > last;
}

function ActivityDetailModal({ activity, onClose, progress, scholarIdNumber, onSent }: { activity: SDPActivity; onClose: () => void; progress?: { enabled: boolean; submission: ProgressSubmission | undefined }; scholarIdNumber: string; onSent: () => void }) {
  const [capturing, setCapturing] = useState(false);
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex max-h-[calc(100dvh-2rem)] flex-col" onClick={e => e.stopPropagation()}>
        <div className="bg-[#062444] px-6 py-5 flex shrink-0 items-start justify-between">
          <div>
            <p className="text-[#F3BC00] text-xs font-bold uppercase tracking-wide mb-1">SDP Activity</p>
            <h3 className="font-bold text-white text-xl leading-tight">{activity.name}</h3>
          </div>
          <button onClick={onClose} className="p-1 text-white/60 hover:text-white shrink-0 ml-4"><X className="w-5 h-5" /></button>
        </div>
        {/* Everything between the title and the Close button scrolls, so on a small phone "Capture a Picture" can always be reached. */}
        <div className="min-h-0 flex-1 overflow-y-auto" data-testid="activity-detail-scroll">
        <div className="p-6 space-y-3">
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
        {progress?.enabled && <div className="px-6 pb-3"><ProgressSection ended={pictureTimeOver(activity)} submission={progress.submission} onCapture={() => setCapturing(true)} /></div>}
        </div>
        <div className="shrink-0 px-6 pb-5 pt-2">
          <button onClick={onClose} className="w-full bg-gray-100 text-gray-700 py-2.5 rounded-xl font-bold text-sm">Close</button>
        </div>
      </motion.div>
      {capturing && <div onClick={e => e.stopPropagation()}><ProgressCameraModal activity={activity} scholarIdNumber={scholarIdNumber} onClose={() => setCapturing(false)} onSent={onSent} /></div>}
    </motion.div>
  );
}

/** Same compact card structure as CalendarAndActivitiesPanel's Activities list and SubmissionActivitiesList's collapsed rows — consistent sizing across every activity list in the scholar portal. */
function ActivityCard({ act, attended, onClick, progress }: { act: SDPActivity; attended: boolean; onClick: () => void; progress?: { enabled: boolean; submission: ProgressSubmission | undefined } }) {
  const pubmat = pubmatUrl(act.pubmatPath);
  const categoryLabel = act.category ? (SDP_CATEGORIES.find(c => c.key === act.category)?.label ?? act.category) : "General";
  const status = activityStatus(act);
  // A recurring activity shows the sub-name of the day it is going to happen next ("Day 2 – Bonbon Shoreline"), if that day has one.
  const nextDaySub = status.nextDate ? daySubName(act, manilaDay(status.nextDate)) : "";
  return (
    <button type="button" onClick={onClick} data-testid="sdp-activity-card"
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 104px" }}      /* a card far off the screen is not drawn until the scholar scrolls near it */
      className="w-full bg-white rounded-xl shadow-sm p-3 flex items-start gap-3 text-left hover:shadow-md hover:scale-[1.01] active:scale-[0.99] transition-all border border-gray-100 min-h-[104px]">
      {/* Pubmat (or a default seal when none was uploaded) with the Attended/Ended/Next-schedule mark directly beneath it. */}
      <div className="flex w-16 shrink-0 flex-col items-center gap-1.5">
        <img src={pubmat ?? DefaultPubmat} alt="" loading="lazy" decoding="async" width={64} height={64} className="h-16 w-16 rounded-lg object-cover" />
        {attended ? <AttendedBadge />
          : progress?.enabled && progress.submission?.status === "pending" ? <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800"><Clock3 size={11} /> Waiting</span>
          : progress?.enabled && progress.submission?.status === "rejected" ? <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700"><AlertTriangle size={11} /> Retake</span>
          : progress?.enabled && !pictureTimeOver(act) ? <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#0088cc]/10 px-2 py-0.5 text-[10px] font-bold text-[#0077b6]"><Camera size={11} /> Picture</span>
          : status.ended ? <EndedBadge />
          : status.nextDate ? <NextScheduleBadge /> : null}
      </div>

      <div className="min-w-0 flex-1 self-center">
        <p className="font-bold text-[#062444] text-[12.5px] leading-snug line-clamp-2">{act.name}</p>
        {nextDaySub && <p className="mt-1 text-[11px] font-semibold text-[#0077b6] line-clamp-1">{nextDaySub}</p>}
        {act.organization && <p className="mt-1 text-[11px] text-gray-500 line-clamp-1">{act.organization}</p>}
        {act.subCategory && <p className="mt-1 text-[11px] font-semibold text-[#0088cc] line-clamp-1">{subCategoryLabel(act.subCategory)}</p>}
        {/* A recurring activity with an upcoming occurrence shows THAT date here instead of the (possibly long-past) base dateTime — the next schedule is what a scholar actually needs to see. */}
        {(status.nextDate ?? act.dateTime) && <p className="mt-1 text-[11px] text-gray-400">{formatShortDate(status.nextDate ?? act.dateTime)}</p>}
      </div>

      {/* Category, pinned to the rightmost edge — small square badge instead of a pill so it reads as a tag, not a headline. The credit count sits right below it so a scholar can see at a glance what attending is worth. */}
      <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-md bg-[#0088cc]/10 p-1 text-center text-[#0088cc]">
        <span className="text-[8px] font-bold leading-[1.15]">{categoryLabel}</span>
        <span className="text-[7px] font-semibold text-[#0088cc]/70">{act.credits} credit{act.credits === 1 ? "" : "s"}</span>
      </div>
    </button>
  );
}

const CREDITS_REQUIRED = 3;   // the usual requirement; a scholar whose SDP reconsideration was approved owes more for the next semester (fetchScholarSDPRequirements)

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

/**
 * The credits added to the requirement of the semesters coming, because the scholar's SDP reconsideration was approved: "3 + what was lacking", shown as soon as it is approved
 * (the progress boxes above show the requirement of the CURRENT semester; this semester's requirement appears there when the semester starts).
 */
function ComingRequirement({ rows }: { rows: SDPOwedRow[] }) {
  const semesters = Array.from(new Set(rows.map(r => `${r.schoolYear}|${r.semester}`)));
  return (
    <div className="-mt-3 mb-4 space-y-2" aria-label="Credits added to your SDP requirement for the coming semester">
      {semesters.map(key => {
        const [schoolYear, semester] = key.split("|");
        const mine = rows.filter(r => r.schoolYear === schoolYear && r.semester === semester);
        const total = mine.reduce((n, r) => n + r.amount, 0);
        return (
          <div key={key} className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-2.5 text-[13px] text-sky-950">
            <p className="font-bold">Added to your SDP requirement for {termLabelOf(schoolYear, semester)}: {total} credit{total === 1 ? "" : "s"}</p>
            <p>Your SDP reconsideration was approved, so the credits you lacked are added to the requirement of that semester. It shows in the boxes above when that semester starts.</p>
            <ul className="mt-1 list-disc pl-5">
              {mine.map(r => <li key={r.category}>{SDP_CATEGORIES.find(c => c.key === r.category)?.label ?? r.category}: {CREDITS_REQUIRED} + {r.amount} = <strong>{CREDITS_REQUIRED + r.amount} credits</strong></li>)}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function CreditProgress({ credits, required }: { credits: SDPCreditCounts; required: SDPCreditCounts }) {
  return (
    <div className="grid grid-cols-3 gap-1.5 sm:gap-2.5 mb-5">
      {SDP_CATEGORIES.map(c => {
        const count = credits[c.key] ?? 0;
        const need = required[c.key] ?? CREDITS_REQUIRED;   // 3, plus credits owed after an approved SDP reconsideration
        const complete = count >= need;
        return (
          <div key={c.key} className={`rounded-lg sm:rounded-xl border px-1.5 py-1.5 sm:p-3 ${complete ? "bg-green-50 border-green-200" : "bg-[#f7f9fc] border-transparent"}`}>
            <div className="flex items-center justify-between gap-1 mb-1 sm:mb-1.5">
              <span className="text-[8.5px] sm:text-[11px] font-bold text-[#062444] leading-tight line-clamp-2">{twoLineLabel(c.label)}</span>
              {complete && <CheckCircle2 className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-green-600 shrink-0" />}
            </div>
            <div className="flex items-center gap-1 sm:gap-2">
              <div className="flex-1 h-1 sm:h-1.5 rounded-full bg-white overflow-hidden">
                <div className={`h-full rounded-full ${complete ? "bg-green-500" : "bg-[#0088cc]"}`} style={{ width: `${Math.min(100, (count / need) * 100)}%` }} />
              </div>
              <span className="text-[8.5px] sm:text-[10.5px] font-bold text-slate-500 shrink-0">{count}/{need}</span>
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
/** The last list this scholar saw in this visit: shown at once when the tab is opened again, then refreshed quietly (so coming back to the tab is instant). */
let sdpListMemory: { scholar: string; activities: SDPActivity[]; attended: Set<string> } | null = null;

export function SDPPanel({ scholarIdNumber }: SDPPanelProps) {
  const remembered = sdpListMemory && sdpListMemory.scholar === scholarIdNumber ? sdpListMemory : null;
  const [activities, setActivities] = useState<SDPActivity[]>(remembered?.activities ?? []);
  const [attendedIds, setAttendedIds] = useState<Set<string>>(remembered?.attended ?? new Set());
  const [loading, setLoading] = useState(!remembered);
  const [creditsLoading, setCreditsLoading] = useState(true);      // the credit boxes can arrive after the list
  const [selectedActivity, setSelectedActivity] = useState<SDPActivity | null>(null);
  // activities that confirm attendance with a picture, and this scholar's own pictures
  const [progressIds, setProgressIds] = useState<Set<string>>(new Set());
  const [submissions, setSubmissions] = useState<Map<string, ProgressSubmission>>(new Map());
  const [credits, setCredits] = useState<SDPCreditCounts>({ community_service: 0, community_volunteerism: 0, formation_program: 0 });
  const [required, setRequired] = useState<SDPCreditCounts>({ community_service: CREDITS_REQUIRED, community_volunteerism: CREDITS_REQUIRED, formation_program: CREDITS_REQUIRED });
  // credits added to the requirement of the semesters AFTER the current one (an approved SDP reconsideration), shown as soon as it is approved
  const [coming, setComing] = useState<SDPOwedRow[]>([]);
  // set once the scholar is renewed: the boxes then show the NEXT semester (3 credits per category used, the rest carried on)
  const [nextSemester, setNextSemester] = useState<{ schoolYear: string; semester: string } | null>(null);

  // Everything is asked at the same moment, but each part is shown as soon as it arrives: the list of activities does not wait for the credit boxes (which take the longest to work out).
  async function loadAll(quiet = false) {
    if (!quiet && !sdpListMemory) setLoading(true);
    const listPart = Promise.all([fetchApprovedSDPActivities(), fetchAttendedSDPActivityIds(scholarIdNumber), fetchProgressActivityIds(), fetchMyProgressSubmissions()]).then(([a, attended, pIds, pSubs]) => {
      setActivities(a); setAttendedIds(attended); setProgressIds(pIds); setSubmissions(pSubs);
      sdpListMemory = { scholar: scholarIdNumber, activities: a, attended };
      setLoading(false);
    });
    const creditsPart = Promise.all([fetchScholarSDPProgress(), fetchScholarSDPRequirements(), fetchScholarSDPOwed(), fetchScholarSDPView()]).then(([progress, req, owed, view]) => {
      setNextSemester(view?.shifted ? { schoolYear: view.schoolYear, semester: view.semester } : null);
      setComing(owed.filter(o => !o.isCurrent));
      setCredits(progress.credits);
      setRequired(req);
      setCreditsLoading(false);
    });
    await Promise.all([listPart, creditsPart]);
  }
  useEffect(() => { loadAll(); }, [scholarIdNumber]);
  useLiveReload(() => loadAll(true));      // new credits, a changed requirement: show them without refreshing
  // while a picture waits for approval, look again every 20 seconds so the answer (approved / rejected) shows without refreshing
  const anyWaiting = Array.from(submissions.values()).some(x => x.status === "pending");
  useEffect(() => {
    if (!anyWaiting) return;
    const t = setInterval(() => { void loadAll(true); }, 20_000);
    return () => clearInterval(t);
  }, [anyWaiting]);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <SectionCard icon={<Lightbulb size={14} />} title="Scholars' Development Program (SDP)">
      {!creditsLoading && nextSemester && (
        <p className="mb-3 rounded-lg border border-[#0077b6]/40 bg-[#eef6fc] px-3 py-2 text-[13px] text-[#062444]" role="status">
          <strong>You are renewed.</strong> The boxes below show your SDP for {termLabelOf(nextSemester.schoolYear, nextSemester.semester)}: 3 credits per category were used for the semester that was renewed, credits above that carry on, and any credits you lacked are added to the requirement.
        </p>
      )}
      {creditsLoading ? <div className="mb-5 grid grid-cols-3 gap-2" aria-hidden="true">{[0, 1, 2].map(i => <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />)}</div> : <CreditProgress credits={credits} required={required} />}
      {!creditsLoading && SDP_CATEGORIES.some(c => (required[c.key] ?? CREDITS_REQUIRED) > CREDITS_REQUIRED) && (
        <p className="-mt-3 mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">Part of this semester's requirement is credit that was lacking last semester and was added after your SDP reconsideration was approved.</p>
      )}

      {!creditsLoading && coming.length > 0 && <ComingRequirement rows={coming} />}

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
          activities.map(act => <ActivityCard key={act.id} act={act} attended={attendedIds.has(act.id)} onClick={() => setSelectedActivity(act)} progress={{ enabled: progressIds.has(act.id), submission: submissions.get(act.id) }} />)
        )}
      </div>

      <AnimatePresence>
        {selectedActivity && <ActivityDetailModal activity={selectedActivity} onClose={() => setSelectedActivity(null)} scholarIdNumber={scholarIdNumber} onSent={() => void loadAll(true)}
          progress={{ enabled: progressIds.has(selectedActivity.id), submission: submissions.get(selectedActivity.id) }} />}
      </AnimatePresence>
    </SectionCard>
  );
}
