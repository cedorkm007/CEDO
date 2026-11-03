import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveReload } from "@/lib/liveUpdates";
import { Loader2, RefreshCw, Search } from "lucide-react";
import { RenewalStageBadge } from "@/app/components/RenewalStageBadge";
import { ListPagination } from "@/app/components/PaginatedList";
import { formatDateTime, termLabelOf, type RenewalStage } from "@/lib/renewal";
import { NO_ROLES, type NeededAction, neededActions, type ScholarActionFacts, type ViewerRoles } from "@/lib/renewalActions";
import { FIRST_SUBTAB, GRADES_FILTER_OPTIONS, LIST_TAB_LABEL, SDP_FILTER_OPTIONS, statusColumnText, SUBTABS, type RenewalListTab, type RenewalSubTab } from "@/lib/renewalTabs";
import { fetchScholarActions, refreshScholarListStep, type ScholarListRow } from "../renewalScholarListApi";
import {
  EMPTY_RENEWAL_LIST_FILTERS, fetchRenewalList, fetchRenewalListCounts, fetchRenewalListOptions, RENEWAL_LIST_PAGE_SIZE,
  type RenewalListFilters, type RenewalListOptions, type RenewalListRow,
} from "../renewalTabsApi";
import { markNotRequired } from "../renewalApi";
import { ModalShell } from "../components/SeadUiShell";
import { ReferralFormModal } from "../components/ReferralFormModal";
import { ReferralFormPanel } from "../components/ReferralFormPanel";
import { fetchScholarInformationByIdNumber, type ScholarInformationRow } from "../seadApi";
import { ActionCell, GradesCell, MultiSelect, SdpCell, SdpCreditsModal } from "./RenewalScholarListTab";
import { RenewalEnteredGradesTab } from "./RenewalEnteredGradesTab";
import { RenewalSdpReconsiderationTab } from "./RenewalSdpReconsiderationTab";
import { RenewalIncTab } from "./RenewalIncTab";
import { ReasonDialog } from "./ReasonDialog";

const INTRO: Record<RenewalListTab, string> = {
  applications: "The scholars who applied and are not renewed yet, by the grades of the semester the renewal looks at (worst case first: a scholar is in one sub-tab only). Late and returned applications are here too.",
  renewed: "The scholars whose renewal was confirmed, by the status they are renewed with. The status column shows where the scholar came from and where the scholar is now.",
  not_applied: "The scholars who can renew in this term and have not applied, by the grades of the semester the renewal looks at (worst case first). The grades and the SDP are those of the last check (Refresh).",
};
const EMPTY: Record<RenewalListTab, string> = { applications: "Nobody here.", renewed: "Nobody here.", not_applied: "Nobody here." };

type ActingKey = "approve_grades" | "decide_sdp" | "decide_case" | "decide_inc";

/**
 * Scholar Renewal > Applications / Renewed / Not applied. One list with sub-tabs (the numbers on them follow the filters), the filters (search, school, year level, program, scholarship status, SDP,
 * grades) and the columns Scholar ID, Name, Year level, School, Program, Scholarship status, SDP, Grades and (Applications, Not applied) Actions. The Actions column shows what waits on staff; only the
 * staff assigned to an action can press it, the others see who it is waiting for. A table on a wide screen, one card per scholar on a narrow one.
 */
export function RenewalListTab({ tab, schoolYear, term, refreshKey, viewer = NO_ROLES, onOpenRecord, onChanged, onGoToDocuments }: {
  tab: RenewalListTab; schoolYear: string; term: string; refreshKey: number; viewer?: ViewerRoles; onOpenRecord: (recordId: string) => void; onChanged?: () => void;
  /** Opens the Documents tab (the "Review N documents" button of the Renewal Documents Approver). */
  onGoToDocuments?: () => void;
}) {
  const [sub, setSub] = useState<RenewalSubTab>(FIRST_SUBTAB[tab]);
  const [filters, setFilters] = useState<RenewalListFilters>(EMPTY_RENEWAL_LIST_FILTERS);
  const [typed, setTyped] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<RenewalListRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Partial<Record<RenewalSubTab, number>> | null>(null);
  const [options, setOptions] = useState<RenewalListOptions | null>(null);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  const [refreshing, setRefreshing] = useState<{ done: number; total: number } | null>(null);
  const [refreshError, setRefreshError] = useState("");
  const [viewing, setViewing] = useState<RenewalListRow | null>(null);
  const [facts, setFacts] = useState<Record<string, ScholarActionFacts> | null>(null);       // null = not loaded yet
  const [actionsMissing, setActionsMissing] = useState(false);
  const [acting, setActing] = useState<{ key: ActingKey; row: RenewalListRow; facts: ScholarActionFacts } | null>(null);
  const [referring, setReferring] = useState<ScholarInformationRow | null>(null);
  const [referBusy, setReferBusy] = useState<string | null>(null);
  const [marking, setMarking] = useState<RenewalListRow | null>(null);
  const [actionError, setActionError] = useState("");
  const autoTried = useRef("");
  const picked = useRef(false);        // the person chose a sub-tab: the list stops moving to a sub-tab by itself
  const hasActions = tab !== "renewed";

  // a new list or a new term starts from the first sub-tab with no filter
  useEffect(() => { picked.current = false; setSub(FIRST_SUBTAB[tab]); setFilters(EMPTY_RENEWAL_LIST_FILTERS); setTyped(""); setPage(1); setRows(null); setCounts(null); }, [tab, schoolYear, term]);
  // the search waits for a pause in typing, then starts again from page 1
  useEffect(() => { const t = setTimeout(() => { setFilters(f => (f.query === typed ? f : { ...f, query: typed })); setPage(1); }, 350); return () => clearTimeout(t); }, [typed]);
  const change = (patch: Partial<RenewalListFilters>) => { setFilters(f => ({ ...f, ...patch })); setPage(1); };
  const anyFilter = filters.query !== "" || filters.schoolIds.length > 0 || filters.yearLevels.length > 0 || filters.programs.length > 0 || filters.statuses.length > 0 || filters.sdp !== null || filters.grades !== null;
  const clear = () => { setTyped(""); setFilters(EMPTY_RENEWAL_LIST_FILTERS); setPage(1); };

  const loadOptions = useCallback(async () => {
    const r = await fetchRenewalListOptions(schoolYear, term);
    if (r.ok) { setOptions(r.options); setMissing(false); } else if (r.missing) setMissing(true); else setError(r.error);
  }, [schoolYear, term]);
  const loadList = useCallback(async () => {
    const [l, c] = await Promise.all([fetchRenewalList(schoolYear, term, tab, sub, filters, page), fetchRenewalListCounts(schoolYear, term, tab, filters)]);
    if (!l.ok) { if (l.missing) setMissing(true); else setError(l.error); return; }
    setRows(l.rows); setTotal(l.total); setError("");
    if (c.ok) setCounts(c.counts);
    if (hasActions) {
      const a = await fetchScholarActions(schoolYear, term, l.rows.map(x => x.scholarIdNumber));
      if (a.ok) { setFacts(a.facts); setActionsMissing(false); } else if (a.missing) { setActionsMissing(true); setFacts({}); } else setFacts({});
    }
  }, [schoolYear, term, tab, sub, filters, page, hasActions]);

  useEffect(() => { setOptions(null); void loadOptions(); }, [loadOptions, refreshKey]);
  // a list opens on its first sub-tab that has scholars (the first one, "Complete", is empty while the grades are not in yet)
  useEffect(() => {
    if (picked.current || !counts || (counts[sub] ?? 0) > 0) return;
    const next = SUBTABS[tab].find(x => (counts[x.key] ?? 0) > 0);
    if (next) { setSub(next.key); setPage(1); setRows(null); }
  }, [counts, sub, tab]);
  useEffect(() => { if (!missing) void loadList(); }, [loadList, missing, refreshKey]);
  useLiveReload(async () => { if (!missing) { void loadOptions(); await loadList(); } });      // a decision, a booking or new grades: update in place

  /** Checks everybody again, 100 scholars at a time (the grades and SDP of the scholars who have not applied come from this check). */
  const refresh = useCallback(async () => {
    setRefreshError(""); setRefreshing({ done: 0, total: 0 });
    let since: string | null = null, guard = 0;
    for (;;) {
      const s = await refreshScholarListStep(schoolYear, term, since, 100);
      if (!s.ok) { setRefreshError(s.error); break; }
      since = s.since;
      setRefreshing({ done: s.total - s.remaining, total: s.total });
      if (s.remaining <= 0) break;
      if (s.done === 0 || ++guard > 400) { setRefreshError("The check stopped before it finished. Please press Refresh again."); break; }
    }
    setRefreshing(null);
    await loadOptions(); await loadList();
  }, [schoolYear, term, loadOptions, loadList]);

  // the first time the lists are opened for a term nothing has been checked yet: start the check by itself
  useEffect(() => {
    const key = `${schoolYear}|${term}`;
    if (viewer.evaluator && options && options.scholars > 0 && options.checked === 0 && autoTried.current !== key && !refreshing) { autoTried.current = key; void refresh(); }
  }, [options, schoolYear, term, refresh, refreshing, viewer.evaluator]);

  /** A button of the Actions column: opens the screen where the person with that role decides (the database checks the role again). */
  async function act(a: NeededAction, r: RenewalListRow, f: ScholarActionFacts) {
    setActionError("");
    if (a.key === "open_application") { if (f.recordId) onOpenRecord(f.recordId); return; }
    if (a.key === "review_documents") { onGoToDocuments?.(); return; }
    if (a.key === "mark_not_required") { setMarking(r); return; }
    if (a.key === "refer_consultation") {
      setReferBusy(r.scholarIdNumber);
      const scholar = await fetchScholarInformationByIdNumber(r.scholarIdNumber);
      setReferBusy(null);
      if (!scholar) { setActionError("Couldn't open this scholar's record to make the referral."); return; }
      setReferring(scholar); return;
    }
    setActing({ key: a.key as ActingKey, row: r, facts: f });
  }
  const afterAct = () => { setActing(null); setReferring(null); onChanged?.(); void loadList(); };

  /** The actions of a row: what waits on staff, and (Not applied) the evaluator's "Mark not required". */
  const actionsOf = useCallback((r: ScholarListRow, f: ScholarActionFacts | null): NeededAction[] => {
    const list = neededActions(r, f);
    if (tab === "not_applied" && f && !f.recordId) list.push({ key: "mark_not_required", role: "evaluator", label: "Mark not required" });
    return list;
  }, [tab]);

  const subtabs = SUBTABS[tab];
  const totalPages = Math.max(1, Math.ceil(total / RENEWAL_LIST_PAGE_SIZE));
  const notChecked = options ? Math.max(0, options.scholars - options.checked) : 0;
  const ready = facts !== null && !actionsMissing;
  const emptyText = useMemo(() => {
    if (refreshing) return "Checking the scholars…";
    if (anyFilter) return "No scholar matches these filters.";
    const elsewhere = counts ? Object.entries(counts).filter(([k]) => k !== sub).reduce((n, [, v]) => n + (v ?? 0), 0) : 0;
    return elsewhere > 0 ? `Nobody here. ${elsewhere} scholar${elsewhere === 1 ? " is" : "s are"} on the other sub-tabs above.` : EMPTY[tab];
  }, [refreshing, anyFilter, tab, counts, sub]);

  if (missing) return <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[14px] text-amber-950">These lists need the latest database update (supabase_migration_renewal_tabs.sql). Until it is run, this tab cannot show the list.</p>;
  if (error) return <p role="alert" className="text-[14px] text-red-700">{error}</p>;

  const actionsCell = (r: RenewalListRow) => <ActionCell r={r} facts={facts?.[r.scholarIdNumber] ?? null} ready={ready} viewer={viewer} busy={referBusy} onAct={(a, row, f) => void act(a, row as RenewalListRow, f)} actionsFor={actionsOf} />;
  const stageCell = (r: RenewalListRow) => (r.stage && tab === "applications" ? <div className="mt-0.5"><RenewalStageBadge stage={r.stage as RenewalStage} />{r.isLate && r.stage !== "late_pending" ? <span className="ml-1 text-[13px] text-amber-900">late</span> : null}</div> : null);

  return (
    <div>
      <p className="text-[14px] text-slate-700 mb-3">{LIST_TAB_LABEL[tab]} for {termLabelOf(schoolYear, term)}. {INTRO[tab]}</p>

      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[14px] text-slate-800">
        <span>{options?.lastChecked ? <>Grades and SDP of the scholars who have not applied: checked {formatDateTime(options.lastChecked)}</> : "Not checked yet"}{notChecked > 0 && !refreshing ? <> · <strong>{notChecked}</strong> scholar{notChecked === 1 ? "" : "s"} not checked yet</> : null}</span>
        {viewer.evaluator && <button onClick={() => void refresh()} disabled={!!refreshing || !options} className="inline-flex items-center gap-1.5 rounded-lg border border-[#062444]/25 bg-white px-3 py-1.5 font-semibold text-[#062444] hover:bg-[#f7f9fc] disabled:opacity-60">
          <RefreshCw size={14} aria-hidden="true" className={refreshing ? "animate-spin" : ""} /> {refreshing ? "Checking…" : "Refresh"}
        </button>}
        {refreshing && <span role="status" className="text-slate-800">{refreshing.total > 0 ? `Checked ${refreshing.done} of ${refreshing.total} scholars…` : "Starting…"}</span>}
      </div>
      {refreshing && refreshing.total > 0 && <div className="mb-3 h-2 w-full max-w-md overflow-hidden rounded-full bg-[#e6ecf5]" aria-hidden="true"><div className="h-full bg-[#00709f] transition-all" style={{ width: `${Math.round((refreshing.done / refreshing.total) * 100)}%` }} /></div>}
      {refreshError && <p role="alert" className="mb-3 text-[14px] text-red-700">{refreshError}</p>}
      {actionError && <p role="alert" className="mb-3 text-[14px] text-red-700">{actionError}</p>}
      {hasActions && actionsMissing && <p role="status" className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[14px] text-amber-950">The Actions column needs the latest database update (supabase_migration_renewal_actions_needed.sql). Until it is run it stays empty.</p>}

      {/* filters: tick several in each; all kinds apply together */}
      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <div className="relative sm:col-span-2 lg:col-span-4 xl:col-span-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" aria-hidden="true" />
          <input value={typed} onChange={e => setTyped(e.target.value)} placeholder="Search name or ID" aria-label="Search scholars"
            className="w-full rounded-lg border border-[#062444]/25 py-2 pl-9 pr-3 text-[14px] outline-none focus:border-[#062444] bg-white" />
        </div>
        <MultiSelect label="Year level" options={(options?.yearLevels ?? []).map(y => ({ value: y, label: y }))} selected={filters.yearLevels} onChange={yearLevels => change({ yearLevels })} />
        <MultiSelect label="School" options={(options?.schools ?? []).filter(s => s.id).map(s => ({ value: s.id as string, label: s.name }))} selected={filters.schoolIds} onChange={schoolIds => change({ schoolIds })} />
        <MultiSelect label="Program" options={(options?.programs ?? []).map(p => ({ value: p, label: p }))} selected={filters.programs} onChange={programs => change({ programs })} />
        <MultiSelect label="Scholarship status" options={(options?.statuses ?? []).map(s => ({ value: s, label: s }))} selected={filters.statuses} onChange={statuses => change({ statuses })} />
        <select aria-label="SDP" value={filters.sdp ?? ""} onChange={e => change({ sdp: e.target.value || null })}
          className={`rounded-lg border px-3 py-2 text-[14px] bg-white ${filters.sdp ? "border-[#062444] font-semibold text-[#062444]" : "border-[#062444]/25 text-slate-800"}`}>
          <option value="">SDP: all</option>
          {SDP_FILTER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select aria-label="Grades" value={filters.grades ?? ""} onChange={e => change({ grades: e.target.value || null })}
          className={`rounded-lg border px-3 py-2 text-[14px] bg-white ${filters.grades ? "border-[#062444] font-semibold text-[#062444]" : "border-[#062444]/25 text-slate-800"}`}>
          <option value="">Grades: all</option>
          {GRADES_FILTER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      {anyFilter && <p className="mb-3 text-[14px] text-slate-800"><button onClick={clear} className="font-semibold text-[#00709f] hover:underline">Clear all filters</button></p>}

      {/* the sub-tabs, with the number of scholars on each */}
      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label={`${LIST_TAB_LABEL[tab]} sub-tabs`}>
        {subtabs.map(s => (
          <button key={s.key} onClick={() => { picked.current = true; setSub(s.key); setPage(1); setRows(null); }} aria-pressed={sub === s.key} title={s.hint}
            className={`rounded-full border px-3 py-1.5 text-[14px] font-semibold ${sub === s.key ? "border-[#062444] bg-[#062444] text-white" : "border-[#062444]/25 bg-white text-[#062444] hover:bg-[#f7f9fc]"}`}>
            {s.label} <span className={`ml-1 font-bold ${sub === s.key ? "text-[#F3BC00]" : "text-[#006aa3]"}`}>{counts ? counts[s.key] ?? 0 : "…"}</span>
          </button>
        ))}
      </div>
      <p className="mb-3 text-[13.5px] text-slate-700">{subtabs.find(s => s.key === sub)?.hint}</p>

      {!rows ? <p className="text-[14px] text-slate-700 flex items-center gap-2"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…</p>
      : rows.length === 0 ? <p className="rounded-xl border border-dashed border-[#e6ecf5] px-4 py-8 text-center text-[14px] text-slate-700">{emptyText}</p>
      : (
        <>
          <div className="hidden xl:block rounded-xl border border-[#e6ecf5] bg-white" aria-label={`${LIST_TAB_LABEL[tab]} list`}>
            <table className="w-full table-fixed text-left text-[14px]">
              <thead className="bg-[#f7f9fc] text-[#062444]">
                <tr>
                  {[["Scholar ID", "w-[9%]"], ["Name", hasActions ? "w-[13%]" : "w-[16%]"], ["Year level", "w-[7%]"], ["School", hasActions ? "w-[13%]" : "w-[16%]"], ["Program", hasActions ? "w-[13%]" : "w-[16%]"],
                    ["Scholarship status", "w-[10%]"], ["SDP", "w-[10%]"], ["Grades", hasActions ? "w-[11%]" : "w-[16%]"], ...(hasActions ? [["Actions", "w-[14%]"]] : [])]
                    .map(([h, w]) => <th key={h} scope="col" className={`px-2 py-2.5 font-bold align-bottom ${w}`}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.scholarIdNumber} className="border-t border-[#eef3fb] align-top">
                    <td className="px-2 py-2.5 break-words text-slate-800">{r.scholarIdNumber}</td>
                    <td className="px-2 py-2.5 break-words">
                      {r.recordId ? <button onClick={() => onOpenRecord(r.recordId as string)} className="font-bold text-[#00709f] hover:underline text-left">{r.name}</button> : <span className="font-bold text-[#062444]">{r.name}</span>}
                      {stageCell(r)}
                    </td>
                    <td className="px-2 py-2.5 break-words text-slate-800">{r.yearLevel || "—"}</td>
                    <td className="px-2 py-2.5 break-words text-slate-800">{r.school || "—"}</td>
                    <td className="px-2 py-2.5 break-words text-slate-800">{r.program || "—"}</td>
                    <td className="px-2 py-2.5 break-words text-slate-900">{statusColumnText(tab, r.status, r.fromStatus, r.toStatus)}</td>
                    <td className="px-2 py-2.5 break-words"><SdpCell r={r} onView={x => setViewing(x as RenewalListRow)} /></td>
                    <td className="px-2 py-2.5 break-words"><GradesCell r={r} /></td>
                    {hasActions && <td className="px-2 py-2.5 break-words">{actionsCell(r)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="xl:hidden space-y-2.5">
            {rows.map(r => (
              <li key={r.scholarIdNumber} className="rounded-xl border border-[#e6ecf5] bg-white px-3.5 py-3 text-[14px]">
                <p className="font-bold text-[#062444]">
                  {r.recordId ? <button onClick={() => onOpenRecord(r.recordId as string)} className="text-[#00709f] hover:underline text-left">{r.name}</button> : r.name} <span className="font-normal text-slate-600">· {r.scholarIdNumber}</span>
                </p>
                {stageCell(r)}
                <dl className="mt-1.5 grid grid-cols-[7.5rem_1fr] gap-x-2 gap-y-1.5">
                  <dt className="text-slate-600">Year level</dt><dd>{r.yearLevel || "—"}</dd>
                  <dt className="text-slate-600">School</dt><dd>{r.school || "—"}</dd>
                  <dt className="text-slate-600">Program</dt><dd>{r.program || "—"}</dd>
                  <dt className="text-slate-600">Scholarship status</dt><dd>{statusColumnText(tab, r.status, r.fromStatus, r.toStatus)}</dd>
                  <dt className="text-slate-600">SDP</dt><dd><SdpCell r={r} onView={x => setViewing(x as RenewalListRow)} /></dd>
                  <dt className="text-slate-600">Grades</dt><dd><GradesCell r={r} /></dd>
                  {hasActions && <><dt className="text-slate-600">Actions</dt><dd>{actionsCell(r)}</dd></>}
                </dl>
              </li>
            ))}
          </ul>
          <div className="mt-3">
            <ListPagination page={page} totalPages={totalPages} onPageChange={setPage} filteredCount={total} pageSize={RENEWAL_LIST_PAGE_SIZE} itemLabel="scholars" />
          </div>
        </>
      )}

      {viewing && <SdpCreditsModal scholar={viewing} schoolYear={schoolYear} term={term} onClose={() => setViewing(null)} />}
      {acting?.key === "approve_grades" && (
        <ModalShell title={`Entered grades of ${acting.row.name}`} onClose={() => setActing(null)} extraWide>
          <RenewalEnteredGradesTab refreshKey={refreshKey} onChanged={() => onChanged?.()} only={{ scholarIdNumber: acting.row.scholarIdNumber, onDone: afterAct }} />
        </ModalShell>
      )}
      {acting?.key === "decide_sdp" && (
        <ModalShell title={`SDP reconsideration of ${acting.row.name}`} onClose={() => setActing(null)} wide>
          <RenewalSdpReconsiderationTab refreshKey={refreshKey} onChanged={() => onChanged?.()} only={{ scholarIdNumber: acting.row.scholarIdNumber, onDone: afterAct }} />
        </ModalShell>
      )}
      {acting?.key === "decide_case" && acting.facts.dhReferralId && (
        <ModalShell title={`${acting.row.name}: renewal for ${termLabelOf(schoolYear, term)}`} onClose={() => setActing(null)} wide>
          <ReferralFormPanel mode="approve" referralId={acting.facts.dhReferralId} onDone={afterAct} />
        </ModalShell>
      )}
      {acting?.key === "decide_inc" && acting.facts.recordId && (
        <ModalShell title={`INC of ${acting.row.name}`} onClose={() => setActing(null)} wide>
          <RenewalIncTab schoolYear={schoolYear} term={term} refreshKey={refreshKey} onOpen={onOpenRecord} onChanged={() => onChanged?.()} only={{ recordId: acting.facts.recordId, onDone: afterAct }} />
        </ModalShell>
      )}
      {referring && <ReferralFormModal mode="create" scholar={referring} onClose={() => setReferring(null)} onDone={afterAct} />}
      {marking && (
        <ReasonDialog
          title="Mark as not required this term" intro={<>{marking.name} will leave the “Not applied” list for this term.</>}
          label="Reason (for example: graduating)" confirmLabel="Mark not required" onCancel={() => setMarking(null)}
          onConfirm={async reason => {
            const r = await markNotRequired(marking.scholarIdNumber, schoolYear, term, reason);
            if (!r.ok) return r.error;
            setMarking(null); onChanged?.(); await loadList(); await loadOptions(); return null;
          }}
        />
      )}
    </div>
  );
}
