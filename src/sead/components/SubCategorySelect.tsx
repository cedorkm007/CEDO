import { SDP_SUBCATEGORIES, type SDPSubCategory } from "@/scholar/sdpApi";

/** The three SDP sub-categories as buttons. Needs a category first (a sub-category cannot exist without one). */
export function SubCategorySelect({ value, onChange, hasCategory }: { value: SDPSubCategory | null; onChange: (v: SDPSubCategory) => void; hasCategory: boolean }) {
  return (
    <div>
      <div role="group" aria-label="SDP sub-category" className="flex flex-wrap gap-1.5">
        {SDP_SUBCATEGORIES.map(c => (
          <button key={c.key} type="button" disabled={!hasCategory} aria-pressed={value === c.key} onClick={() => onChange(c.key)}
            className={`px-3 py-1.5 rounded-lg border text-[12px] font-bold transition-all disabled:opacity-50 ${
              value === c.key ? "border-[#062444] bg-[#062444] text-white" : "border-[#e6ecf5] text-slate-600 hover:bg-[#f8fafd]"
            }`}>
            {c.label}
          </button>
        ))}
      </div>
      {!hasCategory && <p className="mt-1 text-[11px] text-slate-500">Choose a category first.</p>}
    </div>
  );
}
