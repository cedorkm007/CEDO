import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { focusRing } from "./portalParts";

/**
 * A small, content-sized dialog for the School Portal (change password, help). Proper dialog semantics for keyboard and
 * screen-reader users: role="dialog" + aria-modal + a title it is labelled by, Escape and a click on the backdrop close it,
 * focus moves into it when it opens and returns to where it came from when it closes, and Tab stays inside it.
 */
export function SchoolDialog({ title, onClose, returnFocusTo, children }: {
  title: string; onClose: () => void;
  /** Where focus goes when the dialog closes, when whatever opened it no longer exists (e.g. a menu item). */
  returnFocusTo?: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const returnEl = returnFocusTo?.current ?? null; // read now: the element exists while the dialog is open
    const focusables = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? []);
    // First field (not the Close button) when there is one, else the panel itself.
    const first = focusables().find(el => el.tagName === "INPUT") ?? panelRef.current;
    first?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const stillThere = !!previouslyFocused && previouslyFocused !== document.body && document.contains(previouslyFocused);
      const target = stillThere ? previouslyFocused : returnEl;
      target?.focus?.();
    };
  }, [onClose, returnFocusTo]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/45" onClick={onClose} aria-hidden="true" />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden outline-none">
        <div className="flex items-center justify-between gap-3 px-5 py-4 bg-[#062444] shrink-0">
          <h2 id={titleId} className="text-[16px] font-bold text-white">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className={`p-1.5 rounded-md text-white hover:bg-white/15 ${focusRing}`}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
