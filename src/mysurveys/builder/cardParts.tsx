import { ArrowDown, ArrowUp, Copy, GripVertical, Trash2 } from "lucide-react";

export const fieldClass =
  "w-full border border-[#e6ecf5] rounded-lg px-3 py-2 text-[13px] text-[#062444] outline-none focus:border-[#0088cc] bg-white disabled:bg-[#f7f9fc] disabled:text-slate-500 read-only:bg-[#f7f9fc]";

export interface DragProps {
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}

/** The ⋮⋮ grip. Desktop drag-and-drop only -- touch screens use the arrow buttons. */
export function DragHandle({ drag }: { drag: DragProps }) {
  return (
    <span
      draggable onDragStart={drag.onDragStart} onDragEnd={drag.onDragEnd}
      title="Drag to reorder" aria-hidden="true"
      className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 p-1 -ml-1 select-none"
    >
      <GripVertical size={16} />
    </span>
  );
}

const iconBtn = "p-2 rounded-lg text-slate-500 hover:bg-[#f0f3f8] hover:text-[#062444] disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-500";

export function CardActions({ canMoveUp, canMoveDown, onMove, onDuplicate, onDelete, deleteLabel }: {
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (dir: -1 | 1) => void;
  onDuplicate?: () => void;
  onDelete: () => void;
  deleteLabel: string;
}) {
  return (
    <div className="flex items-center gap-0.5">
      <button type="button" onClick={() => onMove(-1)} disabled={!canMoveUp} aria-label="Move up" title="Move up" className={iconBtn}><ArrowUp size={16} /></button>
      <button type="button" onClick={() => onMove(1)} disabled={!canMoveDown} aria-label="Move down" title="Move down" className={iconBtn}><ArrowDown size={16} /></button>
      {onDuplicate && <button type="button" onClick={onDuplicate} aria-label="Duplicate question" title="Duplicate" className={iconBtn}><Copy size={16} /></button>}
      <button type="button" onClick={onDelete} aria-label={deleteLabel} title="Delete" className={`${iconBtn} hover:!text-red-600 hover:!bg-red-50`}><Trash2 size={16} /></button>
    </div>
  );
}
