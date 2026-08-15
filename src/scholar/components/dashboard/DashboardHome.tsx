import { User, BookMarked, Briefcase, Lightbulb, Calendar as CalendarIcon, Trophy } from "lucide-react";
import type { DashPanelKey } from "./types";

const WIDGETS: { key: DashPanelKey; label: string; icon: React.ReactNode }[] = [
  { key: "profile", label: "Profile", icon: <User size={28} /> },
  { key: "quests", label: "Quests", icon: <Trophy size={28} /> },
  { key: "subjects-grades", label: "Subjects and Grades", icon: <BookMarked size={28} /> },
  { key: "services", label: "Forms and Services", icon: <Briefcase size={28} /> },
  { key: "sdp", label: "Scholars' Development Program", icon: <Lightbulb size={28} /> },
  { key: "calendar", label: "Calendar and Activities", icon: <CalendarIcon size={28} /> },
];

export function DashboardHome({ onOpen }: { onOpen: (panel: DashPanelKey) => void }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3.5 max-w-[640px]">
      {WIDGETS.map(w => (
        <button
          key={w.key}
          onClick={() => onOpen(w.key)}
          className="group flex flex-col items-center justify-center gap-3.5 aspect-square rounded-[18px] bg-white border border-[#e6ecf5] shadow-[0_4px_14px_rgba(6,36,68,0.08)] hover:shadow-[0_12px_26px_rgba(6,36,68,0.15)] hover:border-[#cfe0f5] hover:-translate-y-1 transition-all p-5 text-center"
        >
          <span className="w-16 h-16 rounded-2xl bg-[#eef3fb] group-hover:bg-[#062444] text-[#062444] group-hover:text-[#F3BC00] flex items-center justify-center transition-colors">
            {w.icon}
          </span>
          <span className="text-[13.5px] font-bold text-[#062444] leading-snug">{w.label}</span>
        </button>
      ))}
    </div>
  );
}
