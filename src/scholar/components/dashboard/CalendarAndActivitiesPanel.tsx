import { useEffect, useMemo, useState } from "react";
import { Calendar as CalendarIcon, ClipboardList, QrCode, ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import { SectionCard } from "./SectionCard";
import { AttendanceScanner } from "./AttendanceScanner";
import { fetchApprovedSDPActivities, SDP_CATEGORIES, type SDPActivity } from "../../sdpApi";

type Tab = "calendar" | "activities" | "attendance";

function categoryLabel(category: SDPActivity["category"]): string {
  return SDP_CATEGORIES.find(c => c.key === category)?.label ?? "General";
}

function CalendarGrid({ activities }: { activities: SDPActivity[] }) {
  const [monthCursor, setMonthCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const activitiesByDate = useMemo(() => {
    const map = new Map<string, SDPActivity[]>();
    for (const a of activities) {
      if (!a.dateTime) continue;
      const key = a.dateTime.slice(0, 10); // YYYY-MM-DD
      map.set(key, [...(map.get(key) ?? []), a]);
    }
    return map;
  }, [activities]);

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
          const hasEvents = activitiesByDate.has(key);
          const isToday = key === todayKey;
          const isSelected = key === selectedDate;
          return (
            <button key={i} onClick={() => setSelectedDate(hasEvents ? key : null)}
              className={`aspect-square rounded-lg text-[12.5px] font-semibold flex flex-col items-center justify-center gap-0.5 transition-colors ${
                isSelected ? "bg-[#062444] text-white" : isToday ? "bg-[#eef3fb] text-[#062444]" : "text-slate-600 hover:bg-[#f8fafd]"
              }`}>
              {day}
              {hasEvents && <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? "bg-[#F3BC00]" : "bg-[#0088cc]"}`} />}
            </button>
          );
        })}
      </div>

      {selectedDate && (
        <div className="mt-4 border-t border-[#f0f3f8] pt-3 space-y-2">
          <p className="text-[11px] font-semibold text-slate-400 uppercase">{new Date(selectedDate).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>
          {selectedEvents.map(a => (
            <div key={a.id} className="bg-[#f8fafd] rounded-lg px-3 py-2.5">
              <p className="text-[13px] font-bold text-[#062444]">{a.name}</p>
              <p className="text-[11.5px] text-slate-400">{categoryLabel(a.category)} {a.venue && `· ${a.venue}`}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActivitiesList({ activities }: { activities: SDPActivity[] }) {
  if (activities.length === 0) return <p className="text-[13px] text-slate-400 italic">No upcoming activities right now.</p>;
  return (
    <div className="space-y-2.5">
      {activities.map(a => (
        <div key={a.id} className="bg-[#f8fafd] border border-[#e6ecf5] rounded-xl px-4 py-3">
          <div className="flex items-start justify-between gap-2 mb-1">
            <p className="text-[13.5px] font-bold text-[#062444]">{a.name}</p>
            <span className="shrink-0 text-[10.5px] font-bold text-[#0088cc] bg-[#0088cc]/10 rounded-full px-2 py-0.5">{categoryLabel(a.category)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-slate-500">
            {a.dateTime && <span>{new Date(a.dateTime).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>}
            {a.venue && <span className="flex items-center gap-1"><MapPin size={11} /> {a.venue}</span>}
            {a.organization && <span>{a.organization}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function CalendarAndActivitiesPanel() {
  const [tab, setTab] = useState<Tab>("calendar");
  const [activities, setActivities] = useState<SDPActivity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchApprovedSDPActivities().then(a => { setActivities(a); setLoading(false); });
  }, []);

  return (
    <SectionCard icon={<CalendarIcon size={14} />} title="Calendar and Activities">
      <div className="flex gap-2 mb-5">
        <button onClick={() => setTab("calendar")}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12.5px] font-bold ${tab === "calendar" ? "bg-[#062444] text-white" : "bg-[#f7f9fc] text-slate-500 hover:bg-[#eef3fb]"}`}>
          <CalendarIcon size={14} /> Calendar
        </button>
        <button onClick={() => setTab("activities")}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12.5px] font-bold ${tab === "activities" ? "bg-[#062444] text-white" : "bg-[#f7f9fc] text-slate-500 hover:bg-[#eef3fb]"}`}>
          <ClipboardList size={14} /> Activities
        </button>
        <button onClick={() => setTab("attendance")}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12.5px] font-bold ${tab === "attendance" ? "bg-[#062444] text-white" : "bg-[#f7f9fc] text-slate-500 hover:bg-[#eef3fb]"}`}>
          <QrCode size={14} /> Attendance
        </button>
      </div>

      {loading ? (
        <p className="text-[13px] text-slate-400">Loading…</p>
      ) : tab === "calendar" ? (
        <CalendarGrid activities={activities} />
      ) : tab === "activities" ? (
        <ActivitiesList activities={activities} />
      ) : (
        <AttendanceScanner />
      )}
    </SectionCard>
  );
}
