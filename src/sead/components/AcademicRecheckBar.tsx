import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { recheckText } from "@/lib/academicScreen";
import { fetchRecheckStatus, recheckStep } from "../academicScreenApi";

/**
 * The progress of the re-check of the open renewals after a change in Grades and Academic Management (Phase 2): "Re-checking 340 renewals… 120 done".
 * It checks the next 25 over and over while it is on the screen; what is left when the staff leave is finished by the 5-minute background job, so nothing is lost.
 * `nonce` goes up after every save: the bar looks again at what is waiting.
 */
export function AcademicRecheckBar({ nonce }: { nonce: number }) {
  const [total, setTotal] = useState(0);
  const [left, setLeft] = useState(0);
  const [failed, setFailed] = useState(0);
  const [finished, setFinished] = useState(false);
  const [note, setNote] = useState("");
  const running = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    if (running.current) return;
    running.current = true;
    void (async () => {
      try {
        const s = await fetchRecheckStatus();
        if (!alive.current || !s.ok) return;
        setFailed(s.failed);
        if (s.pending === 0) { setLeft(0); return; }
        setFinished(false); setNote(""); setTotal(t => (left > 0 ? Math.max(t, s.pending) : s.pending)); setLeft(s.pending);
        let remaining = s.pending, stalls = 0;
        while (alive.current && remaining > 0 && stalls < 3) {
          const r = await recheckStep(25);
          if (!alive.current) return;
          if (!r.ok) { setNote("The re-check will continue in the background."); break; }
          stalls = r.processed === 0 ? stalls + 1 : 0;
          remaining = r.remaining; setLeft(remaining);
        }
        if (remaining === 0) { setFinished(true); const f = await fetchRecheckStatus(); if (alive.current && f.ok) setFailed(f.failed); }
        else if (!note) setNote("The rest is finished by the background job within a few minutes.");
      } finally { running.current = false; }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  if (left === 0 && !finished && failed === 0) return null;
  return (
    <div className="space-y-2" aria-live="polite">
      {left > 0 && <p role="status" className="flex items-center gap-2 rounded-lg border border-[#062444]/20 bg-[#f1f6fd] px-3 py-2 text-[14px] text-[#062444]"><Loader2 size={14} className="animate-spin" aria-hidden="true" /> {recheckText(total, left)}{note ? ` ${note}` : ""}</p>}
      {left === 0 && finished && <p role="status" className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-[14px] text-green-900"><CheckCircle2 size={14} className="mr-1 inline" aria-hidden="true" />{recheckText(total, 0)}</p>}
      {failed > 0 && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[14px] text-amber-950"><AlertTriangle size={14} className="mr-1 inline" aria-hidden="true" />{failed.toLocaleString("en-US")} renewal{failed === 1 ? "" : "s"} could not be checked after 3 tries in the last 7 days. Open the case to see it, or change the scholar's status again to check it once more.</p>}
    </div>
  );
}
