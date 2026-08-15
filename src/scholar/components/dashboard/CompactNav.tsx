import { Home, User, BookMarked, Briefcase, Lightbulb, Calendar as CalendarIcon, Trophy } from "lucide-react";
import type { DashPanelKey } from "./types";

const PILLS: { key: DashPanelKey; label: string; icon: React.ReactNode }[] = [
  { key: "profile", label: "Profile", icon: <User size={14} /> },
  { key: "quests", label: "Quests", icon: <Trophy size={14} /> },
  { key: "subjects-grades", label: "Subjects & Grades", icon: <BookMarked size={14} /> },
  { key: "services", label: "Forms & Services", icon: <Briefcase size={14} /> },
  { key: "sdp", label: "SDP", icon: <Lightbulb size={14} /> },
  { key: "calendar", label: "Calendar & Activities", icon: <CalendarIcon size={14} /> },
];

interface CompactNavProps {
  active: DashPanelKey;
  onSelect: (panel: DashPanelKey) => void;
  onHome: () => void;
}

export function CompactNav({ active, onSelect, onHome }: CompactNavProps) {
  return (
    <div className="flex items-center gap-2.5 bg-white border border-[#e6ecf5] rounded-[14px] shadow-[0_2px_10px_rgba(6,36,68,0.06)] p-2.5 mb-5 sticky top-[76px] z-10">
      <button
        onClick={onHome}
        title="Back to Home"
        className="shrink-0 w-10 h-10 rounded-[10px] bg-[#062444] hover:bg-[#0a3a6e] text-[#F3BC00] flex items-center justify-center transition-colors"
      >
        <Home size={17} />
      </button>
      <div className="flex gap-2 overflow-x-auto flex-1">
        {PILLS.map(p => (
          <button
            key={p.key}
            onClick={() => onSelect(p.key)}
            className={`flex items-center gap-1.5 shrink-0 px-3 py-2 rounded-[10px] border text-[12.5px] font-bold whitespace-nowrap transition-colors ${
              active === p.key
                ? "bg-[#062444] border-[#062444] text-white [&_svg]:text-[#F3BC00]"
                : "bg-[#f7f9fc] border-[#e6ecf5] text-[#062444] hover:bg-[#eef3fb]"
            }`}
          >
            {p.icon}
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
