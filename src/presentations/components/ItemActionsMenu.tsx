import { useEffect, useRef, useState } from "react";
import { MoreVertical, FolderOpen, Pencil, FolderInput, Copy, Trash2 } from "lucide-react";

interface ItemActionsMenuProps {
  canDuplicate: boolean;
  onOpen: () => void;
  onRename: () => void;
  onMove: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

/**
 * Hand-rolled "⋮" menu rather than the shadcn dropdown-menu primitive
 * (src/app/components/ui/dropdown-menu.tsx) — that primitive depends on
 * CSS custom properties this project's stylesheets never define (see
 * src/sead/components/Modal.tsx's identical note about the shadcn
 * Dialog), and no other SEAD-area page uses it either.
 */
export function ItemActionsMenu({ canDuplicate, onOpen, onRename, onMove, onDuplicate, onDelete }: ItemActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  function pick(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <div ref={containerRef} className="relative shrink-0" onClick={e => e.stopPropagation()}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="More actions"
        className="p-1 rounded-md text-slate-400 hover:bg-[#f0f3f8] hover:text-[#062444]"
      >
        <MoreVertical size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-7 z-20 w-44 rounded-xl border border-[#e6ecf5] bg-white shadow-lg py-1.5 text-[12.5px]">
          <button onClick={() => pick(onOpen)} className="w-full flex items-center gap-2 px-3 py-2 text-left text-[#062444] hover:bg-[#f7f9fc]">
            <FolderOpen size={14} /> Open
          </button>
          <button onClick={() => pick(onRename)} className="w-full flex items-center gap-2 px-3 py-2 text-left text-[#062444] hover:bg-[#f7f9fc]">
            <Pencil size={14} /> Rename
          </button>
          <button onClick={() => pick(onMove)} className="w-full flex items-center gap-2 px-3 py-2 text-left text-[#062444] hover:bg-[#f7f9fc]">
            <FolderInput size={14} /> Move to…
          </button>
          {canDuplicate && (
            <button onClick={() => pick(onDuplicate)} className="w-full flex items-center gap-2 px-3 py-2 text-left text-[#062444] hover:bg-[#f7f9fc]">
              <Copy size={14} /> Duplicate
            </button>
          )}
          <div className="my-1 border-t border-[#f0f3f8]" />
          <button onClick={() => pick(onDelete)} className="w-full flex items-center gap-2 px-3 py-2 text-left text-red-600 hover:bg-red-50">
            <Trash2 size={14} /> Delete
          </button>
        </div>
      )}
    </div>
  );
}
