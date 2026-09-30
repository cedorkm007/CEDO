import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import html2canvas from "html2canvas";
import { Download, MessageSquareText, Maximize, Minimize } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useRealtimeRefresh } from "@/app/useRealtimeRefresh";
import { layoutWordCloud, tokenizeWordCloudEntry, CANVAS_WIDTH, CANVAS_HEIGHT, type WordCount } from "@/lib/wordCloudLayout";
import { EmptyColumn } from "./SeadUiShell";
import type { QuestTopic } from "../types";

const MIN_FONT_PX = 14;
const MAX_FONT_PX = 48;
// Presentation mode blows the same cloud up for a projector/big screen —
// same relative sizing, just a bigger min/max range.
const PRESENT_MIN_FONT_PX = 28;
const PRESENT_MAX_FONT_PX = 96;
const MAX_WORDS_SHOWN = 150;
const COLORS = ["#062444", "#0088cc", "#F3BC00", "#0f766e", "#7c3aed", "#be123c", "#15803d"];

/**
 * Live word cloud for a Word Cloud-mode topic — replaces QuestionColumn
 * entirely for that mode (see QuestionBankTab.tsx), since there's nothing
 * to author at the question level: the topic's own name is the prompt
 * scholars see (start_word_cloud_activity/submit_word_cloud_entry in
 * supabase_migration_quest_word_cloud.sql).
 *
 * Reads quest_word_cloud_entries directly (RLS already permits staff full
 * access) and aggregates word -> count client-side rather than through a
 * dedicated RPC — classroom-sized response counts make that unnecessary.
 * useRealtimeRefresh re-runs the same aggregation on every insert, exactly
 * like QRAttendanceSection's live attendee count in SDPMonitoringTab.tsx —
 * the hook delivers no payload, so a full refetch-and-reaggregate is the
 * only option, but it's cheap at this scale.
 *
 * "Present Full Screen" uses the standard Fullscreen API on this whole
 * component's own container — same requestFullscreen()/exitFullscreen()
 * idiom already used for the lecture-video player in QuestsPanel.tsx —
 * so staff can project just the cloud (bigger text, no surrounding
 * Question Bank chrome) while it keeps updating live.
 */
export function WordCloudLiveView({ topic }: { topic: QuestTopic | null }) {
  const [counts, setCounts] = useState<WordCount[]>([]);
  const [totalResponses, setTotalResponses] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const cloudRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  async function load(silent = false) {
    if (!topic) return;
    if (!silent) setLoading(true);
    const { data, error } = await supabase.from("quest_word_cloud_entries").select("word").eq("topic_id", topic.id);
    if (!error && data) {
      const tally = new Map<string, number>();
      for (const row of data as { word: string }[]) {
        for (const token of tokenizeWordCloudEntry(row.word)) {
          tally.set(token, (tally.get(token) ?? 0) + 1);
        }
      }
      const sorted = [...tally.entries()]
        .map(([text, count]) => ({ text, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, MAX_WORDS_SHOWN);
      setCounts(sorted);
      setTotalResponses(data.length);
    }
    if (!silent) setLoading(false);
  }

  useEffect(() => { void load(); }, [topic?.id]);
  useRealtimeRefresh("quest_word_cloud_entries", () => void load(true));

  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    }
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  async function togglePresent() {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await containerRef.current?.requestFullscreen();
    }
  }

  async function handleExport() {
    if (!cloudRef.current) return;
    setExporting(true);
    try {
      const canvas = await html2canvas(cloudRef.current, { backgroundColor: "#ffffff", scale: 2 });
      canvas.toBlob(blob => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${(topic?.name ?? "word_cloud").replace(/[^a-z0-9]+/gi, "_")}.png`;
        a.click();
        URL.revokeObjectURL(url);
      }, "image/png");
    } finally {
      setExporting(false);
    }
  }

  const minFont = isFullscreen ? PRESENT_MIN_FONT_PX : MIN_FONT_PX;
  const maxFont = isFullscreen ? PRESENT_MAX_FONT_PX : MAX_FONT_PX;
  const placedWords = useMemo(
    () => layoutWordCloud(counts, minFont, maxFont),
    // counts is a fresh array every render -- key off its actual content (including min/max font, which change on fullscreen toggle) so layout only recomputes when something that'd actually change it does, not on every unrelated re-render
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(counts), minFont, maxFont],
  );

  if (!topic) {
    return <EmptyColumn title="Word Cloud" message="Select a topic to see its live word cloud." />;
  }

  return (
    <div ref={containerRef}
      className={isFullscreen
        ? "bg-white flex flex-col h-screen w-screen"
        : "bg-white rounded-2xl border border-[#e6ecf5] flex flex-col min-h-[72vh] max-h-[720px]"}>
      <div className={`border-b border-[#e6ecf5] flex items-center justify-between gap-2 ${isFullscreen ? "px-8 py-5" : "px-4 py-3"}`}>
        <div className="min-w-0">
          <h3 className={`font-bold text-[#062444] truncate ${isFullscreen ? "text-[28px]" : "text-[12.5px]"}`}>
            {isFullscreen ? topic.name : `Word Cloud — ${topic.name}`}
          </h3>
          <p className={`mt-0.5 text-slate-400 ${isFullscreen ? "text-[14px]" : "text-[10.5px]"}`}>
            {totalResponses} response{totalResponses === 1 ? "" : "s"} · updates live
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {!isFullscreen && (
            <button onClick={handleExport} disabled={exporting || counts.length === 0}
              className="flex items-center gap-1 text-[12px] font-semibold text-[#0088cc] hover:underline disabled:opacity-50">
              <Download size={14} /> {exporting ? "Exporting…" : "Export as Image"}
            </button>
          )}
          <button onClick={togglePresent}
            className={`flex items-center gap-1 font-semibold text-[#0088cc] hover:underline ${isFullscreen ? "text-[14px]" : "text-[12px]"}`}>
            {isFullscreen ? <><Minimize size={16} /> Exit Full Screen</> : <><Maximize size={14} /> Present Full Screen</>}
          </button>
        </div>
      </div>

      <div className={`flex-1 overflow-y-auto ${isFullscreen ? "p-10 flex items-center justify-center" : "p-4"}`}>
        {loading ? (
          <p className="text-sm text-slate-400 text-center py-10">Loading…</p>
        ) : counts.length === 0 ? (
          <div className="text-center py-14 text-slate-400">
            <MessageSquareText className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No responses yet — words will appear here as scholars submit them.</p>
          </div>
        ) : (
          <div
            ref={cloudRef}
            className={`relative bg-white rounded-xl mx-auto w-full ${isFullscreen ? "max-w-[1400px]" : "max-w-[720px]"}`}
            style={{ aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}`, containerType: "inline-size" } as CSSProperties}
          >
            {placedWords.map((w, i) => (
              <span
                key={w.text}
                title={`${w.text} — ${w.count} response${w.count === 1 ? "" : "s"}`}
                style={{
                  position: "absolute",
                  left: `${(w.x / CANVAS_WIDTH) * 100}%`,
                  top: `${(w.y / CANVAS_HEIGHT) * 100}%`,
                  // cqw, not px -- see the identical comment in SlideResults.tsx's
                  // WordCloudResults; this container's rendered width varies
                  // (720px panel vs. a 1400px fullscreen projector), and fixed
                  // px font sizes would overflow instead of scaling with it.
                  fontSize: `${(w.fontSize / CANVAS_WIDTH) * 100}cqw`,
                  color: COLORS[i % COLORS.length],
                  lineHeight: 1.15,
                  whiteSpace: "nowrap",
                }}
                className="font-extrabold"
              >
                {w.text}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
