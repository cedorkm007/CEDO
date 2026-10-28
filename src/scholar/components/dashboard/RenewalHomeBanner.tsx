import { useCallback, useEffect, useState } from "react";
import { useLiveReload } from "@/lib/liveUpdates";
import { ArrowRight, RotateCw } from "lucide-react";
import { fetchMyRenewals } from "../../renewalApi";
import { renewalAttention, type RenewalAttention } from "../../renewalSummary";

/**
 * A short banner at the top of the scholar's portal: the one thing to do about the renewal right now (or, when it is only waiting on the
 * office, a quiet one-line status). Opens the Renewal tile. Shows nothing when there is no renewal to talk about.
 */
export function RenewalHomeBanner({ onOpen }: { onOpen: () => void }) {
  const [att, setAtt] = useState<RenewalAttention | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchMyRenewals().then(r => { if (!cancelled && r.ok) setAtt(renewalAttention(r.overview.windows)); });
    return () => { cancelled = true; };
  }, []);

  const refresh = useCallback(async () => { const r = await fetchMyRenewals(); if (r.ok) setAtt(renewalAttention(r.overview.windows)); }, []);
  useLiveReload(refresh);

  if (!att) return null;
  return (
    <div className={`mb-4 flex items-center justify-between gap-3 rounded-xl border px-4 py-3 ${att.actionNeeded ? "border-[#F3BC00]/50 bg-[#F3BC00]/15" : "border-[#cfe0f5] bg-[#eef5fc]"}`} role="status">
      <div className="flex min-w-0 items-start gap-2.5">
        <RotateCw size={18} className="mt-0.5 shrink-0 text-[#062444]" aria-hidden="true" />
        <p className="text-[14px] text-[#062444]"><span className="font-bold">Renewal for {att.termLabel}:</span> {att.headline}</p>
      </div>
      <button onClick={onOpen} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#062444] px-3.5 py-2 text-[14px] font-bold text-white hover:bg-[#0a3a6e]">
        {att.actionNeeded ? "Open" : "See details"} <ArrowRight size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
