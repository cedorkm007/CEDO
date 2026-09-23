import letterheadUrl from "@/imports/CEDO_Letterhead.png";
import cdeoRisLogoUrl from "@/imports/CdeO_RIS_Logo.png";
import sdgLogoUrl from "@/imports/SDG_Logo.png";

/**
 * The printed-page chrome shared by every "looks like a Word document"
 * preview in this app (letterhead header, centered title, address/logo
 * footer) — factored out of ScholarProfilePreviewModal so the Referral
 * Form's approval preview reads the same way instead of as another web
 * panel. Width is fixed to a page-like proportion; height is natural/
 * scrolling rather than a literal fixed page height, since content length
 * varies per document.
 */
export function DocPage({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[800px] bg-white shadow-[0_2px_10px_rgba(15,23,42,0.10),0_10px_30px_rgba(15,23,42,0.12)] ring-1 ring-black/5">
      <div className="px-10 pt-8 pb-5 border-b border-slate-200">
        <img src={letterheadUrl} alt="City Education and Development Office" className="h-[52px] w-auto" />
      </div>

      <div className="px-10 py-7 text-[#1a2432]">
        <div className="text-center mb-6">
          <h2 className="text-[16px] font-bold tracking-wide text-[#062444]">{title}</h2>
          {subtitle && <p className="text-[10.5px] text-slate-500 mt-1">{subtitle}</p>}
        </div>
        {children}
      </div>

      <div className="px-10 py-4 border-t border-slate-200 flex items-center justify-between gap-4">
        <img src={cdeoRisLogoUrl} alt="" className="h-9 w-auto shrink-0" />
        <div className="text-center text-[8.5px] leading-snug text-slate-600">
          <p>2/F POLICE STATION 1, CITY HALL COMPOUND, CAGAYAN DE ORO 9000 PH</p>
          <p>Email: cedo@cagayandeoro.gov.ph | Mobile: +63 929 819 0819 | Facebook: CDO City Scholarships Office</p>
        </div>
        <img src={sdgLogoUrl} alt="" className="h-9 w-auto shrink-0" />
      </div>
    </div>
  );
}

/** One labeled block of the printed page — a bold section title followed by its content, spaced like the sections of an actual generated document. */
export function DocSection({ title, children, last = false }: { title: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={last ? "" : "mb-6"}>
      <p className="text-[11.5px] font-bold uppercase tracking-wide text-[#062444] mb-2 pb-1 border-b-2 border-[#062444]/15">{title}</p>
      {children}
    </div>
  );
}

/** Bordered, print-style table (visible grid lines, shaded header row) rather than the app's usual rounded card + soft border — meant to read as part of a printed page. */
export function DocTable({ columns, rows, emptyMessage }: { columns: string[]; rows: string[][]; emptyMessage: string }) {
  if (rows.length === 0) {
    return <p className="text-[11.5px] text-slate-400 italic border border-slate-200 px-3 py-2.5">{emptyMessage}</p>;
  }
  return (
    <table className="w-full text-[12px] border-collapse">
      <thead>
        <tr>
          {columns.map(c => <th key={c} className="border border-slate-300 bg-slate-50 text-left font-semibold px-3 py-1.5">{c}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((value, j) => <td key={j} className="border border-slate-300 px-3 py-1.5">{value}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Label/value table (label column shaded, like DocTable's header) for a flat set of fields — the same shape as ScholarProfilePreviewModal's "Basic Information" block. */
export function DocFieldTable({ fields }: { fields: { label: string; value: string }[] }) {
  return (
    <table className="w-full text-[12px] border-collapse">
      <tbody>
        {fields.map(f => (
          <tr key={f.label}>
            <td className="border border-slate-300 bg-slate-50 font-semibold px-3 py-1.5 w-[38%]">{f.label}</td>
            <td className="border border-slate-300 px-3 py-1.5">{f.value || "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
