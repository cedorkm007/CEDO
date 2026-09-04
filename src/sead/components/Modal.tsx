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
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl border border-[#e6ecf5] shadow-xl w-full max-w-4xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#f0f3f8] sticky top-0 bg-white rounded-t-2xl">
          <h3 className="text-[14px] font-bold text-[#062444]">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-md text-slate-400 hover:bg-[#f8fafd] hover:text-slate-600">
            <X size={16} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
