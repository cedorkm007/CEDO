import { useEffect, useState } from "react";
import { X } from "lucide-react";

/** True when the window is wide enough (1024 px) for the two-column record layout. */
export function useIsWide(): boolean {
  const query = "(min-width: 1024px)";
  const [wide, setWide] = useState(() => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : true));
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return wide;
}

/**
 * The large record pop-up (Daily Records: add, view, edit). It ADJUSTS TO THE SCREEN instead of having a fixed size: on a phone it is the whole screen, on a tablet nearly the whole screen,
 * on a laptop or desktop it is as wide as the window allows up to 1400 px and as tall as the content needs up to the window's height. The header and the footer stay in place; only the middle scrolls.
 * Escape and a click outside ask `onClose` (the caller decides whether there is unsaved writing to confirm).
 */
export function RecordModalShell({ title, subtitle, onClose, footer, children, closeOnEscape = true }: { title: string; subtitle?: string; onClose: () => void; footer?: React.ReactNode; children: React.ReactNode; closeOnEscape?: boolean }) {
  useEffect(() => {
    if (!closeOnEscape) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, closeOnEscape]);
  return (
    <div className="fixed inset-0 z-[100] flex items-stretch justify-center bg-black/40 p-0 sm:items-center sm:p-3 lg:p-5" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}
        className="flex h-[100dvh] w-full max-w-[1400px] flex-col overflow-hidden bg-white shadow-2xl sm:h-auto sm:max-h-[calc(100dvh-1.5rem)] sm:min-h-[min(34rem,calc(100dvh-1.5rem))] sm:rounded-2xl lg:max-h-[calc(100dvh-2.5rem)]">
        <div className="flex shrink-0 items-center justify-between gap-3 bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-4 py-3 sm:px-6 sm:py-4">
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-bold text-white">{title}</h2>
            {subtitle && <p className="truncate text-[12.5px] text-white/80">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 text-white/70 hover:text-white"><X size={18} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="shrink-0 border-t border-[#e6ecf5] bg-white px-4 py-3 sm:px-6">{footer}</div>}
      </div>
    </div>
  );
}

/** The two columns of the record layout: the scholar summary (narrow, stays in view while the form scrolls) and the form. Under 1024 px the summary becomes a collapsible panel above the form. */
export function RecordColumns({ summary, summaryLabel, children }: { summary: React.ReactNode; summaryLabel: string; children: React.ReactNode }) {
  const wide = useIsWide();
  if (wide) {
    return (
      <div className="grid grid-cols-[minmax(17rem,1fr)_2fr] items-start gap-6 p-6">
        <aside className="sticky top-0 max-h-[calc(100dvh-13rem)] overflow-y-auto rounded-xl border border-[#e6ecf5] bg-[#f7f9fc] p-4" aria-label={summaryLabel}>{summary}</aside>
        <div className="min-w-0 space-y-4">{children}</div>
      </div>
    );
  }
  return (
    <div className="space-y-4 p-4 sm:p-5">
      <details className="rounded-xl border border-[#e6ecf5] bg-[#f7f9fc]">
        <summary className="cursor-pointer select-none px-4 py-2.5 text-[13.5px] font-bold text-[#062444]">{summaryLabel}</summary>
        <div className="border-t border-[#e6ecf5] p-4">{summary}</div>
      </details>
      <div className="min-w-0 space-y-4">{children}</div>
    </div>
  );
}
