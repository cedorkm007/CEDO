import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { insertPhrase } from "@/lib/recordPopup";
import { EDIT_TEXT_LIMIT } from "@/lib/dailyRecordEdit";
import type { QuickPhrase } from "../scholarCounselingApi";

const BOX = "w-full resize-none overflow-hidden rounded-lg border border-[#062444]/25 bg-white px-3 py-2 text-[14.5px] leading-relaxed text-slate-900 outline-none focus:border-[#0088cc]";

/**
 * A large writing box for the findings and the staff recommendations: at least 8 lines, it grows as the person types (no scroll bar inside it; the pop-up scrolls), plain text (type "- " or "1." for a list),
 * a character count, and an "Insert…" menu with the shared quick phrases (the phrase goes where the cursor is). `phrases` null = the quick phrases are not available (the menu is left out).
 */
export function RecordTextArea({ id, label, value, onChange, phrases, onEditPhrases, minRows = 8 }: {
  id: string; label: string; value: string; onChange: (v: string) => void; phrases: QuickPhrase[] | null; onEditPhrases: () => void; minRows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [menu, setMenu] = useState(false);
  const caret = useRef<number | null>(null);
  const [full, setFull] = useState(false);

  // grow with the text
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  // put the cursor after an inserted phrase
  useEffect(() => {
    if (caret.current != null && ref.current) { ref.current.focus(); ref.current.setSelectionRange(caret.current, caret.current); caret.current = null; }
  }, [value]);

  function insert(phrase: string) {
    const el = ref.current;
    const r = insertPhrase(value, el?.selectionStart ?? value.length, el?.selectionEnd ?? value.length, phrase);
    setMenu(false);
    if (!r.ok) { setFull(true); return; }
    setFull(false); caret.current = r.caret; onChange(r.text);
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-[13.5px] font-bold text-slate-800">{label}</label>
        {phrases && (
          <span className="relative">
            <button type="button" onClick={() => setMenu(m => !m)} aria-expanded={menu} aria-haspopup="menu"
              className="rounded-lg border border-[#062444]/25 bg-white px-2.5 py-1 text-[12.5px] font-semibold text-[#062444] hover:bg-[#f7f9fc]">Insert…</button>
            {menu && (
              <div role="menu" className="absolute right-0 z-20 mt-1 w-72 max-w-[80vw] rounded-lg border border-[#e6ecf5] bg-white py-1 shadow-xl">
                {phrases.length === 0 && <p className="px-3 py-2 text-[13px] text-slate-700">No quick phrases yet.</p>}
                {phrases.map(p => <button key={p.id} role="menuitem" type="button" onClick={() => insert(p.phrase)} className="block w-full px-3 py-1.5 text-left text-[13.5px] text-slate-900 hover:bg-[#f0f6fb]">{p.phrase}</button>)}
                <button type="button" role="menuitem" onClick={() => { setMenu(false); onEditPhrases(); }} className="block w-full border-t border-[#f0f3f8] px-3 py-1.5 text-left text-[13px] font-semibold text-[#00709f] hover:bg-[#f0f6fb]">Edit the list of phrases…</button>
              </div>
            )}
          </span>
        )}
      </div>
      <textarea id={id} ref={ref} value={value} rows={minRows} maxLength={EDIT_TEXT_LIMIT} onChange={e => { setFull(false); onChange(e.target.value); }} className={BOX} />
      <p className="mt-0.5 flex justify-between text-[12px] text-slate-600">
        <span role="status">{full ? "That phrase does not fit: the text is at its limit." : ""}</span>
        <span>{value.length.toLocaleString("en-US")} / {EDIT_TEXT_LIMIT.toLocaleString("en-US")}</span>
      </p>
    </div>
  );
}
