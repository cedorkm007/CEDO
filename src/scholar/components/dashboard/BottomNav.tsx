import { motion } from "motion/react";
import { BookMarked, Trophy, Briefcase, Lightbulb, Calendar as CalendarIcon } from "lucide-react";
import type { DashPanelKey } from "./types";

interface BottomNavProps {
  active: DashPanelKey | null;
  onSelect: (panel: DashPanelKey) => void;
}

const NAV_ITEMS: { key: DashPanelKey; label: string; icon: React.ReactNode }[] = [
  { key: "quests", label: "Quests", icon: <Trophy className="w-5 h-5" /> },
  { key: "subjects-grades", label: "Grades", icon: <BookMarked className="w-5 h-5" /> },
  { key: "services", label: "Forms", icon: <Briefcase className="w-5 h-5" /> },
  { key: "sdp", label: "SDP", icon: <Lightbulb className="w-5 h-5" /> },
  { key: "calendar", label: "Calendar", icon: <CalendarIcon className="w-5 h-5" /> },
];

/**
 * Persistent mobile tab bar. Home and Profile live in MobilePortalHeader
 * instead (top-left button / top-right popup), so this only covers the
 * remaining 5 panels — matches the reference app's tap/hover interactivity
 * (gold active pill, scale on hover/tap). Desktop keeps using CompactNav.
 */
export function BottomNav({ active, onSelect }: BottomNavProps) {
  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white shadow-[0_-2px_10px_rgba(6,36,68,0.08)] border-t border-[#e6ecf5] z-30">
      <div className="flex justify-around items-center py-2 px-1 max-w-md mx-auto">
        {NAV_ITEMS.map(item => {
          const isActive = active === item.key;
          return (
            <motion.button
              key={item.key}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => onSelect(item.key)}
              className={`flex flex-col items-center gap-0.5 px-3 py-2 rounded-xl transition-colors ${
                isActive ? "bg-[#F3BC00]" : "bg-transparent"
              }`}
            >
              <span className={isActive ? "text-[#062444]" : "text-slate-400"}>{item.icon}</span>
              <span className={`text-[11px] ${isActive ? "text-[#062444] font-bold" : "text-slate-400"}`}>
                {item.label}
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
