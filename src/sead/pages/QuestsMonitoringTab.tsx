import { useState } from "react";
import { BarChart3, Trophy } from "lucide-react";
import { ScoresTab } from "./ScoresTab";
import { RankingsTab } from "./RankingsTab";

export function QuestsMonitoringTab() {
  const [tab, setTab] = useState<"scores" | "rankings">("scores");

  return (
    <div>
      <div className="flex gap-1 border-b border-[#e6ecf5] mb-5">
        <button onClick={() => setTab("scores")} className={`flex items-center gap-1.5 px-3 py-2 text-[12.5px] font-bold border-b-2 ${tab === "scores" ? "border-[#0088cc] text-[#062444]" : "border-transparent text-slate-400 hover:text-[#062444]"}`}>
          <BarChart3 size={14} /> Scores &amp; Progress
        </button>
        <button onClick={() => setTab("rankings")} className={`flex items-center gap-1.5 px-3 py-2 text-[12.5px] font-bold border-b-2 ${tab === "rankings" ? "border-[#0088cc] text-[#062444]" : "border-transparent text-slate-400 hover:text-[#062444]"}`}>
          <Trophy size={14} /> Rankings
        </button>
      </div>
      {tab === "scores" ? <ScoresTab /> : <RankingsTab />}
    </div>
  );
}
