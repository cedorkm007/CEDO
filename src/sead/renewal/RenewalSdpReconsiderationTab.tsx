import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Search, XCircle } from "lucide-react";
import {
  decideSdpReconsideration, fetchSdpReconsiderationCounts, fetchSdpReconsiderations, SDP_RECONSIDERATION_PAGE_SIZE,
  type SdpReconsiderationCounts, type SdpReconsiderationFilter, type SdpReconsiderationRow,
} from "../sdpReconsiderationApi";
import { formatDateTime, sdpLackingText, sdpReconsiderationStatusText, termLabelOf } from "@/lib/renewal";
import { ListPagination } from "@/app/components/PaginatedList";
import { ReasonDialog } from "./ReasonDialog";
import { SdpCreditsModal } from "./RenewalScholarListTab";

const TONE: Record<"good" | "bad" | "warn" | "plain", string> = {
  good: "bg-green-100 text-green-950 border-green-300", bad: "bg-red-100 text-red-950 border-red-300", warn: "bg-amber-100 text-amber-950 border-amber-300", plain: "bg-slate-100 text-slate-900 border-slate-300",
};
const FILTERS: { key: SdpReconsiderationFilter; label: string }[] = [{ key: "pending", label: "Waiting for a decision" }, { key: "approved", label: "Approved" }, { key: "denied", label: "Not approved" }, { key: "all", label: "All" }];

/**
 * Scholar Renewal > SDP Reconsideration. A scholar who lacks SDP credits can ask, together with the renewal application, to be treated as complied. it.admin1 and the staff he
 * appoints (tag "SDP Reconsideration Approver") approve or deny here; the renewal evaluator can read the list. Approval: the scholar counts as complied for the semester the renewal
 * looked at, and the lacking credits are added to the next semester's requirement. The database enforces who may decide; the buttons only show for those who may.
 */
export function RenewalSdpReconsiderationTab({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) {
  const [filter, setFilter] = useState<SdpReconsiderationFilter>("pending");
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<SdpReconsiderationRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<SdpReconsiderationCounts | null>(null);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  const [notice, setNotice] = useState("");
  const [deciding, setDeciding] = useState<{ row: SdpReconsiderationRow; approve: boolean } | null>(null);
  const [viewing, setViewing] = useState<SdpReconsiderationRow | null>(null);

  useEffect(() => { const t = setTimeout(() => { setQuery(typed); setPage(1); }, 350); return () => clearTimeout(t); }, [typed]);

  const load = useCallback(async () => {
    const [l, c] = await Promise.all([fetchSdpReconsiderations(filter, query, page), fetchSdpReconsiderationCounts()]);
    if (!l.ok) { if (l.missing) setMissing(true); else setError(l.error); return; }
    setRows(l.rows); setTotal(l.total); setError("");
    if (c.ok) setCounts(c.counts);
  }, [filter, query, page]);
  useEffect(() => { void load(); }, [load, refreshKey]);

  if (missing) return <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[14px] text-amber-950">SDP reconsideration needs the latest database update (the three supabase_migration_sdp_reconsideration files). Until it is run, this tab cannot show requests.</p>;
  if (error) return <p role="alert" className="text-[14px] text-red-700">{error}</p>;

  const totalPages = Math.max(1, Math.ceil(total / SDP_RECONSIDERATION_PAGE_SIZE));
  const countOf = (k: SdpReconsiderationFilter) => counts ? (k === "pending" ? counts.pending : k === "approved" ? counts.approved : k === "denied" ? counts.denied : counts.pending + counts.approved + counts.denied) : null;

  return (
    <div>
      <p className="text-[14px] text-slate-700 mb-3">
        Scholars who lack SDP credits can ask, with their renewal application, to be treated as complied. <strong>If you approve</strong>, the scholar counts as complied with the SDP for the semester the renewal looks at, and the credits that were
        lacking are added to their SDP requirement for the next semester. <strong>If you deny</strong>, the renewal stays on hold until the missing credits are recorded. The scholar is told either way.
        {counts && !counts.canDecide && " You can read the requests; only it.admin1 and the staff he appoints can decide them."}
      </p>
      {notice && <p role="status" className="mb-3 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-[14px] text-green-950">{notice}</p>}

      <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Show requests">
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => { setFilter(f.key); setPage(1); setRows(null); }} aria-pressed={filter === f.key}
            className={`rounded-full border px-3 py-1.5 text-[14px] font-semibold ${filter === f.key ? "border-[#062444] bg-[#062444] text-white" : "border-[#062444]/25 bg-white text-[#062444] hover:bg-[#f7f9fc]"}`}>
            {f.label}{countOf(f.key) != null ? ` (${countOf(f.key)})` : ""}
          </button>
        ))}
      </div>
      <div className="relative mb-3 max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" aria-hidden="true" />
        <input value={typed} onChange={e => setTyped(e.target.value)} placeholder="Search by name or Scholar ID" aria-label="Search requests"
          className="w-full rounded-lg border border-[#062444]/25 py-2 pl-9 pr-3 text-[14px] outline-none focus:border-[#062444] bg-white" />
      </div>

      {!rows ? <p className="text-[14px] text-slate-700 flex items-center gap-2"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…</p>
      : rows.length === 0 ? <p className="rounded-xl border border-dashed border-[#e6ecf5] px-4 py-8 text-center text-[14px] text-slate-700">{query ? "No request matches your search." : filter === "pending" ? "No request is waiting for a decision." : "No requests here."}</p>
      : (
        <>
          <ul className="space-y-3">
            {rows.map(r => {
              const st = sdpReconsiderationStatusText(r.status);
              const nextLabel = r.nextSchoolYear ? termLabelOf(r.nextSchoolYear, r.nextSemester) : "the next semester";
              return (
                <li key={r.id} className="rounded-xl border border-[#e6ecf5] bg-white px-4 py-3.5 text-[14px]">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-[#062444] text-[15px]">{r.name} <span className="font-normal text-slate-600">· {r.scholarIdNumber}</span></p>
                      <p className="text-slate-800">{r.school || "No school"} · {r.program || "No program"} · {r.yearLevel || "No year level"} · {r.scholarStatus}</p>
                    </div>
                    <span className={`rounded-full border px-2.5 py-0.5 text-[13px] font-semibold ${TONE[st.tone]}`}>{st.text}</span>
                  </div>
                  <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[11rem_1fr]">
                    <dt className="text-slate-600">Applied for</dt><dd className="text-slate-900">{termLabelOf(r.schoolYear, r.term)} (asked {formatDateTime(r.requestedAt)})</dd>
                    <dt className="text-slate-600">SDP checked for</dt><dd className="text-slate-900">{termLabelOf(r.basisSchoolYear, r.basisTerm)}</dd>
                    <dt className="text-slate-600">Lacking</dt><dd className="font-semibold text-red-800">{sdpLackingText(r.lacking)}</dd>
                    <dt className="text-slate-600">If approved</dt><dd className="text-slate-900">Complied for {termLabelOf(r.basisSchoolYear, r.basisTerm)}; the lacking credits are added to the SDP requirement for {nextLabel}.</dd>
                    {r.status !== "pending" && <>
                      <dt className="text-slate-600">Decided</dt><dd className="text-slate-900">{r.decidedAt ? formatDateTime(r.decidedAt) : "—"}{r.decidedByLabel ? ` by ${r.decidedByLabel}` : ""}</dd>
                      {r.decisionNote && <><dt className="text-slate-600">Note</dt><dd className="text-slate-900 break-words">{r.decisionNote}</dd></>}
                    </>}
                    {r.previous.length > 0 && <>
                      <dt className="text-slate-600">Earlier requests</dt>
                      <dd className="flex flex-wrap gap-1.5">{r.previous.map((p, i) => {
                        const ps = sdpReconsiderationStatusText(p.status);
                        return <span key={i} className={`rounded-full border px-2 py-0.5 text-[13px] ${TONE[ps.tone]}`}>{termLabelOf(p.schoolYear, p.term)}: {ps.text.toLowerCase()}</span>;
                      })}</dd>
                    </>}
                  </dl>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button onClick={() => setViewing(r)} className="rounded-lg border border-[#062444]/25 bg-white px-3 py-1.5 font-semibold text-[#062444] hover:bg-[#f7f9fc]">View SDP credits</button>
                    {r.canDecide && (
                      <>
                        <button onClick={() => { setNotice(""); setDeciding({ row: r, approve: true }); }} className="inline-flex items-center gap-1.5 rounded-lg bg-green-800 px-3 py-1.5 font-bold text-white hover:bg-green-900"><CheckCircle2 size={15} aria-hidden="true" /> Approve</button>
                        <button onClick={() => { setNotice(""); setDeciding({ row: r, approve: false }); }} className="inline-flex items-center gap-1.5 rounded-lg bg-red-700 px-3 py-1.5 font-bold text-white hover:bg-red-800"><XCircle size={15} aria-hidden="true" /> Deny</button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="mt-3">
            <ListPagination page={page} totalPages={totalPages} onPageChange={setPage} filteredCount={total} pageSize={SDP_RECONSIDERATION_PAGE_SIZE} itemLabel="requests" />
          </div>
        </>
      )}

      {viewing && <SdpCreditsModal scholar={viewing} schoolYear={viewing.schoolYear} term={viewing.term} onClose={() => setViewing(null)} />}
      {deciding && (
        <ReasonDialog
          title={deciding.approve ? "Approve SDP reconsideration" : "Deny SDP reconsideration"}
          intro={deciding.approve
            ? <><strong>{deciding.row.name}</strong> will be treated as complied with the SDP for {termLabelOf(deciding.row.basisSchoolYear, deciding.row.basisTerm)}, and the lacking credits ({sdpLackingText(deciding.row.lacking)}) will be added to their SDP requirement for {deciding.row.nextSchoolYear ? termLabelOf(deciding.row.nextSchoolYear, deciding.row.nextSemester) : "the next semester"}. The scholar is told.</>
            : <>The renewal of <strong>{deciding.row.name}</strong> stays on hold until the missing SDP credits ({sdpLackingText(deciding.row.lacking)}) are recorded. The scholar is told, and sees your reason.</>}
          label={deciding.approve ? "Note to the scholar" : "Reason (the scholar will see this)"} confirmLabel={deciding.approve ? "Approve request" : "Deny request"}
          required={!deciding.approve} danger={!deciding.approve} minLength={3} onCancel={() => setDeciding(null)}
          onConfirm={async reason => {
            const r = await decideSdpReconsideration(deciding.row.id, deciding.approve, reason);
            if (!r.ok) return r.error;
            setNotice(r.result === "not_needed" ? `${deciding.row.name}'s SDP credits became complete before the decision, so the request was closed as not needed and nothing is added to the next semester.`
              : r.result === "approved" ? `Approved. ${deciding.row.name} is treated as complied and was told.` : `Denied. ${deciding.row.name} was told.`);
            setDeciding(null); onChanged(); await load(); return null;
          }}
        />
      )}
    </div>
  );
}
