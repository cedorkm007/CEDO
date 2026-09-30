import { useMemo, useState } from "react";
import { X, Folder, ChevronRight, Home } from "lucide-react";
import { isFolderOrDescendant, type PresentationFolder } from "../presentationsApi";

interface MoveToFolderModalProps {
  allFolders: PresentationFolder[];
  /** The current location of the item being moved — pre-selecting a different destination is required before "Move here" enables. */
  currentFolderId: string | null;
  /** When moving a folder, its own id — moving it into itself or one of its own subfolders is disallowed. Null when moving a presentation (no such restriction applies). */
  excludeSubtreeOf: string | null;
  itemLabel: string;
  onClose: () => void;
  onMove: (destinationFolderId: string | null) => void;
}

/**
 * Small custom modal (not the shared src/sead/components/Modal.tsx,
 * whose fixed max-w-6xl/h-[85vh] sizing is built for content-heavy
 * tools — this is a compact folder-tree picker) navigated one level at
 * a time, breadcrumb-style, mirroring the main file manager's own
 * breadcrumb navigation so moving a file feels like browsing it.
 */
export function MoveToFolderModal({ allFolders, currentFolderId, excludeSubtreeOf, itemLabel, onClose, onMove }: MoveToFolderModalProps) {
  const [browsingFolderId, setBrowsingFolderId] = useState<string | null>(null);

  const byId = useMemo(() => new Map(allFolders.map(f => [f.id, f])), [allFolders]);
  const breadcrumb = useMemo(() => {
    const path: PresentationFolder[] = [];
    let current = browsingFolderId ? byId.get(browsingFolderId) ?? null : null;
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      path.unshift(current);
      current = current.parentFolderId ? byId.get(current.parentFolderId) ?? null : null;
    }
    return path;
  }, [browsingFolderId, byId]);

  const visibleChildren = allFolders
    .filter(f => f.parentFolderId === browsingFolderId)
    .sort((a, b) => a.name.localeCompare(b.name));

  function isDisabled(folderId: string): boolean {
    return excludeSubtreeOf !== null && isFolderOrDescendant(allFolders, excludeSubtreeOf, folderId);
  }

  const canMoveHere = browsingFolderId !== currentFolderId;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md flex flex-col overflow-hidden max-h-[70vh]">
        <div className="flex items-center justify-between px-5 py-4 bg-[#062444] shrink-0">
          <h3 className="text-[14px] font-bold text-white">Move "{itemLabel}"</h3>
          <button onClick={onClose} className="p-1.5 rounded-md text-white/70 hover:bg-white/10 hover:text-white">
            <X size={16} />
          </button>
        </div>

        <div className="flex items-center gap-1 px-4 py-2.5 border-b border-[#f0f3f8] text-[12px] font-semibold text-slate-500 overflow-x-auto shrink-0">
          <button onClick={() => setBrowsingFolderId(null)} className="flex items-center gap-1 shrink-0 hover:text-[#062444]">
            <Home size={13} /> My Presentations
          </button>
          {breadcrumb.map(folder => (
            <span key={folder.id} className="flex items-center gap-1 shrink-0">
              <ChevronRight size={12} className="text-slate-300" />
              <button onClick={() => setBrowsingFolderId(folder.id)} className="hover:text-[#062444]">{folder.name}</button>
            </span>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-2 min-h-[160px]">
          {visibleChildren.length === 0 ? (
            <p className="text-center text-[12.5px] text-slate-400 py-8">No subfolders here.</p>
          ) : (
            visibleChildren.map(folder => {
              const disabled = isDisabled(folder.id);
              return (
                <button
                  key={folder.id}
                  disabled={disabled}
                  onClick={() => setBrowsingFolderId(folder.id)}
                  title={disabled ? "Can't move a folder into itself or one of its own subfolders" : undefined}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-[13px] font-medium text-left ${
                    disabled ? "text-slate-300 cursor-not-allowed" : "text-[#062444] hover:bg-[#f7f9fc]"
                  }`}
                >
                  <Folder size={16} className={disabled ? "text-slate-200" : "text-[#F3BC00]"} /> {folder.name}
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[#f0f3f8] shrink-0">
          <button onClick={onClose} className="px-3.5 py-2 rounded-lg text-[12.5px] font-semibold text-slate-500 hover:bg-[#f7f9fc]">Cancel</button>
          <button
            onClick={() => onMove(browsingFolderId)}
            disabled={!canMoveHere}
            className="px-3.5 py-2 rounded-lg text-[12.5px] font-semibold bg-[#062444] text-white disabled:opacity-40"
          >
            Move here
          </button>
        </div>
      </div>
    </div>
  );
}
