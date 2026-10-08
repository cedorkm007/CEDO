import { useEffect, useRef, useState } from "react";
import { MoreVertical, FolderOpen, Copy, Share2, QrCode, BarChart3, Trash2, LogOut } from "lucide-react";
import type { SurveyRole } from "../mySurveysApi";

interface SurveyActionsMenuProps {
  role: SurveyRole;
  onOpen: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  /** True once the survey has been published (it has a public link). */
  hasLink: boolean;
  onGetLink: () => void;
  /** Owner only. */
  onShare: () => void;
  /** Editors and viewers: remove themselves from the survey. */
  onLeave: () => void;
  onViewResponses: () => void;
}

/**
 * Hand-rolled "⋮" menu for the same reason as
 * src/presentations/components/ItemActionsMenu.tsx -- the shadcn dropdown
 * primitive depends on CSS variables this project never defines.
 * Role-aware: only the owner sees Share and Delete.
 */
export function SurveyActionsMenu({ role, hasLink, onOpen, onDuplicate, onDelete, onShare, onLeave, onGetLink, onViewResponses }: SurveyActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleEscape(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  function pick(action: () => void) {
    setOpen(false);
    action();
  }

  const itemClass = "w-full flex items-center gap-2 whitespace-nowrap px-3 py-2 text-left text-[#062444] hover:bg-[#f7f9fc] disabled:text-slate-300 disabled:hover:bg-transparent disabled:cursor-not-allowed";

  return (
    <div ref={containerRef} className="relative shrink-0" onClick={e => e.stopPropagation()}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="More actions" aria-haspopup="menu" aria-expanded={open}
        className="p-1.5 rounded-md text-slate-500 hover:bg-[#f0f3f8] hover:text-[#062444]"
      >
        <MoreVertical size={16} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-8 z-20 w-56 rounded-xl border border-[#e6ecf5] bg-white shadow-lg py-1.5 text-[12.5px]">
          <button role="menuitem" onClick={() => pick(onOpen)} className={itemClass}>
            <FolderOpen size={14} /> {role === "viewer" ? "Open (view only)" : "Open"}
          </button>
          <button role="menuitem" onClick={() => pick(onDuplicate)} className={itemClass}>
            <Copy size={14} /> Duplicate
          </button>
          {role === "owner" && (
            <button role="menuitem" onClick={() => pick(onShare)} className={itemClass}>
              <Share2 size={14} /> Share
            </button>
          )}
          <button role="menuitem" onClick={() => pick(onGetLink)} disabled={!hasLink} className={itemClass}>
            <QrCode size={14} /> Get Link / QR {!hasLink && <span className="ml-auto text-[10px] font-semibold text-slate-300">Not published</span>}
          </button>
          <button role="menuitem" onClick={() => pick(onViewResponses)} className={itemClass}>
            <BarChart3 size={14} /> View Responses
          </button>
          {role !== "owner" && (
            <>
              <div className="my-1 border-t border-[#f0f3f8]" />
              <button role="menuitem" onClick={() => pick(onLeave)} className="w-full flex items-center gap-2 whitespace-nowrap px-3 py-2 text-left text-red-600 hover:bg-red-50">
                <LogOut size={14} /> Remove from my list
              </button>
            </>
          )}
          {role === "owner" && (
            <>
              <div className="my-1 border-t border-[#f0f3f8]" />
              <button role="menuitem" onClick={() => pick(onDelete)} className="w-full flex items-center gap-2 px-3 py-2 text-left text-red-600 hover:bg-red-50">
                <Trash2 size={14} /> Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
