import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { Calendar as CalendarIcon, ClipboardList, QrCode, ChevronLeft, ChevronRight, MapPin, CheckCircle2, History } from "lucide-react";
import { SectionCard } from "./SectionCard";
import { AttendanceScanner } from "./AttendanceScanner";
import { fetchApprovedSDPActivities, fetchAttendedSDPActivityIds, SDP_CATEGORIES, type SDPActivity } from "../../sdpApi";
import { fetchFormationActivitiesForScholar, fetchAttendedFormationActivityIds } from "../../formationActivitiesApi";
import { SubmissionActivitiesList } from "./SubmissionActivitiesList";
import { useUrlState } from "@/app/useUrlState";
import { pubmatUrl } from "@/sead/pubmatApi";
import DefaultPubmat from "@/imports/CEDO_Seal.png";

type Tab = "calendar" | "activities" | "attendance";
const TABS: readonly Tab[] = ["calendar", "activities", "attendance"];

type CalendarActivity = {
  id: string;
  name: string;
  shortDescription: string;
  dateTime: string;
  endTime: string | null;
  venue: string;
  label: string;
  attendanceEnabled: boolean;
  pubmatUrl: string | null;
  attended: boolean;
  // "Finished" (not attended, but no longer actionable) only applies to a
  // non-recurring activity whose date has passed — a recurring SDP
  // activity's occurrences never count as finished even once past, since
  // more occurrences may still be coming. Formation activities are never
  // recurring at all.
  isRecurring: boolean;
};

function isFinished(a: CalendarActivity): boolean {
  return !a.isRecurring && !!a.dateTime && new Date(a.dateTime).getTime() < Date.now();
}

/** Active items first (soonest first), attended/finished items sink to the bottom (most-recent first) — mirrors the same "done things sink" ordering used for Submission Activities. */
function sortActivities(items: CalendarActivity[]): CalendarActivity[] {
  const active = items.filter(a => !a.attended && !isFinished(a)).sort((a, b) => a.dateTime.localeCompare(b.dateTime));
  const done = items.filter(a => a.attended || isFinished(a)).sort((a, b) => b.dateTime.localeCompare(a.dateTime));
  return [...active, ...done];
}

/** Small green "Attended" mark, reused by both the Activities list and the Calendar's day-detail rows. */
function AttendedBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-bold text-emerald-700">
      <CheckCircle2 size={11} /> Attended
    </span>
  );
}

/** Neutral gray "Ended" mark for a finished-but-unattended activity (see isFinished) — distinct from Attended so a scholar can tell "this already happened and I missed it" apart from "I was there." */
function EndedBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-bold text-slate-500">
      <History size={11} /> Ended
    </span>
  );
}

function categoryLabel(category: SDPActivity["category"]): string {
  return SDP_CATEGORIES.find(c => c.key === category)?.label ?? "General";
}

function CalendarGrid({ activities }: { activities: CalendarActivity[] }) {
  const [monthCursor, setMonthCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const activitiesByDate = useMemo(() => {
    const map = new Map<string, CalendarActivity[]>();
    for (const a of activities) {
      if (!a.dateTime) continue;
      const key = a.dateTime.slice(0, 10); // YYYY-MM-DD
      map.set(key, [...(map.get(key) ?? []), a]);
    }
    return map;
  }, [activities]);

  /** First pubmat found among a day's activities, if any — shown on the day cell in place of the plain dot. */
  function pubmatForDay(dayActivities: CalendarActivity[]): string | null {
    return dayActivities.find(a => a.pubmatUrl)?.pubmatUrl ?? null;
  }

  const year = monthCursor.getFullYear();
  const month = monthCursor.getMonth();
  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = new Date().toISOString().slice(0, 10);

  const cells: (number | null)[] = [
    ...Array(firstDayOfWeek).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  function dateKey(day: number) {
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const selectedEvents = selectedDate ? (activitiesByDate.get(selectedDate) ?? []) : [];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => setMonthCursor(new Date(year, month - 1, 1))} className="w-8 h-8 rounded-lg border border-[#e6ecf5] flex items-center justify-center text-slate-500 hover:bg-[#f8fafd]">
          <ChevronLeft size={16} />
        </button>
        <p className="text-[14px] font-bold text-[#062444]">{monthCursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</p>
        <button onClick={() => setMonthCursor(new Date(year, month + 1, 1))} className="w-8 h-8 rounded-lg border border-[#e6ecf5] flex items-center justify-center text-slate-500 hover:bg-[#f8fafd]">
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-1">
        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(d => (
          <p key={d} className="text-center text-[10.5px] font-bold text-slate-400 py-1">{d}</p>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (day === null) return <div key={i} />;
          const key = dateKey(day);
          const dayActivities = activitiesByDate.get(key) ?? [];
          const hasEvents = dayActivities.length > 0;
          const dayPubmat = pubmatForDay(dayActivities);
          const isToday = key === todayKey;
          const isSelected = key === selectedDate;
          return (
            <button key={i} onClick={() => setSelectedDate(hasEvents ? key : null)}
              className={`aspect-square rounded-lg text-[12.5px] font-semibold flex flex-col items-center justify-center gap-0.5 transition-colors ${
                isSelected ? "bg-[#062444] text-white" : isToday ? "bg-[#eef3fb] text-[#062444]" : "text-slate-600 hover:bg-[#f8fafd]"
              }`}>
              {day}
              {hasEvents && (
                dayPubmat ? (
                  <motion.img
                    src={dayPubmat} alt="" className="w-4 h-4 rounded-full object-cover ring-1 ring-white/70"
                    animate={{
                      scale: [1, 1.3, 1],
                      boxShadow: ["0 0 0 0 rgba(243,188,0,0)", "0 0 6px 3px rgba(243,188,0,0.9)", "0 0 0 0 rgba(243,188,0,0)"],
                    }}
                    transition={{ duration: 0.9, repeat: Infinity, repeatDelay: 4.1, ease: "easeInOut" }}
                  />
                ) : (
                  <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? "bg-[#F3BC00]" : "bg-[#0088cc]"}`} />
                )
              )}
            </button>
          );
        })}
      </div>

      {selectedDate && (
        <div className="mt-4 border-t border-[#f0f3f8] pt-3 space-y-2">
          <p className="text-[11px] font-semibold text-slate-400 uppercase">{new Date(selectedDate).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>
          {selectedEvents.map(a => (
            <div key={a.id} className="bg-[#f8fafd] rounded-lg px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[13px] font-bold text-[#062444]">{a.name}</p>
                {a.attended ? <AttendedBadge /> : isFinished(a) && <EndedBadge />}
              </div>
              <p className="text-[11.5px] text-slate-400">{a.label} {a.venue && `· ${a.venue}`}</p>
              {a.shortDescription && <p className="mt-1 text-[11.5px] text-slate-500">{a.shortDescription}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActivitiesList({ activities }: { activities: CalendarActivity[] }) {
  if (activities.length === 0) return <p className="text-[13px] text-slate-400 italic">No upcoming activities right now.</p>;
  return (
    <div className="space-y-2.5">
      {activities.map(a => (
        <div key={a.id} className="bg-[#f8fafd] border border-[#e6ecf5] rounded-xl p-3 flex items-start gap-3 min-h-[104px]">
          {/* Pubmat (or a default seal when none was uploaded) with the Attended/Ended mark directly beneath it. */}
          <div className="flex w-16 shrink-0 flex-col items-center gap-1.5">
            <img src={a.pubmatUrl ?? DefaultPubmat} alt="" className="h-16 w-16 rounded-lg object-cover" />
            {a.attended ? <AttendedBadge /> : isFinished(a) && <EndedBadge />}
          </div>

          <div className="min-w-0 flex-1 self-center">
            <p className="text-[12.5px] font-bold leading-snug text-[#062444] line-clamp-2">{a.name}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-slate-500">
              {a.dateTime && <span>{new Date(a.dateTime).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{a.endTime && ` – ${new Date(a.endTime).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`}</span>}
              {a.venue && <span className="flex items-center gap-1"><MapPin size={11} /> {a.venue}</span>}
            </div>
            {a.attendanceEnabled && <p className="mt-1 text-[10.5px] font-semibold text-[#0088cc]">Attendance monitoring included</p>}
            {a.shortDescription && <p className="mt-1 text-[11px] text-slate-500 line-clamp-2">{a.shortDescription}</p>}
          </div>

          {/* Category/type, pinned to the rightmost edge — small square badge instead of a pill so it reads as a tag, not a headline. */}
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-[#0088cc]/10 p-1 text-center text-[8px] font-bold leading-[1.15] text-[#0088cc]">
            {a.label}
          </div>
        </div>
      ))}
    </div>
  );
}

export function CalendarAndActivitiesPanel({ scholarIdNumber, onNavigateToForms }: { scholarIdNumber: string; onNavigateToForms: () => void }) {
  const [tab, setTab] = useUrlState<Tab>("calTab", "calendar", TABS);
  const [activities, setActivities] = useState<CalendarActivity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetchApprovedSDPActivities(), fetchFormationActivitiesForScholar(),
      fetchAttendedSDPActivityIds(scholarIdNumber), fetchAttendedFormationActivityIds(scholarIdNumber),
    ]).then(([sdpActivities, formationActivities, attendedSdpIds, attendedFormationIds]) => {
      const sdp = sdpActivities.flatMap(activity => {
        const shared = {
          name: activity.name, shortDescription: activity.rationale ?? "", endTime: null,
          label: categoryLabel(activity.category), attendanceEnabled: false, pubmatUrl: pubmatUrl(activity.pubmatPath),
          attended: attendedSdpIds.has(activity.id), isRecurring: activity.activityType === "recurring",
        };
        const entries: CalendarActivity[] = [];
        if (activity.dateTime) entries.push({ id: `sdp-${activity.id}`, dateTime: activity.dateTime, venue: activity.venue, ...shared });
        // Recurring activities can accumulate occurrence dates over time (added by
        // staff from the activity's details), each with its own venue since a
        // recurring activity's venue can change between sessions — each becomes
        // its own calendar entry alongside the original dateTime.
        activity.recurringDates.forEach((occurrence, index) => {
          entries.push({ id: `sdp-${activity.id}-occ-${index}`, dateTime: occurrence.date, venue: occurrence.venue || activity.venue, ...shared });
        });
        return entries;
      });
      const formation = formationActivities.map(activity => ({
        id: `formation-${activity.id}`, name: activity.name, shortDescription: activity.shortDescription, dateTime: activity.dateTime,
        endTime: activity.endTime, venue: activity.venue, label: "Formation Activity", attendanceEnabled: activity.attendanceEnabled,
        pubmatUrl: pubmatUrl(activity.pubmatPath), attended: attendedFormationIds.has(activity.id), isRecurring: false,
      }));
      setActivities(sortActivities([...sdp, ...formation]));
      setLoading(false);
    });
  }, [scholarIdNumber]);

  return (
    <SectionCard icon={<CalendarIcon size={14} />} title="Calendar and Activities">
      <div className="flex gap-2 mb-5">
        <button onClick={() => setTab("calendar")}
          className={`flex flex-1 items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-[12.5px] font-bold ${tab === "calendar" ? "bg-[#062444] text-white" : "bg-[#f7f9fc] text-slate-500 hover:bg-[#eef3fb]"}`}>
          <CalendarIcon size={14} className="shrink-0" /> Calendar
        </button>
        <button onClick={() => setTab("activities")}
          className={`flex flex-1 items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-[12.5px] font-bold ${tab === "activities" ? "bg-[#062444] text-white" : "bg-[#f7f9fc] text-slate-500 hover:bg-[#eef3fb]"}`}>
          <ClipboardList size={14} className="shrink-0" /> Activities
        </button>
        <button onClick={() => setTab("attendance")}
          className={`flex flex-1 items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-[12.5px] font-bold ${tab === "attendance" ? "bg-[#062444] text-white" : "bg-[#f7f9fc] text-slate-500 hover:bg-[#eef3fb]"}`}>
          <QrCode size={14} className="shrink-0" /> Attendance
        </button>
      </div>

      {loading ? (
        <p className="text-[13px] text-slate-400">Loading…</p>
      ) : tab === "calendar" ? (
        <CalendarGrid activities={activities} />
      ) : tab === "activities" ? (
        <>
          <SubmissionActivitiesList />
          <ActivitiesList activities={activities} />
        </>
      ) : (
        <AttendanceScanner onNavigateToForms={onNavigateToForms} />
      )}
    </SectionCard>
  );
}
