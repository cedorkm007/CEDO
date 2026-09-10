import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, ClipboardList, ChevronRight, Lightbulb, CheckCircle2 } from "lucide-react";
import { SectionCard } from "./SectionCard";
import {
  fetchApprovedSDPActivities, fetchScholarSDPCreditCounts, SDP_CATEGORIES,
  type SDPActivity, type SDPCreditCounts,
} from "../../sdpApi";
import { pubmatUrl } from "@/sead/pubmatApi";

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
            { label: "Nature of Activity", value: activity.nature.join(", ") },
            { label: "Organization", value: activity.organization },
            { label: "Date / Time", value: activity.dateTime ? new Date(activity.dateTime).toLocaleString() : "—" },
            { label: "Venue", value: activity.venue },
            { label: "Project Head", value: activity.projectHead || "—" },
            { label: "Head, Cluster", value: activity.headCluster || "—" },
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

function ActivityCard({ act, onClick }: { act: SDPActivity; onClick: () => void }) {
  const pubmat = pubmatUrl(act.pubmatPath);
  return (
    <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }} onClick={onClick}
      className="w-full bg-white rounded-xl shadow-sm p-4 flex items-center gap-3 text-left hover:shadow-md transition-all border border-gray-100">
      {pubmat && <img src={pubmat} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0" />}
      <div className="flex-1 min-w-0">
        <p className="font-bold text-[#062444] text-sm truncate">{act.name}</p>
        <p className="text-xs text-gray-500 truncate">{act.organization}</p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {act.category && (
            <span className="text-[10px] font-bold text-[#0088cc] bg-[#0088cc]/10 rounded-full px-2 py-0.5">
              {SDP_CATEGORIES.find(c => c.key === act.category)?.label ?? act.category}
            </span>
          )}
          {act.dateTime && <span className="text-xs text-gray-400">{new Date(act.dateTime).toLocaleDateString()}</span>}
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
    </motion.button>
  );
}

const CREDITS_REQUIRED = 3;

/** Per-category progress toward the 3 credits needed to complete it — mirrors the checkmark/circle badges already shown on the scholar's own Profile, but with the actual running count instead of just done/not-done. */
function CreditProgress({ credits }: { credits: SDPCreditCounts }) {
  return (
    <div className="grid grid-cols-3 gap-1.5 sm:gap-2.5 mb-5">
      {SDP_CATEGORIES.map(c => {
        const count = credits[c.key] ?? 0;
        const complete = count >= CREDITS_REQUIRED;
        return (
          <div key={c.key} className={`rounded-lg sm:rounded-xl border px-1.5 py-1.5 sm:p-3 ${complete ? "bg-green-50 border-green-200" : "bg-[#f7f9fc] border-transparent"}`}>
            <div className="flex items-center justify-between gap-1 mb-1 sm:mb-1.5">
              <span className="text-[8.5px] sm:text-[11px] font-bold text-[#062444] leading-tight line-clamp-2">{c.label}</span>
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
  const [loading, setLoading] = useState(true);
  const [selectedActivity, setSelectedActivity] = useState<SDPActivity | null>(null);
  const [credits, setCredits] = useState<SDPCreditCounts>({ community_service: 0, community_volunteerism: 0, formation_program: 0 });

  async function loadAll() {
    setLoading(true);
    const [a, c] = await Promise.all([
      fetchApprovedSDPActivities(), fetchScholarSDPCreditCounts(scholarIdNumber),
    ]);
    setActivities(a);
    setCredits(c);
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
          activities.map(act => <ActivityCard key={act.id} act={act} onClick={() => setSelectedActivity(act)} />)
        )}
      </div>

      <AnimatePresence>
        {selectedActivity && <ActivityDetailModal activity={selectedActivity} onClose={() => setSelectedActivity(null)} />}
      </AnimatePresence>
    </SectionCard>
  );
}
