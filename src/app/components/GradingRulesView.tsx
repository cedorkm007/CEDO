import { ENTRY_MODE_LABEL, bandResult, sampleComputation, sampleSubjects, resultForGrade, type GradingRules, type RuleScale } from "@/lib/gradingRules";
import { formatWith } from "@/lib/gwa";

/** A worked example of the GWA with the school's own settings: sample subjects (a few passed, one failed) taken from its table, and the working. Used by the school's editor and the read-only views. */
export function SampleBox({ rules, scale }: { rules: GradingRules; scale: RuleScale }) {
  const subjects = sampleSubjects(rules, scale);
  const out = sampleComputation(subjects, scale, rules.gwa, s => resultForGrade(s.grade, rules, scale) ?? "other");
  const pct = rules.gwa.gradeUsed === "percentage";
  return (
    <div className="rounded-lg border border-[#e6ecf5] bg-[#f7f9fc] px-3.5 py-3" aria-label="Sample computation">
      <p className="text-[14px] font-bold text-[#062444] mb-1">Sample computation</p>
      <p className="text-[14px] text-slate-800 mb-2">Made-up subjects, worked out with your settings, so you can check the result against your registrar.</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-[14px]">
          <thead><tr className="text-left text-slate-800"><th className="py-1 pr-3 font-bold">Subject</th><th className="py-1 pr-3 font-bold">Units</th><th className="py-1 pr-3 font-bold">{pct ? "Percentage" : "Grade"}</th><th className="py-1 font-bold">In the GWA?</th></tr></thead>
          <tbody>
            {out.lines.map((l, i) => (
              <tr key={i} className="border-t border-[#e6ecf5]"><td className="py-1 pr-3 text-slate-900">{l.name}</td><td className="py-1 pr-3 text-slate-900">{l.units}</td><td className="py-1 pr-3 font-semibold text-[#062444]">{l.shown}</td>
                <td className="py-1 text-slate-900">{l.counted ? "Yes" : `No${l.note ? ` — ${l.note}` : ""}`}{l.counted && l.note ? <span className="text-slate-700"> ({l.note})</span> : null}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[14.5px] font-semibold text-[#062444]">{out.gwa === null ? out.text : <>GWA = {out.formula} = <span className="text-[16px]">{formatWith(out.gwa, rules.gwa)}</span></>}</p>
    </div>
  );
}

const methodText = (r: GradingRules) => (r.gwa.method === "weighted" ? "Units-weighted average (sum of grade × units ÷ sum of units)" : "Simple average (sum of grades ÷ number of subjects)");

/**
 * A school's saved grading rules, read-only: how grades are entered, the passing mark(s), the conversion table with each row's result, and the GWA settings.
 * Used for the history in the School Portal and for CEDO staff (Scholars' Grades Monitoring > Grading rules).
 */
export function GradingRulesView({ rules, scale, showSample = true }: { rules: GradingRules; scale: RuleScale | null; showSample?: boolean }) {
  const hasTable = rules.bands.length > 0;
  const g = rules.gwa;
  const sorted = [...rules.bands].sort((a, b) => b.from - a.from);
  return (
    <div className="space-y-4 text-[14.5px] text-slate-900">
      <dl className="grid grid-cols-1 sm:grid-cols-[13rem_minmax(0,1fr)] gap-x-4 gap-y-1.5">
        <dt className="font-semibold text-[#062444]">Grades are entered as</dt><dd>{ENTRY_MODE_LABEL[rules.entryMode]}</dd>
        <dt className="font-semibold text-[#062444]">Passing mark</dt>
        <dd>
          {hasTable ? <>{rules.passingMarkPct}% — a percentage of {rules.passingMarkPct} or higher is Passed; anything below is Failed.</> : "No conversion table: the passing mark on the school's own scale is used."}
          {rules.programPassing.length > 0 && <ul className="mt-1 list-disc pl-5">{rules.programPassing.map(p => <li key={p.program}>{p.program}: {p.passingPct}%</li>)}</ul>}
        </dd>
      </dl>

      {hasTable ? (
        <div className="overflow-x-auto rounded-xl border border-[#e6ecf5] bg-white">
          <table className="w-full min-w-[520px] text-[14.5px]">
            <caption className="sr-only">Grade conversion table</caption>
            <thead className="bg-[#f7f9fc]"><tr className="text-left text-[13px] uppercase tracking-wide text-slate-800">
              <th scope="col" className="px-3 py-2.5 font-bold">From (%)</th><th scope="col" className="px-3 py-2.5 font-bold">To (%)</th><th scope="col" className="px-3 py-2.5 font-bold">Equivalent grade</th><th scope="col" className="px-3 py-2.5 font-bold">Remarks</th><th scope="col" className="px-3 py-2.5 font-bold">Result</th>
            </tr></thead>
            <tbody>
              {sorted.map((b, i) => {
                const res = bandResult(b, rules.passingMarkPct);
                return (
                  <tr key={i} className="border-t border-[#f0f3f8]"><td className="px-3 py-2">{b.from.toFixed(2)}</td><td className="px-3 py-2">{b.to.toFixed(2)}</td><td className="px-3 py-2 font-semibold text-[#062444]">{b.equivalentGrade}</td><td className="px-3 py-2">{b.remarks}</td>
                    <td className="px-3 py-2"><span className={`inline-block rounded-full border px-2.5 py-0.5 text-[13px] font-bold ${res === "passed" ? "border-green-300 bg-green-50 text-green-900" : "border-red-300 bg-red-50 text-red-900"}`}>{res === "passed" ? "Passed" : "Failed"}</span></td></tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <p className="rounded-lg border border-dashed border-[#062444]/30 px-3.5 py-3">No conversion table saved.</p>}

      <dl className="grid grid-cols-1 sm:grid-cols-[13rem_minmax(0,1fr)] gap-x-4 gap-y-1.5">
        <dt className="font-semibold text-[#062444]">GWA method</dt><dd>{methodText(rules)}</dd>
        <dt className="font-semibold text-[#062444]">Grade used</dt><dd>{g.gradeUsed === "equivalent" ? "The equivalent grade" : "The percentage"}</dd>
        <dt className="font-semibold text-[#062444]">Decimal places</dt><dd>{g.decimals}, {g.rounding === "round" ? "rounded normally" : "extra decimals cut off"}</dd>
        <dt className="font-semibold text-[#062444]">Failed grades</dt><dd>{g.includeFailed ? "Included in the GWA" : "Left out of the GWA"}</dd>
        <dt className="font-semibold text-[#062444]">Special marks counted</dt><dd>{Object.keys(g.specialValues).length ? Object.entries(g.specialValues).map(([k, v]) => `${k} counts as ${v}`).join("; ") : "None: INC, DRP and other special marks are left out"}</dd>
        <dt className="font-semibold text-[#062444]">Excluded when first saved</dt><dd>{g.excludedCodes.length ? g.excludedCodes.join(", ") : "None"}</dd>
        <dt className="font-semibold text-[#062444]">Retention requirement</dt><dd>{g.retentionThreshold != null ? `${g.retentionThreshold}${g.gradeUsed === "percentage" ? "%" : ""}` : "The school's existing requirement"}</dd>
      </dl>
      {showSample && scale && <SampleBox rules={rules} scale={scale} />}
    </div>
  );
}
