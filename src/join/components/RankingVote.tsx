import { useEffect, useRef, useState } from "react";
import { Reorder } from "motion/react";
import { GripVertical, CheckCircle2 } from "lucide-react";
import { submitResponse } from "../joinApi";

export function RankingVote({ sessionId, settings, votingLocked }: {
  sessionId: string; settings: Record<string, unknown>; votingLocked: boolean;
}) {
  const question = (settings.question as string) || "";
  const items = (settings.items as string[]) || [];
  const [order, setOrder] = useState<number[]>(items.map((_, i) => i));
  const [status, setStatus] = useState<"idle" | "submitting" | "submitted" | "error">("idle");
  const [error, setError] = useState("");
  const saveTimeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => () => { if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current); }, []);

  function handleReorder(next: number[]) {
    if (votingLocked) return;
    setOrder(next);
    setStatus("idle");
    if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = window.setTimeout(async () => {
      setStatus("submitting");
      setError("");
      const res = await submitResponse(sessionId, { order: next });
      setStatus(res.ok ? "submitted" : "error");
      if (!res.ok) setError(res.error);
    }, 700);
  }

  return (
    <div className="w-full max-w-sm mx-auto">
      <h2 className="text-xl font-bold text-[#062444] text-center mb-1 break-words">{question}</h2>
      <p className="text-[12px] text-slate-400 text-center mb-5">Drag to put them in your preferred order</p>
      <Reorder.Group axis="y" values={order} onReorder={handleReorder} className="space-y-2">
        {order.map((itemIndex, position) => (
          <Reorder.Item
            key={itemIndex} value={itemIndex}
            className="flex items-center gap-2.5 border border-[#e6ecf5] rounded-lg px-4 py-3 bg-white cursor-grab active:cursor-grabbing"
          >
            <GripVertical size={16} className="text-slate-300 shrink-0" />
            <span className="text-[11px] font-bold text-slate-400 shrink-0">{position + 1}</span>
            <span className="text-[14px] font-medium text-[#062444] break-words">{items[itemIndex]}</span>
          </Reorder.Item>
        ))}
      </Reorder.Group>
      {status === "submitting" && <p className="text-[12.5px] text-slate-400 text-center mt-4">Saving…</p>}
      {status === "submitted" && (
        <p className="flex items-center justify-center gap-1.5 text-[12.5px] font-semibold text-green-600 mt-4">
          <CheckCircle2 size={14} /> Ranking received
        </p>
      )}
      {error && <p className="text-[12.5px] text-red-600 text-center mt-4">{error}</p>}
      {votingLocked && <p className="text-[12.5px] text-amber-600 text-center mt-4">Voting is currently locked by the presenter.</p>}
    </div>
  );
}
