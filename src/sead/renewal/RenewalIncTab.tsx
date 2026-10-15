import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { daysLeftText, formatDay, manilaToday } from "@/lib/renewal";
import { decideInc, fetchIncList, type IncDecision, type IncRow } from "../renewalApi";
import { ReasonDialog } from "./ReasonDialog";

type Choice = "extend" | "count_failed" | "Probationary" | "Regular" | "removal" | "other";
const CHOICES: { value: Choice; label: string; help: string }[] = [
  { value: "extend", label: "Extend the deadline", help: "Give the scholar more time." },
  { value: "count_failed", label: "Count the INC as a failed subject", help: "The normal rules then apply (study plan or Division Head)." },
  { value: "Probationary", label: "Change the status to Probationary", help: "Counts as previous probation in future renewals." },
  { value: "Regular", label: "Change the status to Regular", help: "Lifts the temporary probation; does not count as previous probation." },
  { value: "removal", label: "Refer for removal", help: "The case goes to the Division Head." },
  { value: "other", label: "Another action (describe it below)", help: "Closes the INC case; your notes are kept." },
];

/** INC compliance (open INCs, soonest deadline first) and the "INC deadline passed — decision needed" list. */
export function RenewalIncTab({ schoolYear, term, onOpen, onChanged, refreshKey }: { schoolYear: string; term: string; onOpen: (id: string) => void; onChanged: () => void; refreshKey: number }) {
  const [rows, setRows] = useState<IncRow[] | null>(null);
  const [error, setError] = useState("");
  const [deciding, setDeciding] = useState<IncRow | null>(null);
  const [choice, setChoice] = useState<Choice>("extend");
  const [newDeadline, setNewDeadline] = useState("");

  const load = useCallback(async () => {
    const r = await fetchIncList(schoolYear, term);
    if (r.ok) { setRows(r.rows); setError(""); } else setError(r.error);
  }, [schoolYear, term]);
  useEffect(() => { setRows(null); void load(); }, [load, refreshKey]);

  if (error) return <p role="alert" className="text-[14px] text-red-700">{error}</p>;
  if (!rows) return <p className="text-[14px] text-slate-700 flex items-center gap-2"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…</p>;
  const passed = rows.filter(r => r.daysLeft !== null && r.daysLeft < 0);
  const compliance = rows.filter(r => !(r.daysLeft !== null && r.daysLeft < 0));
  const today = manilaToday();

  function build(reason: string): IncDecision {
    if (choice === "extend") return { action: "extend", reason, newDeadline };
    if (choice === "count_failed") return { action: "count_failed", reason };
    if (choice === "other") return { action: "other", reason };
    return { action: "set_status", reason, status: choice };
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-[15px] font-bold text-red-800 mb-2">INC deadline passed — decision needed ({passed.length})</h2>
        {passed.length === 0 ? <p className="rounded-xl border border-dashed border-[#e6ecf5] px-4 py-6 text-[14px] text-slate-700">No INC deadline has passed without a completed grade.</p> : (
          <ul className="space-y-2">
            {passed.map(r => (
              <li key={r.itemId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                <div>
                  <button onClick={() => onOpen(r.recordId)} className="font-bold text-[#00709f] hover:underline text-[14px]">{r.name}</button>
                  <p className="text-[13.5px] text-slate-800">{r.scholarIdNumber} · {r.subject} · deadline {formatDay(r.deadline)} ({daysLeftText(r.daysLeft)})</p>
                </div>
                <button onClick={() => { setDeciding(r); setChoice("extend"); setNewDeadline(""); }} className="rounded-lg bg-[#062444] px-3.5 py-2 text-[14px] font-bold text-white hover:bg-[#0a3a6e]">Decide</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-[15px] font-bold text-[#062444] mb-2">INC compliance — fewest days left first ({compliance.length})</h2>
        {compliance.length === 0 ? <p className="text-[14px] text-slate-700">No open INC subjects for this term.</p> : (
          <div className="overflow-x-auto rounded-xl border border-[#e6ecf5] bg-white" tabIndex={0} role="region" aria-label="INC compliance">
            <table className="w-full min-w-[760px] text-left text-[14px]">
              <thead className="bg-[#f7f9fc] text-[#062444]"><tr>{["Scholar", "School", "Subject", "Consultation", "Deadline", "Days left"].map(h => <th key={h} scope="col" className="px-3 py-2.5 font-bold">{h}</th>)}</tr></thead>
              <tbody>
                {compliance.map(r => (
                  <tr key={r.itemId} className="border-t border-[#eef3fb]">
                    <td className="px-3 py-2.5"><button onClick={() => onOpen(r.recordId)} className="font-bold text-[#00709f] hover:underline text-left">{r.name}</button><div className="text-[13px] text-slate-600">{r.scholarIdNumber}</div></td>
                    <td className="px-3 py-2.5 text-slate-800">{r.school}</td>
                    <td className="px-3 py-2.5 text-slate-800">{r.subject}</td>
                    <td className="px-3 py-2.5 text-slate-800">{r.consultationDate ? `${formatDay(r.consultationDate)} (${r.daysGiven} days given)` : "Not yet"}</td>
                    <td className="px-3 py-2.5 text-slate-800">{r.deadline ? formatDay(r.deadline) : "To be set at consultation"}</td>
                    <td className="px-3 py-2.5 font-bold text-[#062444]">{r.daysLeft === null ? "—" : daysLeftText(r.daysLeft)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {deciding && (
        <ReasonDialog
          title="Decide this INC case"
          intro={<>{deciding.name} did not complete the INC in <strong>{deciding.subject}</strong> by {formatDay(deciding.deadline)}. Choose what happens next and write the reason (the scholar's history keeps it).</>}
          label={choice === "other" ? "Describe the action and why" : "Reason"} confirmLabel="Save decision" minLength={5}
          extraValid={choice !== "extend" || newDeadline > today}
          onCancel={() => setDeciding(null)}
          onConfirm={async reason => {
            const r = await decideInc(deciding.itemId, build(reason));
            if (!r.ok) return r.error;
            setDeciding(null); onChanged(); await load(); return null;
          }}
        >
          <fieldset className="mb-3">
            <legend className="text-[14px] font-semibold text-[#062444] mb-1">What do you decide?</legend>
            <div className="space-y-1.5">
              {CHOICES.map(c => (
                <label key={c.value} className="flex items-start gap-2 text-[14px] text-slate-800">
                  <input type="radio" name="inc-choice" checked={choice === c.value} onChange={() => setChoice(c.value)} className="mt-1" />
                  <span><span className="font-semibold text-[#062444]">{c.label}</span><br /><span className="text-slate-700">{c.help}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
          {choice === "extend" && (
            <label className="block text-[14px] font-semibold text-[#062444] mb-3">New deadline
              <input type="date" min={today} value={newDeadline} onChange={e => setNewDeadline(e.target.value)} className="mt-1 block rounded-lg border border-[#062444]/25 px-3 py-2 text-[14px] font-normal bg-white" />
            </label>
          )}
        </ReasonDialog>
      )}
    </div>
  );
}
