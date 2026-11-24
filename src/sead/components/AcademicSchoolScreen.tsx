import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, CheckCircle2, History, Loader2, Search, X } from "lucide-react";
import { EMPTY_FILTER, SCREEN_PAGE_SIZE, SCREEN_SQL, SCREEN_STATUS_LABEL, changeText, filterIsEmpty, howText, impactLines, type ScreenFilter, type ScreenImpact, type ScreenStatus } from "@/lib/academicScreen";
import { applyChange, fetchImpact, fetchScholarHistory, fetchSchoolHistory, fetchScreenFacets, fetchScreenPage, type ChangeTarget, type HistoryRow, type ScreenFacets, type ScreenRow, type ScreenSort } from "../academicScreenApi";
import { parsePassingGwa, passingGwaProblem, type GwaScale } from "@/lib/academicStatus";
import { AcademicUploadPanel } from "./AcademicUploadPanel";

const BTN = "inline-flex items-center gap-1.5 rounded-lg border border-[#062444]/30 bg-white px-3 py-1.5 text-[13.5px] font-semibold text-[#062444] hover:bg-[#f7f9fc] disabled:opacity-40";
const BTN_DARK = "inline-flex items-center gap-1.5 rounded-lg bg-[#062444] px-4 py-2 text-[14px] font-bold text-white hover:bg-[#0a3a6e] disabled:opacity-40";
const FIELD = "rounded-lg border border-[#062444]/25 bg-white px-2.5 py-1.5 text-[14px]";
const n = (v: number) => v.toLocaleString("en-US");
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" }) : "");
const dateTime = (iso: string) => new Date(iso).toLocaleString("en-PH", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`max-h-[90vh] w-full overflow-y-auto rounded-xl bg-white p-5 shadow-xl ${wide ? "max-w-3xl" : "max-w-xl"}`}>
        <div className="flex items-start justify-between gap-3"><h3 className="text-[17px] font-bold text-[#062444]">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-600 hover:bg-slate-100"><X size={18} /></button></div>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}

/** The question before any change: which status, an optional custom passing GWA, an optional reason, and what it would do (the impact) BEFORE it is saved. */
function ChangeDialog({ target, count, label, initial, scale, onClose, onDone }: { target: ChangeTarget; count: number; label: string; initial: ScreenStatus; scale: GwaScale | null; onClose: () => void; onDone: (changed: number, rechecks: number, rechecked: number) => void }) {
  const [status, setStatus] = useState<ScreenStatus>(initial);
  const [custom, setCustom] = useState<"keep" | "set" | "clear">("keep");
  const [gwa, setGwa] = useState("");
  const [reason, setReason] = useState("");
  const [impact, setImpact] = useState<ScreenImpact | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const problem = custom === "set" ? (scale ? passingGwaProblem(gwa, false, scale) : "This school has no grading setup yet, so a custom passing GWA cannot be set.") : null;
  const what = useMemo(() => ({ status, customGwa: custom === "set" && !problem ? parsePassingGwa(gwa) : null, clearCustom: custom === "clear" }), [status, custom, gwa, problem]);
  const ready = status !== "not_set" || custom !== "set";
  const seq = useRef(0);
  useEffect(() => {
    if (problem || (custom === "set" && what.customGwa == null) || !ready) { setImpact(null); return; }
    const mine = ++seq.current; setLoading(true); setError("");
    const t = setTimeout(() => {
      void fetchImpact(target, what).then(r => { if (mine !== seq.current) return; setLoading(false); if (r.ok) setImpact(r.impact); else { setImpact(null); setError(r.missing ? `This needs the latest database update (${SCREEN_SQL}).` : r.error); } });
    }, 250);
    return () => clearTimeout(t);
  }, [target, what, problem, custom, ready]);
  async function save() {
    if (!impact) return;
    setBusy(true); setError("");
    const r = await applyChange(target, what, reason, impact.willChange);
    setBusy(false);
    if (r.ok) onDone(r.changed, r.rechecks, r.rechecked); else { setError(r.error); seq.current++; setImpact(null); setLoading(false); }
  }
  return (
    <Modal title={`Set the academic status of ${label}`} onClose={busy ? () => undefined : onClose}>
      <div className="space-y-3 text-[14px] text-slate-800">
        <label className="block font-semibold text-[#062444]">Academic status
          <select value={status} onChange={e => setStatus(e.target.value as ScreenStatus)} className={`${FIELD} mt-1 block`}>
            {(["academic", "non_academic", "not_set"] as const).map(s => <option key={s} value={s}>{SCREEN_STATUS_LABEL[s]}</option>)}
          </select></label>
        {status !== "not_set" && (
          <fieldset className="rounded-lg border border-[#e6ecf5] px-3 py-2">
            <legend className="px-1 font-semibold text-[#062444]">Custom passing GWA (optional)</legend>
            {([["keep", "Leave the custom passing GWA as it is"], ["set", "Give them a custom passing GWA"], ["clear", "Take their custom passing GWA away (the school's number is used)"]] as const).map(([k, t]) => (
              <label key={k} className="flex items-center gap-2 py-0.5"><input type="radio" name="custom" checked={custom === k} onChange={() => setCustom(k)} /> {t}</label>))}
            {custom === "set" && (<div className="mt-1.5"><input value={gwa} onChange={e => setGwa(e.target.value.replace(/[^0-9.,]/g, "").slice(0, 6))} inputMode="decimal" aria-label="Custom passing GWA" className={`${FIELD} w-28`} />
              {gwa && problem && <p role="status" className="mt-1 text-[13.5px] text-amber-900">{problem}</p>}</div>)}
          </fieldset>)}
        <label className="block font-semibold text-[#062444]">Reason (optional)
          <input value={reason} onChange={e => setReason(e.target.value.slice(0, 300))} placeholder="Why is this being changed?" className={`${FIELD} mt-1 block w-full font-normal`} /></label>
        <div className="rounded-lg border border-[#e6ecf5] bg-[#f8fafd] px-3 py-2" aria-live="polite">
          <p className="font-semibold text-[#062444]">What this will do</p>
          {loading ? <p className="flex items-center gap-2 text-slate-700"><Loader2 size={14} className="animate-spin" /> Checking…</p>
            : impact ? <ul className="mt-1 list-disc space-y-1 pl-5">{impactLines(impact, status).map((l, i) => <li key={i}>{l}</li>)}</ul>
            : <p className="text-slate-700">{count === 0 ? "No scholar is chosen." : "The effect is shown here once the choices above are complete."}</p>}
        </div>
        {error && <p role="alert" className="text-red-700">{error}</p>}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button type="button" onClick={() => void save()} disabled={busy || loading || !impact || impact.willChange === 0} className={BTN_DARK}>
            {busy && <Loader2 size={14} className="animate-spin" />} {impact ? `Save for ${n(impact.willChange)} scholar${impact.willChange === 1 ? "" : "s"}` : "Save"}</button>
          <button type="button" onClick={onClose} disabled={busy} className="text-[14px] font-semibold text-slate-600">Cancel</button>
          {impact && impact.willChange === 0 && <span className="text-slate-700">Nothing would change.</span>}
        </div>
      </div>
    </Modal>
  );
}

function HistoryTable({ rows, showScholar }: { rows: HistoryRow[]; showScholar: boolean }) {
  if (rows.length === 0) return <p className="text-[14px] text-slate-700">No change has been recorded yet.</p>;
  return (
    <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-[13.5px]">
      <thead className="bg-[#f7f9fc] text-[#062444]"><tr><th className="px-2 py-1.5">When</th>{showScholar && <th className="px-2 py-1.5">Scholar</th>}<th className="px-2 py-1.5">Change</th><th className="px-2 py-1.5">How</th><th className="px-2 py-1.5">By</th><th className="px-2 py-1.5">Reason</th></tr></thead>
      <tbody>{rows.map((h, i) => (
        <tr key={i} className="border-t border-[#eef3fb] align-top"><td className="px-2 py-1.5 whitespace-nowrap">{dateTime(h.at)}</td>{showScholar && <td className="px-2 py-1.5">{h.name}<span className="block text-[12.5px] text-slate-600">{h.scholarId}</span></td>}
          <td className="px-2 py-1.5">{changeText(h.oldStatus, h.newStatus, h.oldCustom, h.newCustom)}</td><td className="px-2 py-1.5">{howText(h.how)}</td><td className="px-2 py-1.5">{h.by}</td><td className="px-2 py-1.5">{h.reason ?? ""}</td></tr>))}</tbody>
    </table></div>
  );
}

function ScholarHistory({ scholarId, name, onClose }: { scholarId: string; name: string; onClose: () => void }) {
  const [rows, setRows] = useState<HistoryRow[] | null>(null); const [error, setError] = useState("");
  useEffect(() => { void fetchScholarHistory(scholarId).then(r => { if (r.ok) setRows(r.rows); else setError(r.error); }); }, [scholarId]);
  return <Modal title={`History of ${name}`} onClose={onClose} wide>{error ? <p role="alert" className="text-red-700">{error}</p> : !rows ? <Loader2 size={16} className="animate-spin" /> : <HistoryTable rows={rows} showScholar={false} />}</Modal>;
}
function SchoolHistory({ schoolId, schoolName, onClose }: { schoolId: string; schoolName: string; onClose: () => void }) {
  const [page, setPage] = useState(1); const [data, setData] = useState<{ rows: HistoryRow[]; total: number } | null>(null); const [error, setError] = useState("");
  useEffect(() => { setData(null); void fetchSchoolHistory(schoolId, page).then(r => { if (r.ok) setData({ rows: r.rows, total: r.total }); else setError(r.error); }); }, [schoolId, page]);
  const pages = data ? Math.max(1, Math.ceil(data.total / SCREEN_PAGE_SIZE)) : 1;
  return (
    <Modal title={`History of ${schoolName}`} onClose={onClose} wide>
      {error ? <p role="alert" className="text-red-700">{error}</p> : !data ? <Loader2 size={16} className="animate-spin" /> : (<>
        <HistoryTable rows={data.rows} showScholar />
        <div className="mt-3 flex items-center gap-3 text-[14px]"><button type="button" className={BTN} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
          <span>Page {page} of {pages} · {n(data.total)} change{data.total === 1 ? "" : "s"}</span><button type="button" className={BTN} disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next</button></div></>)}
    </Modal>
  );
}

function SortTh({ label, k, sort, dir, onSort }: { label: string; k: ScreenSort; sort: ScreenSort; dir: "asc" | "desc"; onSort: (k: ScreenSort) => void }) {
  const on = sort === k;
  return (<th scope="col" aria-sort={on ? (dir === "asc" ? "ascending" : "descending") : "none"} className="px-3 py-2.5 font-bold align-bottom">
    <button type="button" onClick={() => onSort(k)} className="inline-flex items-center gap-1 font-bold text-[#062444] hover:underline">{label}{on && (dir === "asc" ? <ArrowUp size={13} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" />)}</button></th>);
}

/**
 * The school screen: ONE school's scholars, 50 at a time, with search, sorting and combinable filters done by the database on the whole school. The staff change one scholar (the status on the row), the scholars they ticked,
 * or ALL that match the filters ("Select all N matching"). Every change first shows what it would do (the impact), asks for an optional reason, and is written to the history.
 */
export function AcademicSchoolScreen({ schoolId, schoolName, scale, onChanged }: { schoolId: string; schoolName: string; scale: GwaScale | null; onChanged?: () => void }) {
  const [filter, setFilter] = useState<ScreenFilter>(EMPTY_FILTER);
  const [searchText, setSearchText] = useState("");
  const [sort, setSort] = useState<ScreenSort>("name");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ScreenRow[]>([]);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState<ScreenFacets | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [dialog, setDialog] = useState<{ target: ChangeTarget; count: number; label: string; initial: ScreenStatus } | null>(null);
  const [history, setHistory] = useState<{ id: string; name: string } | null>(null);
  const [schoolHistory, setSchoolHistory] = useState(false);
  const [flash, setFlash] = useState("");
  const seq = useRef(0);

  useEffect(() => { setFilter(EMPTY_FILTER); setSearchText(""); setPage(1); setSelected(new Set()); setAllMatching(false); setFacets(null); }, [schoolId]);
  useEffect(() => { const t = setTimeout(() => { setFilter(f => (f.search === searchText ? f : { ...f, search: searchText })); }, 350); return () => clearTimeout(t); }, [searchText]);
  const load = useCallback(async () => {
    const mine = ++seq.current; setLoading(true);
    const [p, f] = await Promise.all([fetchScreenPage(schoolId, filter, sort, dir, page), fetchScreenFacets(schoolId)]);
    if (mine !== seq.current) return;
    setLoading(false);
    if (!p.ok) { setError(p.missing ? `This screen needs the latest database update (${SCREEN_SQL}). Ask the IT admin to run it.` : p.error); return; }
    setError(""); setRows(p.rows); setTotal(p.total); if (f.ok) setFacets(f.facets);
  }, [schoolId, filter, sort, dir, page]);
  useEffect(() => { void load(); }, [load]);

  const changeFilter = (patch: Partial<ScreenFilter>) => { setFilter(f => ({ ...f, ...patch })); setPage(1); setSelected(new Set()); setAllMatching(false); };
  function onSort(k: ScreenSort) { if (k === sort) setDir(d => (d === "asc" ? "desc" : "asc")); else { setSort(k); setDir("asc"); } setPage(1); }
  const pages = Math.max(1, Math.ceil(total / SCREEN_PAGE_SIZE));
  const pageIds = rows.map(r => r.scholarId);
  const pageAllSelected = pageIds.length > 0 && pageIds.every(id => allMatching || selected.has(id));
  const selCount = allMatching ? total : selected.size;
  function togglePage() { setAllMatching(false); setSelected(s => { const x = new Set(s); if (pageAllSelected) pageIds.forEach(id => x.delete(id)); else pageIds.forEach(id => x.add(id)); return x; }); }
  function toggleOne(id: string) { if (allMatching) { setAllMatching(false); setSelected(new Set(pageIds.filter(x => x !== id))); return; } setSelected(s => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; }); }
  function openBulk() { setDialog({ target: { schoolId, filter, ids: allMatching ? null : [...selected] }, count: selCount, label: `${n(selCount)} scholar${selCount === 1 ? "" : "s"}`, initial: "academic" }); }
  function openOne(r: ScreenRow, status: ScreenStatus) { setDialog({ target: { schoolId, filter: EMPTY_FILTER, ids: [r.scholarId] }, count: 1, label: r.name, initial: status }); }
  const sel = (label: string, value: string, onChange: (v: string) => void, opts: { value: string; label: string }[]) => (
    <label className="text-[13.5px] font-semibold text-[#062444]">{label}<select value={value} onChange={e => onChange(e.target.value)} className={`${FIELD} mt-1 block max-w-[15rem] font-normal`}><option value="">All</option>{opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>);

  if (error) return <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[14px] text-amber-950">{error}</p>;
  const statusChips: { key: ScreenStatus | ""; label: string }[] = [{ key: "", label: `All (${facets ? n(facets.total) : "…"})` }, { key: "academic", label: `Academic (${facets ? n(facets.academic) : "…"})` }, { key: "non_academic", label: `Non-academic (${facets ? n(facets.nonAcademic) : "…"})` }, { key: "not_set", label: `Not set (${facets ? n(facets.notSet) : "…"})` }];

  return (
    <section className="rounded-xl border border-[#e6ecf5] bg-white px-4 py-4" aria-label="Scholars of the school">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h2 className="text-[16px] font-bold text-[#062444]">Scholars of {schoolName}</h2>
          <p className="mt-1 text-[14px] text-slate-700">Set the academic status of each scholar here. Change one scholar on its row, or tick several, or filter and use <strong>Select all matching</strong>, or <strong>upload a file</strong> below. Every change shows what it will do before it is saved and is kept in the history.</p></div>
        <button type="button" className={BTN} onClick={() => setSchoolHistory(true)}><History size={14} /> History of this school</button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Show scholars by status">
        {statusChips.map(c => <button key={c.key || "all"} type="button" aria-pressed={filter.status === c.key} onClick={() => changeFilter({ status: c.key })}
          className={`rounded-full border px-3 py-1.5 text-[14px] font-semibold ${filter.status === c.key ? "border-[#062444] bg-[#062444] text-white" : "border-[#062444]/25 bg-white text-[#062444] hover:bg-[#f7f9fc]"}`}>{c.label}</button>)}
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="relative text-[13.5px] font-semibold text-[#062444]">Search
          <Search size={15} className="absolute left-3 bottom-2.5 text-slate-600" aria-hidden="true" />
          <input value={searchText} onChange={e => setSearchText(e.target.value)} placeholder="Name or Scholar ID" aria-label="Search by name or Scholar ID" className={`${FIELD} mt-1 block w-60 pl-9 font-normal`} /></label>
        {sel("Program", filter.programs[0] ?? "", v => changeFilter({ programs: v ? [v] : [] }), (facets?.programs ?? []).map(p => ({ value: p.key, label: `${p.program} (${n(p.n)})` })))}
        {sel("Year level", filter.years[0] ?? "", v => changeFilter({ years: v ? [v] : [] }), (facets?.years ?? []).map(p => ({ value: p.value, label: `${p.value || "(none)"} (${n(p.n)})` })))}
        {sel("Scholarship status", filter.scholarship[0] ?? "", v => changeFilter({ scholarship: v ? [v] : [] }), (facets?.scholarship ?? []).map(p => ({ value: p.value, label: `${p.value || "(none)"} (${n(p.n)})` })))}
        <label className="flex items-center gap-2 pb-2 text-[14px] text-slate-800"><input type="checkbox" checked={filter.custom === true} onChange={e => changeFilter({ custom: e.target.checked ? true : null })} /> Custom passing GWA only{facets ? ` (${n(facets.custom)})` : ""}</label>
        {(facets?.removed ?? 0) > 0 && <label className="flex items-center gap-2 pb-2 text-[14px] text-slate-800"><input type="checkbox" checked={filter.includeRemoved} onChange={e => changeFilter({ includeRemoved: e.target.checked })} /> Show removed scholars ({n(facets!.removed)})</label>}
        {!filterIsEmpty(filter) && <button type="button" className={`${BTN} mb-1`} onClick={() => { setSearchText(""); changeFilter({ ...EMPTY_FILTER }); }}>Clear filters</button>}
      </div>

      {flash && <p role="status" className="mt-3 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-[14px] text-green-900"><CheckCircle2 size={14} className="mr-1 inline" aria-hidden="true" />{flash}</p>}

      {selCount > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-[#062444]/20 bg-[#f1f6fd] px-3 py-2 text-[14px]" role="status">
          <strong>{n(selCount)} selected{allMatching ? " (all that match)" : ""}</strong>
          <button type="button" className={BTN_DARK} onClick={openBulk}>Set status…</button>
          <button type="button" className="font-semibold text-slate-600 underline" onClick={() => { setSelected(new Set()); setAllMatching(false); }}>Clear selection</button>
        </div>)}
      {pageAllSelected && !allMatching && total > rows.length && (
        <p className="mt-2 text-[14px] text-slate-800">All {rows.length} on this page are selected. <button type="button" className="font-bold text-[#00709f] underline" onClick={() => setAllMatching(true)}>Select all {n(total)} that match</button></p>)}

      <div className="mt-3 overflow-x-auto rounded-xl border border-[#e6ecf5]">
        <table className="w-full min-w-[980px] text-left text-[14px]">
          <caption className="sr-only">Scholars of the school and their academic status</caption>
          <thead className="bg-[#f7f9fc]"><tr>
            <th scope="col" className="px-3 py-2.5"><input type="checkbox" checked={pageAllSelected} onChange={togglePage} aria-label="Select all scholars on this page" /></th>
            <SortTh label="Scholar" k="name" sort={sort} dir={dir} onSort={onSort} /><SortTh label="Scholar ID" k="id" sort={sort} dir={dir} onSort={onSort} /><SortTh label="Program" k="program" sort={sort} dir={dir} onSort={onSort} />
            <SortTh label="Year" k="year" sort={sort} dir={dir} onSort={onSort} /><SortTh label="Scholarship" k="scholarship" sort={sort} dir={dir} onSort={onSort} /><SortTh label="Academic status" k="status" sort={sort} dir={dir} onSort={onSort} />
            <th scope="col" className="px-3 py-2.5 font-bold text-[#062444] align-bottom">Passing GWA used</th><SortTh label="Last changed" k="updated" sort={sort} dir={dir} onSort={onSort} /><th scope="col" className="px-3 py-2.5"><span className="sr-only">History</span></th></tr></thead>
          <tbody>
            {loading && rows.length === 0 ? <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-700"><Loader2 size={15} className="mr-2 inline animate-spin" />Loading…</td></tr>
              : rows.length === 0 ? <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-700">{filterIsEmpty(filter) ? "This school has no scholars." : "No scholar matches. Try clearing a filter."}</td></tr>
              : rows.map(r => (
                <tr key={r.scholarId} className={`border-t border-[#eef3fb] align-top ${loading ? "opacity-60" : ""} ${r.isSet ? "" : "bg-amber-50/50"}`}>
                  <td className="px-3 py-2"><input type="checkbox" checked={allMatching || selected.has(r.scholarId)} onChange={() => toggleOne(r.scholarId)} aria-label={`Select ${r.name}`} /></td>
                  <td className="px-3 py-2 font-semibold text-slate-900">{r.name}</td><td className="px-3 py-2 whitespace-nowrap">{r.scholarId}</td><td className="px-3 py-2">{r.program || "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.yearLevel || "—"}</td><td className="px-3 py-2">{r.scholarship || "—"}</td>
                  <td className="px-3 py-2"><select value={r.status} onChange={e => openOne(r, e.target.value as ScreenStatus)} aria-label={`Academic status of ${r.name}`} className={FIELD}>
                    {(["academic", "non_academic", "not_set"] as const).map(s => <option key={s} value={s}>{SCREEN_STATUS_LABEL[s]}</option>)}</select>
                    {!r.isSet && <span className="mt-1 block text-[12.5px] text-amber-900">counted as Academic</span>}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.passingGwa == null ? <span className="text-slate-600">none set</span> : r.passingGwa.toFixed(2)}{r.customGwa != null && <span className="ml-1.5 rounded-full border border-[#062444]/30 px-2 py-0.5 text-[12px] font-semibold text-[#062444]">custom</span>}</td>
                  <td className="px-3 py-2 text-[13px] text-slate-700">{r.updatedAt ? <>{day(r.updatedAt)}{r.updatedBy && <span className="block">{r.updatedBy}</span>}</> : "—"}</td>
                  <td className="px-3 py-2"><button type="button" className={BTN} onClick={() => setHistory({ id: r.scholarId, name: r.name })}><History size={13} /> History</button></td></tr>))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-[14px]">
        <button type="button" className={BTN} disabled={page <= 1 || loading} onClick={() => setPage(p => p - 1)}>Previous</button>
        <span>Page {page} of {pages} · {n(total)} scholar{total === 1 ? "" : "s"}{filterIsEmpty(filter) ? "" : " match"}</span>
        <button type="button" className={BTN} disabled={page >= pages || loading} onClick={() => setPage(p => p + 1)}>Next</button>
      </div>

      <div className="mt-4"><AcademicUploadPanel schoolId={schoolId} schoolName={schoolName} filter={filter} matching={total} onSaved={() => { onChanged?.(); void load(); }} /></div>

      {dialog && <ChangeDialog target={dialog.target} count={dialog.count} label={dialog.label} initial={dialog.initial} scale={scale} onClose={() => setDialog(null)}
        onDone={(changed, rechecks, rechecked) => {
          setDialog(null); setSelected(new Set()); setAllMatching(false);
          setFlash(`Saved: ${n(changed)} scholar${changed === 1 ? "" : "s"} changed. ${rechecks === 0 ? "No renewal needs to be checked again." : rechecked >= rechecks ? `${n(rechecks)} open renewal${rechecks === 1 ? " was" : "s were"} checked again.` : `${n(rechecks)} open renewals are being checked again: the count is at the top of the page.`}`);
          onChanged?.(); void load();
        }} />}
      {history && <ScholarHistory scholarId={history.id} name={history.name} onClose={() => setHistory(null)} />}
      {schoolHistory && <SchoolHistory schoolId={schoolId} schoolName={schoolName} onClose={() => setSchoolHistory(false)} />}
    </section>
  );
}
