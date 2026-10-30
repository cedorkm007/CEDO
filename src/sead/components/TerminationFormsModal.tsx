import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Printer } from "lucide-react";
import { formatDay } from "@/lib/renewal";
import type { RemovalFormItem, RemovalFormState } from "@/lib/removalFormApi";
import { sortRemovalForms, type RemovalSortKey } from "@/lib/removalFormSort";
import { ModalShell } from "./SeadUiShell";

const COLUMNS: { key: RemovalSortKey; label: string }[] = [{ key: "name", label: "Name" }, { key: "yearLevel", label: "Year level" }, { key: "school", label: "School" }, { key: "program", label: "Program" }];
const STATE_TEXT: Record<RemovalFormState, string> = {
  waiting: "Waiting for the Division Head's approval", ready: "Approved: waiting for your final decision", done: "Approved: final decision made",
};
const STATE_STYLE: Record<RemovalFormState, string> = {
  waiting: "border-amber-400 bg-amber-50 text-amber-950", ready: "border-sky-400 bg-sky-50 text-sky-950", done: "border-green-400 bg-green-50 text-green-950",
};

/**
 * The list of the scholarship termination forms of the consulting staff member's removal cases: the ones still to be approved by the Division Head (no form yet) and the ones that were
 * approved and signed (the form can be downloaded), organized by name, year level, school and program (press a heading to order the list by it).
 */
export function TerminationFormsModal({ items, busyId, error, onDownload, onClose }: {
  items: RemovalFormItem[]; busyId: string | null; error: string; onDownload: (referralId: string) => void; onClose: () => void;
}) {
  const [sort, setSort] = useState<{ key: RemovalSortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });
  const sorted = useMemo(() => sortRemovalForms(items, sort.key, sort.dir), [items, sort]);
  const waiting = items.filter(i => i.state === "waiting").length;
  const press = (key: RemovalSortKey) => setSort(s => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));

  return (
    <ModalShell title="Scholarship termination forms" onClose={onClose} extraWide>
      <p className="text-[14px] text-slate-800 shrink-0">
        <strong>{items.length}</strong> removal{items.length === 1 ? "" : "s"}: {items.length - waiting} approved by the Division Head (download the form, print it and have it signed by the scholar and the parent or guardian), {waiting} still to be approved.
      </p>
      {error && <p role="alert" className="text-[14px] text-red-700 shrink-0">{error}</p>}
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-[#e6ecf5]">
        <table className="w-full min-w-[760px] text-left text-[14px]">
          <caption className="sr-only">Scholarship termination forms, organized by name, year level, school and program. Press a heading to order the list by it.</caption>
          <thead className="sticky top-0 bg-[#f7f9fc] text-[#062444]">
            <tr>
              {COLUMNS.map(c => (
                <th key={c.key} scope="col" aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"} className="px-3 py-2.5 font-bold">
                  <button type="button" onClick={() => press(c.key)} className="inline-flex items-center gap-1 hover:underline">
                    {c.label}{sort.key === c.key ? (sort.dir === 1 ? <ArrowUp size={13} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" />) : null}
                  </button>
                </th>
              ))}
              <th scope="col" className="px-3 py-2.5 font-bold">Status</th>
              <th scope="col" className="px-3 py-2.5 font-bold">Form</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(i => (
              <tr key={i.referralId} className="border-t border-[#eef3fb] align-top">
                <td className="px-3 py-2.5"><div className="font-bold text-[#062444]">{i.name}</div><div className="text-[13px] text-slate-600">{i.scholarIdNumber}</div></td>
                <td className="px-3 py-2.5 text-slate-800">{i.yearLevel || "—"}</td>
                <td className="px-3 py-2.5 text-slate-800">{i.school || "—"}</td>
                <td className="px-3 py-2.5 text-slate-800">{i.program || "—"}</td>
                <td className="px-3 py-2.5"><span className={`inline-block rounded-full border px-2.5 py-0.5 text-[13px] font-semibold ${STATE_STYLE[i.state]}`}>{STATE_TEXT[i.state]}</span>{i.issuedOn && <div className="mt-0.5 text-[13px] text-slate-600">Approved {formatDay(i.issuedOn)}</div>}</td>
                <td className="px-3 py-2.5">
                  {i.state === "waiting"
                    ? <span className="text-[13px] text-slate-700">Not yet available</span>
                    : <button type="button" onClick={() => onDownload(i.referralId)} disabled={busyId === i.referralId}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#062444] px-3 py-1.5 text-[13px] font-bold text-white hover:bg-[#0a3a6e] disabled:opacity-60">
                        {busyId === i.referralId ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Printer size={13} aria-hidden="true" />} {busyId === i.referralId ? "Preparing…" : "Download (PDF)"}
                        <span className="sr-only"> for {i.name}</span>
                      </button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ModalShell>
  );
}
