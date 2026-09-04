import { useEffect } from "react";
import { X } from "lucide-react";

/**
 * Lightweight custom modal — not the shadcn Dialog wrapper
 * (src/app/components/ui/dialog.tsx), since that depends on CSS custom
 * properties (--background, --muted-foreground, etc.) this project's
 * src/styles/index.css never defines, same reasoning that kept
 * GroupCountBreakdown on raw recharts instead of the shadcn chart
 * wrapper. Matches this feature's existing hand-rolled color palette
 * instead.
 */
// One class per nesting depth: 0 = a normal top-level modal, 1 = stacked
// above one already-open modal (`elevated`), 2 = stacked above that (e.g.
// ScholarListPanel's own Preview popup, opened from a scholar list that's
// itself already the elevated modal inside StatusDrilldown). Explicit
// literal classes rather than a template string, since Tailwind's content
// scanner needs the full class name present in source to generate it.
const Z_INDEX_CLASSES = ["z-50", "z-[60]", "z-[70]"] as const;

export function Modal({
  title, onClose, children, elevated = false, level,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Shorthand for level={1} — kept for existing call sites. */
  elevated?: boolean;
  /** Explicit nesting depth (0-2) when stacking more than two modals deep; overrides `elevated`. */
  level?: number;
}) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const resolvedLevel = level ?? (elevated ? 1 : 0);
  const zIndexClass = Z_INDEX_CLASSES[Math.min(resolvedLevel, Z_INDEX_CLASSES.length - 1)];

  return (
    <div className={`fixed inset-0 ${zIndexClass} flex items-center justify-center p-4`}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-6xl max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 bg-[#062444] shrink-0">
          <h3 className="text-[14px] font-bold text-white">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-md text-white/70 hover:bg-white/10 hover:text-white">
            <X size={16} />
          </button>
        </div>
        <div className="p-5 overflow-y-auto flex-1 min-h-0 bg-[#f8fafd]">{children}</div>
      </div>
    </div>
  );
}
