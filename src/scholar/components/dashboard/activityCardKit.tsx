import { CheckCircle2, History, CalendarClock } from "lucide-react";
import DefaultPubmat from "@/imports/CEDO_Seal.png";

/**
 * Shared building blocks for the compact activity-card layout used by
 * CalendarAndActivitiesPanel's Activities list, SDPPanel's SDP Activities
 * list, and SubmissionActivitiesList's collapsed rows — pubmat (or this
 * default seal) + a status mark beneath it, so all three lists look and
 * behave the same way.
 */
export { DefaultPubmat };

/** Small green "Attended" mark shown beneath an activity's pubmat. */
export function AttendedBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-bold text-emerald-700">
      <CheckCircle2 size={11} /> Attended
    </span>
  );
}

/** Neutral gray "Ended" mark for a passed-but-unattended date — distinct from Attended so a scholar can tell "this already happened and I missed it" apart from "I was there." */
export function EndedBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-bold text-slate-500">
      <History size={11} /> Ended
    </span>
  );
}

/** Blue "Next Schedule" mark for a recurring activity that still has an upcoming occurrence — distinct from Ended, since the series as a whole isn't finished even though its base date (or an earlier occurrence) already passed. The card's own date line shows the actual next date; this badge is just the status tag. */
export function NextScheduleBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#0088cc]/10 px-2 py-0.5 text-[5.25px] font-bold text-[#0088cc]">
      <CalendarClock size={18} /> Next Schedule
    </span>
  );
}

const MONTH_ABBR = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "Jun.", "Jul.", "Aug.", "Sep.", "Oct.", "Nov.", "Dec."];

/** Formats a date as "Dec. 9, 2026" — used everywhere an activity date is shown in the scholar portal, instead of the locale-dependent toLocaleDateString() shorthand (e.g. "12/9/2026"). */
export function formatShortDate(dateTime: string): string {
  const d = new Date(dateTime);
  return `${MONTH_ABBR[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** Whether a given ISO date string is already in the past — the pure "has this date happened" check, with no recurring-activity exemption (contrast with a sort-only "finished" check, which does exempt recurring activities so an ongoing series doesn't sink in the list just because one date passed). */
export function isPastDate(dateTime: string): boolean {
  return !!dateTime && new Date(dateTime).getTime() < Date.now();
}
