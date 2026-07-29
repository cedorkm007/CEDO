import { Trophy, Calculator, FlaskConical, Monitor, Type, BookCheck, Info } from "lucide-react";
import { SectionCard } from "./SectionCard";
import type { QuestScore } from "../../types";

const COMING_SOON_SUBJECTS = [
  { label: "English", icon: <Type size={22} /> },
  { label: "Mathematics", icon: <Calculator size={22} /> },
  { label: "Science", icon: <FlaskConical size={22} /> },
  { label: "ICT", icon: <Monitor size={22} /> },
  { label: "FIOGET Coursework", icon: <BookCheck size={22} /> },
];

export function QuestsPanel({ scores }: { scores: QuestScore[] }) {
  return (
    <SectionCard icon={<Trophy size={14} />} title="Academic Quests">
      {scores.length > 0 && (
        <div className="mb-7">
          <p className="text-[10.5px] font-bold uppercase tracking-[1.2px] text-[#0088cc] mb-3">Your Quest History</p>
          <div className="space-y-2">
            {scores.map(s => (
              <div key={s.id} className="flex items-center justify-between bg-[#f8fafd] border border-[#e8edf2] rounded-lg px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-[#062444]">{s.questName}</p>
                  <p className="text-xs text-slate-400">{s.dateTaken ?? "—"}{s.remarks ? ` · ${s.remarks}` : ""}</p>
                </div>
                <span className="text-sm font-bold text-[#062444]">
                  {s.score ?? "—"}{s.maxScore ? ` / ${s.maxScore}` : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h4 className="text-[15px] font-extrabold text-[#062444] mb-1">Choose a subject</h4>
        <p className="text-sm text-slate-400 mb-5">Test your academic knowledge and track your progress.</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {COMING_SOON_SUBJECTS.map(s => (
            <div
              key={s.label}
              className="flex flex-col items-center justify-center gap-2 aspect-[1/0.85] rounded-2xl border border-[#e6ecf5] bg-white opacity-70 px-3 text-center"
            >
              <span className="w-12 h-12 rounded-xl bg-[#eef3fb] flex items-center justify-center text-[#062444]">{s.icon}</span>
              <span className="text-[13px] font-bold text-[#062444]">{s.label}</span>
              <span className="text-[11px] text-slate-400 font-medium">Under Development</span>
            </div>
          ))}
        </div>
        {scores.length === 0 && (
          <p className="text-[13px] text-slate-400 italic flex items-center gap-1.5 mt-5">
            <Info size={13} /> No quest scores yet — new quests are coming soon.
          </p>
        )}
      </div>
    </SectionCard>
  );
}
