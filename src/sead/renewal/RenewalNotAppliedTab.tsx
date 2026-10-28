import { useCallback, useEffect, useState } from "react";
import { useLiveReload } from "@/lib/liveUpdates";
import { Loader2, Search } from "lucide-react";
import { fetchNotAppliedPage, markNotRequired, NOT_APPLIED_PAGE_SIZE, type NotAppliedPageRow } from "../renewalApi";
import { fetchScholarInformationByIdNumber, type ScholarInformationRow } from "../seadApi";
import { gradesStatusText, referralStatusText, sdpStatusText } from "@/lib/renewal";
import { ListPagination } from "@/app/components/PaginatedList";
import { ReferralFormModal } from "../components/ReferralFormModal";
import { ReasonDialog } from "./ReasonDialog";

const TONE: Record<"good" | "bad" | "warn" | "plain", string> = {
  good: "text-green-900", bad: "text-red-800 font-semibold", warn: "text-amber-900 font-semibold", plain: "text-slate-800",
};

/**
 * Scholars who have not applied for the term (not Removed, not On leave), one page at a time, with the checks the renewal makes: SDP status, grades status
 * and the consultation referral (the "For Consultation" column that used to be on the Scholars tab). The evaluator can refer a scholar for a consultation
 * or mark one "Not required this term" with a reason. Every column is always visible: a table on a wide screen, one card per scholar on a narrow one.
 */
export function RenewalNotAppliedTab({ schoolYear, term, onChanged, refreshKey }: { schoolYear: string; term: string; onChanged: () => void; refreshKey: number }) {
  const [rows, setRows] = useState<NotAppliedPageRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [legacy, setLegacy] = useState(false);
  const [error, setError] = useState("");
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [marking, setMarking] = useState<NotAppliedPageRow | null>(null);
  const [referring, setReferring] = useState<ScholarInformationRow | null>(null);
  const [referError, setReferError] = useState("");
  const [referBusy, setReferBusy] = useState<string | null>(null);

  // the search waits for a pause in typing, then starts again from page 1
  useEffect(() => { const t = setTimeout(() => { setQuery(typed); setPage(1); }, 350); return () => clearTimeout(t); }, [typed]);

  const load = useCallback(async () => {
    const r = await fetchNotAppliedPage(schoolYear, term, query, page);
    if (r.ok) { setRows(r.rows); setTotal(r.total); setLegacy(r.legacy); setError(""); } else setError(r.error);
  }, [schoolYear, term, query, page]);
  useEffect(() => { setRows(null); void load(); }, [load, refreshKey]);
  useLiveReload(load);
  useEffect(() => { setPage(1); }, [schoolYear, term]);

  async function openReferral(r: NotAppliedPageRow) {
    setReferError(""); setReferBusy(r.scholarIdNumber);
    const scholar = await fetchScholarInformationByIdNumber(r.scholarIdNumber);
    setReferBusy(null);
    if (!scholar) { setReferError("Couldn't open this scholar's record to make the referral."); return; }
    setReferring(scholar);
  }

  if (error) return <p role="alert" className="text-[14px] text-red-700">{error}</p>;

  const totalPages = Math.max(1, Math.ceil(total / NOT_APPLIED_PAGE_SIZE));

  /** The three new cells, as text with a colour (used by both the table and the cards). */
  const cells = (r: NotAppliedPageRow) => {
    const sdp = legacy ? null : sdpStatusText({ applicable: r.sdpApplicable, complied: r.sdpComplied, missing: r.sdpMissing });
    const grades = legacy ? null : gradesStatusText({ state: r.gradesState, failed: r.failedCount, inc: r.incCount, review: r.reviewCount });
    const referral = referralStatusText(r.referralStatus);
    return { sdp, grades, referral };
  };
  const referralCell = (r: NotAppliedPageRow, referral: string | null) => referral
    ? <span className="font-semibold text-slate-800">{referral}</span>
    : legacy ? <span className="text-slate-700">Needs the database update</span>
    : <button onClick={() => void openReferral(r)} disabled={referBusy === r.scholarIdNumber} className="font-semibold text-[#00709f] hover:underline disabled:opacity-60">{referBusy === r.scholarIdNumber ? "Opening…" : "Refer for consultation"}</button>;

  return (
    <div>
      <p className="text-[14px] text-slate-700 mb-3">Scholars who have not applied for this term, with their SDP status, their grades and the consultation referral. Removed and On leave scholars are left out.</p>
      {legacy && <p role="status" className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[14px] text-amber-950">The SDP status, grades status and referral need the latest database update; until it is run they are not shown.</p>}
      <div className="relative mb-3 max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" aria-hidden="true" />
        <input value={typed} onChange={e => setTyped(e.target.value)} placeholder="Search by name, ID or school" aria-label="Search scholars who have not applied"
          className="w-full rounded-lg border border-[#062444]/25 py-2 pl-9 pr-3 text-[14px] outline-none focus:border-[#062444] bg-white" />
      </div>
      {referError && <p role="alert" className="mb-2 text-[14px] text-red-700">{referError}</p>}

      {!rows ? <p className="text-[14px] text-slate-700 flex items-center gap-2"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…</p>
      : rows.length === 0 ? <p className="rounded-xl border border-dashed border-[#e6ecf5] px-4 py-8 text-center text-[14px] text-slate-700">{query ? "No scholar matches your search." : "Everyone has applied, or been marked as not required."}</p>
      : (
        <>
          {/* wide screens: one table, every column visible without sideways scrolling */}
          <div className="hidden lg:block rounded-xl border border-[#e6ecf5] bg-white" aria-label="Scholars who have not applied">
            <table className="w-full table-fixed text-left text-[14px]">
              <thead className="bg-[#f7f9fc] text-[#062444]">
                <tr>
                  {[["Scholar", "w-[19%]"], ["School", "w-[14%]"], ["Program · Year", "w-[12%]"], ["Status", "w-[8%]"], ["SDP status", "w-[13%]"], ["Grades status", "w-[12%]"], ["Referral", "w-[13%]"], ["Action", "w-[9%]"]].map(([h, w]) => <th key={h} scope="col" className={`px-2.5 py-2.5 font-bold align-bottom ${w}`}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const { sdp, grades, referral } = cells(r);
                  return (
                    <tr key={r.scholarIdNumber} className="border-t border-[#eef3fb] align-top">
                      <td className="px-2.5 py-2.5 break-words"><div className="font-bold text-[#062444]">{r.name}</div><div className="text-[13px] text-slate-600">{r.scholarIdNumber}</div></td>
                      <td className="px-2.5 py-2.5 text-slate-800 break-words">{r.school}</td>
                      <td className="px-2.5 py-2.5 text-slate-800 break-words">{r.program} · {r.yearLevel}</td>
                      <td className="px-2.5 py-2.5 text-slate-800 break-words">{r.status}</td>
                      <td className={`px-2.5 py-2.5 break-words ${sdp ? TONE[sdp.tone] : "text-slate-800"}`}>{sdp?.text ?? "—"}{sdp?.detail && <span className="block text-[13px] font-normal text-slate-700">{sdp.detail}</span>}</td>
                      <td className={`px-2.5 py-2.5 break-words ${grades ? TONE[grades.tone] : "text-slate-800"}`}>{grades?.text ?? "—"}</td>
                      <td className="px-2.5 py-2.5 break-words">{referralCell(r, referral)}</td>
                      <td className="px-2.5 py-2.5"><button onClick={() => setMarking(r)} className="font-semibold text-[#00709f] hover:underline text-left">Mark not required</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* narrow screens: one card per scholar, same information */}
          <ul className="lg:hidden space-y-2.5">
            {rows.map(r => {
              const { sdp, grades, referral } = cells(r);
              return (
                <li key={r.scholarIdNumber} className="rounded-xl border border-[#e6ecf5] bg-white px-3.5 py-3 text-[14px]">
                  <p className="font-bold text-[#062444]">{r.name} <span className="font-normal text-slate-600">· {r.scholarIdNumber}</span></p>
                  <p className="text-slate-800">{r.school} · {r.program} · {r.yearLevel} · {r.status}</p>
                  <dl className="mt-1.5 grid grid-cols-[7.5rem_1fr] gap-x-2 gap-y-0.5">
                    <dt className="text-slate-600">SDP status</dt><dd className={sdp ? TONE[sdp.tone] : ""}>{sdp?.text ?? "—"}{sdp?.detail && <span className="block text-[13px] font-normal text-slate-700">{sdp.detail}</span>}</dd>
                    <dt className="text-slate-600">Grades status</dt><dd className={grades ? TONE[grades.tone] : ""}>{grades?.text ?? "—"}</dd>
                    <dt className="text-slate-600">Referral</dt><dd>{referralCell(r, referral)}</dd>
                  </dl>
                  <button onClick={() => setMarking(r)} className="mt-2 font-semibold text-[#00709f] hover:underline">Mark not required</button>
                </li>
              );
            })}
          </ul>
          <div className="mt-3">
            <ListPagination page={page} totalPages={totalPages} onPageChange={setPage} filteredCount={total} pageSize={NOT_APPLIED_PAGE_SIZE} itemLabel="scholars who have not applied" />
          </div>
        </>
      )}

      {marking && (
        <ReasonDialog
          title="Mark as not required this term" intro={<>{marking.name} will leave the “Not applied” list for this term.</>}
          label="Reason (for example: graduating)" confirmLabel="Mark not required" onCancel={() => setMarking(null)}
          onConfirm={async reason => {
            const r = await markNotRequired(marking.scholarIdNumber, schoolYear, term, reason);
            if (!r.ok) return r.error;
            setMarking(null); onChanged(); await load(); return null;
          }}
        />
      )}
      {referring && (
        <ReferralFormModal mode="create" scholar={referring} onClose={() => setReferring(null)} onDone={() => { setReferring(null); void load(); }} />
      )}
    </div>
  );
}
