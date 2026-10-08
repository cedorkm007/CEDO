import type { SectionItem } from "../surveyTypes";
import { CardActions, DragHandle, fieldClass, type DragProps } from "./cardParts";

/**
 * A section header. Every question below it (until the next header) belongs to
 * it; respondents see its title and description as a short intro screen before
 * its first question.
 */
export function SectionCard({
  section, number, readOnly, dragging, drag, canMoveUp, canMoveDown, onActivate, onChange, onMove, onDelete,
}: {
  section: SectionItem;
  number: number;
  readOnly: boolean;
  dragging: boolean;
  drag: DragProps;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onActivate: () => void;
  onChange: (next: SectionItem) => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
}) {
  return (
    <div onClick={onActivate} className={`bg-white rounded-2xl border border-[#e6ecf5] border-l-4 border-l-[#062444] p-4 ${dragging ? "opacity-40" : ""}`}>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-wide text-[#062444]">
          {!readOnly && <DragHandle drag={drag} />} Section {number}
        </div>
        {!readOnly && (
          <CardActions canMoveUp={canMoveUp} canMoveDown={canMoveDown} onMove={onMove} onDelete={onDelete} deleteLabel="Delete section" />
        )}
      </div>
      <input
        value={section.title} readOnly={readOnly} maxLength={200}
        onChange={e => onChange({ ...section, title: e.target.value })}
        placeholder="Section title" aria-label="Section title"
        className={`${fieldClass} font-bold text-[14px]`}
      />
      <textarea
        rows={2} value={section.description} readOnly={readOnly} maxLength={2000}
        onChange={e => onChange({ ...section, description: e.target.value })}
        placeholder="Section description (optional)" aria-label="Section description"
        className={`${fieldClass} mt-2 resize-y text-[12.5px]`}
      />
    </div>
  );
}
