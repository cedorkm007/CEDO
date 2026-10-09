import { useCallback, useEffect, useMemo, useState } from "react";
import { GitMerge, UserX, Type, History, CheckCircle2 } from "lucide-react";
import { fetchSchoolSummaries, type SchoolSummary } from "../scholarsMonitoringData";
import {
  assignScholarsSchool, countScholarsOfSchool, fetchScholarsWithoutSchool, fetchSchoolAliases, fetchSpellingVariants,
  mergeSchools, standardizeSchoolNames, type NoSchoolScholar, type SchoolAlias, type SpellingVariant,
} from "../schoolCleanupApi";
import { similarSchoolGroups, schoolKey } from "@/lib/schoolNames";

const SELECT_CLS = "w-full border border-[#062444]/15 rounded-lg px-2.5 py-2 text-[14px] outline-none focus:border-[#0088cc] bg-white";
const LABEL_CLS = "block text-[13px] font-semibold text-slate-600 mb-1";
const BTN_PRIMARY = "bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-60 text-white text-[14px] font-semibold rounded-lg px-4 py-2";
const BTN_SECONDARY = "px-4 py-2 rounded-lg border border-[#062444]/20 text-[14px] font-semibold text-[#062444] disabled:opacity-60";
const TH_CLS = "text-left px-4 py-2.5 font-bold text-[13px] uppercase tracking-wide text-slate-600";
const PAGE = 50;

/**
 * CEDO's school clean-up: merge schools that are the same school written in different ways, give scholars with no school one,
 * and make the written school name on scholar records match the official one. Nothing here runs by itself — each change is
 * explained first and confirmed. (Database side: supabase_migration_standing_cleanup_logins.sql.)
 */
export function ScholarsGradesMonitoringCleanupTab() {
  const [schools, setSchools] = useState<SchoolSummary[]>([]);
  const [message, setMessage] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const reloadSchools = useCallback(() => { void fetchSchoolSummaries().then(setSchools); }, []);
  useEffect(() => { reloadSchools(); }, [reloadSchools]);

  function changed(text: string) {
    setMessage(text);
    setRefreshKey(k => k + 1);
    reloadSchools();
  }

  return (
    <div className="space-y-6">
      <p className="text-[14px] text-slate-700 max-w-3xl">
        Tools for tidying the list of schools. Nothing changes until you confirm, and no grades are ever touched — only which school a scholar belongs to.
      </p>
      {message && (
        <p role="status" className="flex items-start gap-2 text-[14px] text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          <CheckCircle2 size={17} aria-hidden="true" className="mt-0.5 shrink-0" /> {message}
        </p>
      )}
      <MergeSchoolsSection schools={schools} onDone={changed} />
      <NoSchoolSection schools={schools} refreshKey={refreshKey} onDone={changed} />
      <SpellingSection refreshKey={refreshKey} onDone={changed} />
      <AliasesSection refreshKey={refreshKey} />
    </div>
  );
}

function SectionCard({ icon, title, intro, children }: { icon: React.ReactNode; title: string; intro: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="bg-white border border-[#e6ecf5] rounded-xl p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-[16px] font-bold text-[#062444]"><span aria-hidden="true">{icon}</span>{title}</h2>
      <p className="text-[14px] text-slate-700 mt-1 mb-4 max-w-3xl">{intro}</p>
      {children}
    </section>
  );
}

// ── 1. Merge schools ─────────────────────────────────────────
function MergeSchoolsSection({ schools, onDone }: { schools: SchoolSummary[]; onDone: (message: string) => void }) {
  const [keepId, setKeepId] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [counts, setCounts] = useState<Map<string, number> | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  const groups = useMemo(() => similarSchoolGroups(schools), [schools]);
  const nameOf = useMemo(() => new Map(schools.map(s => [s.id, s.name])), [schools]);
  const visible = useMemo(() => {
    const key = schoolKey(filter);
    return schools.filter(s => s.id !== keepId && (!key || schoolKey(s.name).includes(key)));
  }, [schools, keepId, filter]);

  function reset() { setKeepId(""); setPicked(new Set()); setFilter(""); setCounts(null); setConfirming(false); setError(""); }
  function toggle(id: string) {
    setCounts(null); setConfirming(false);
    setPicked(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function chooseGroup(ids: string[]) {
    const [first, ...rest] = ids;
    setKeepId(first); setPicked(new Set(rest)); setCounts(null); setConfirming(false); setError("");
  }

  async function review() {
    setError("");
    if (!keepId) { setError("Choose the school to keep."); return; }
    if (picked.size === 0) { setError("Tick at least one school to merge into it."); return; }
    setWorking(true);
    const ids = [keepId, ...picked];
    const entries = await Promise.all(ids.map(async id => [id, await countScholarsOfSchool(id)] as const));
    setCounts(new Map(entries));
    setConfirming(true);
    setWorking(false);
  }

  async function doMerge() {
    setWorking(true);
    setError("");
    const result = await mergeSchools(keepId, Array.from(picked));
    setWorking(false);
    if (!result.ok) { setError(result.error); setConfirming(false); return; }
    const r = result.result;
    reset();
    onDone(`Merged into ${r.keptName}: ${r.scholarsMoved.toLocaleString()} scholar${r.scholarsMoved === 1 ? "" : "s"} moved, ${r.schoolsRemoved} duplicate school${r.schoolsRemoved === 1 ? "" : "s"} removed, ${r.aliasesAdded} old name${r.aliasesAdded === 1 ? "" : "s"} kept as ${r.aliasesAdded === 1 ? "an alias" : "aliases"}.`);
  }

  return (
    <SectionCard icon={<GitMerge size={18} />} title="Merge schools"
      intro="When one school was entered in several ways (for example with different spelling), merge them into one. Their scholars move to the school you keep, and the old names are remembered as aliases so nothing is lost.">
      {groups.length > 0 && (
        <div className="mb-4">
          <h3 className="text-[14px] font-bold text-[#062444] mb-1.5">These look like the same school</h3>
          <ul className="space-y-1.5">
            {groups.map(g => (
              <li key={g.map(s => s.id).join()} className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-[#f7f9fc] border border-[#e6ecf5] rounded-lg px-3 py-2">
                <span className="text-[14px] text-slate-800 flex-1 min-w-[220px]">{g.map(s => s.name).join("  ·  ")}</span>
                <button onClick={() => chooseGroup(g.map(s => s.id))} className="text-[13.5px] font-semibold text-[#0077b6] hover:underline">
                  Use these<span className="sr-only"> {g[0].name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="merge-keep" className={LABEL_CLS}>1. School to keep</label>
          <select id="merge-keep" value={keepId} onChange={e => { setKeepId(e.target.value); setPicked(prev => { const n = new Set(prev); n.delete(e.target.value); return n; }); setCounts(null); setConfirming(false); }} className={SELECT_CLS}>
            <option value="">Select the correct school…</option>
            {schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <p className="text-[13px] text-slate-600 mt-1">Its name stays as the official name.</p>
        </div>
        <div>
          <label htmlFor="merge-filter" className={LABEL_CLS}>2. Schools to merge into it</label>
          <input id="merge-filter" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Type to find a school…"
            className="w-full border border-[#062444]/15 rounded-lg px-2.5 py-2 text-[14px] outline-none focus:border-[#0088cc] bg-white mb-1.5" />
          <div role="group" aria-label="Schools to merge" className="max-h-56 overflow-y-auto border border-[#e6ecf5] rounded-lg divide-y divide-[#f0f3f8]">
            {visible.length === 0 ? (
              <p className="text-[14px] text-slate-600 px-3 py-3">No schools match.</p>
            ) : visible.map(s => (
              <label key={s.id} className="flex items-start gap-2.5 px-3 py-2 cursor-pointer hover:bg-[#f7f9fc] text-[14px] text-slate-800">
                <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(s.id)} className="mt-1 h-4 w-4 shrink-0" />
                <span>{s.name}</span>
              </label>
            ))}
          </div>
          {picked.size > 0 && <p className="text-[13px] text-slate-700 mt-1">{picked.size} selected</p>}
        </div>
      </div>

      {error && <p role="alert" className="text-[14px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-3">{error}</p>}

      {!confirming ? (
        <div className="mt-4 flex gap-2">
          <button onClick={() => void review()} disabled={working} className={BTN_PRIMARY}>{working ? "Checking…" : "Review merge"}</button>
          {(keepId || picked.size > 0) && <button onClick={reset} className={BTN_SECONDARY}>Clear</button>}
        </div>
      ) : (
        <div role="region" aria-label="Confirm merge" className="mt-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <p className="text-[14px] text-amber-950 font-semibold mb-2">Please check before merging</p>
          <ul className="text-[14px] text-amber-950 list-disc pl-5 space-y-1 mb-2">
            <li>Keep: <strong>{nameOf.get(keepId)}</strong> ({(counts?.get(keepId) ?? 0).toLocaleString()} scholars now)</li>
            {Array.from(picked).map(id => (
              <li key={id}>Merge <strong>{nameOf.get(id)}</strong> — {(counts?.get(id) ?? 0).toLocaleString()} scholar{(counts?.get(id) ?? 0) === 1 ? "" : "s"} will move, then this school entry is removed and its name kept as an alias.</li>
            ))}
          </ul>
          <p className="text-[13.5px] text-amber-950 mb-3">Grades stay exactly as they are. If a school you are merging already has a login, submission, correction request or document, the merge is refused and tells you why.</p>
          <div className="flex gap-2">
            <button onClick={() => void doMerge()} disabled={working} className={BTN_PRIMARY}>{working ? "Merging…" : "Merge schools"}</button>
            <button onClick={() => setConfirming(false)} disabled={working} className={BTN_SECONDARY}>Cancel</button>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

// ── 2. Scholars with no school ───────────────────────────────
function NoSchoolSection({ schools, refreshKey, onDone }: { schools: SchoolSummary[]; refreshKey: number; onDone: (message: string) => void }) {
  const [rows, setRows] = useState<NoSchoolScholar[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [schoolId, setSchoolId] = useState("");
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchScholarsWithoutSchool(PAGE, page * PAGE).then(r => {
      if (cancelled) return;
      if (r.ok) { setRows(r.rows); setTotal(r.total); setError(""); setPicked(new Set()); } else setError(r.error);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [page, refreshKey]);

  const pages = Math.max(1, Math.ceil(total / PAGE));
  const allPicked = rows.length > 0 && rows.every(r => picked.has(r.scholarIdNumber));

  function toggle(id: string) {
    setPicked(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  async function assign() {
    if (!schoolId || picked.size === 0) return;
    setWorking(true);
    const result = await assignScholarsSchool(Array.from(picked), schoolId);
    setWorking(false);
    if (!result.ok) { setError(result.error); return; }
    setPage(0);
    onDone(`Assigned ${result.updated.toLocaleString()} scholar${result.updated === 1 ? "" : "s"} to ${schools.find(s => s.id === schoolId)?.name ?? "the school"}.`);
  }

  return (
    <SectionCard icon={<UserX size={18} />} title="Scholars with no school set"
      intro="These scholars are not linked to any school, so they don't appear in any school's list or in the completion figures. Tick the ones that belong to the same school and assign it.">
      {error && <p role="alert" className="text-[14px] text-red-700 mb-3">{error}</p>}
      <p role="status" className="text-[14px] text-slate-700 mb-2">
        {loading ? "Loading…" : total === 0 ? "Every scholar has a school. Nothing to fix." : `${total.toLocaleString()} scholar${total === 1 ? "" : "s"} without a school`}
      </p>
      {total > 0 && (
        <>
          <div className="flex flex-wrap items-end gap-3 mb-3">
            <div className="min-w-[240px] flex-1 max-w-md">
              <label htmlFor="assign-school" className={LABEL_CLS}>Assign the ticked scholars to</label>
              <select id="assign-school" value={schoolId} onChange={e => setSchoolId(e.target.value)} className={SELECT_CLS}>
                <option value="">Select a school…</option>
                {schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <button onClick={() => void assign()} disabled={working || !schoolId || picked.size === 0} className={BTN_PRIMARY}>
              {working ? "Assigning…" : picked.size > 0 ? `Assign ${picked.size} selected` : "Assign selected"}
            </button>
          </div>
          <div className="border border-[#e6ecf5] rounded-xl overflow-x-auto relative">
            <table className="w-full min-w-[720px] text-[14px]">
              <caption className="sr-only">Scholars with no school set</caption>
              <thead className="bg-[#f7f9fc]">
                <tr>
                  <th scope="col" className="px-4 py-2.5 w-10">
                    <input type="checkbox" aria-label="Select all scholars on this page" checked={allPicked}
                      onChange={() => setPicked(allPicked ? new Set() : new Set(rows.map(r => r.scholarIdNumber)))} className="h-4 w-4" />
                  </th>
                  <th scope="col" className={TH_CLS}>Scholar ID</th>
                  <th scope="col" className={TH_CLS}>Name</th>
                  <th scope="col" className={TH_CLS}>School written on the record</th>
                  <th scope="col" className={TH_CLS}>Program</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.scholarIdNumber} className="border-t border-[#f0f3f8]">
                    <td className="px-4 py-2.5">
                      <input type="checkbox" aria-label={`Select ${r.name}`} checked={picked.has(r.scholarIdNumber)} onChange={() => toggle(r.scholarIdNumber)} className="h-4 w-4" />
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">{r.scholarIdNumber}</td>
                    <td className="px-4 py-2.5 font-semibold text-[#062444]">{r.name}</td>
                    <td className="px-4 py-2.5 text-slate-700">{r.writtenSchool || <span className="text-slate-600">(blank)</span>}</td>
                    <td className="px-4 py-2.5 text-slate-700">{r.program}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {total > PAGE && (
            <nav aria-label="No-school pages" className="flex items-center justify-between gap-3 mt-3">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className={BTN_SECONDARY}>Previous</button>
              <span className="text-[13.5px] text-slate-700">Page {page + 1} of {pages.toLocaleString()}</span>
              <button onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1} className={BTN_SECONDARY}>Next</button>
            </nav>
          )}
        </>
      )}
    </SectionCard>
  );
}

// ── 3. Spelling differences ──────────────────────────────────
function SpellingSection({ refreshKey, onDone }: { refreshKey: number; onDone: (message: string) => void }) {
  const [rows, setRows] = useState<SpellingVariant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchSpellingVariants().then(r => {
      if (cancelled) return;
      if (r.ok) { setRows(r.rows); setError(""); } else setError(r.error);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [refreshKey]);

  const total = rows.reduce((sum, r) => sum + r.scholars, 0);

  async function run() {
    setWorking(true);
    const result = await standardizeSchoolNames();
    setWorking(false);
    setConfirming(false);
    if (!result.ok) { setError(result.error); return; }
    onDone(`Standardized the school name on ${result.updated.toLocaleString()} scholar record${result.updated === 1 ? "" : "s"}.`);
  }

  return (
    <SectionCard icon={<Type size={18} />} title="Spelling differences"
      intro="Some scholar records spell their (correctly linked) school differently from its official name, for example extra spaces or capital letters. Standardizing rewrites only that written school name on the record. The list below is always safe to leave as it is.">
      {error && <p role="alert" className="text-[14px] text-red-700 mb-3">{error}</p>}
      <p role="status" className="text-[14px] text-slate-700 mb-2">
        {loading ? "Loading…" : rows.length === 0 ? "Every linked scholar record already uses the official school name." : `${total.toLocaleString()} scholar record${total === 1 ? "" : "s"} use a different spelling (${rows.length.toLocaleString()} variant${rows.length === 1 ? "" : "s"})`}
      </p>
      {rows.length > 0 && (
        <>
          <div className="border border-[#e6ecf5] rounded-xl overflow-x-auto max-h-72 overflow-y-auto relative">
            <table className="w-full min-w-[640px] text-[14px]">
              <caption className="sr-only">Different spellings of a school's name</caption>
              <thead className="bg-[#f7f9fc] sticky top-0">
                <tr>
                  <th scope="col" className={TH_CLS}>Official name</th>
                  <th scope="col" className={TH_CLS}>Written on the record</th>
                  <th scope="col" className={TH_CLS}>Scholars</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={`${r.schoolName}|${r.variant}`} className="border-t border-[#f0f3f8]">
                    <td className="px-4 py-2.5 font-semibold text-[#062444]">{r.schoolName}</td>
                    <td className="px-4 py-2.5 text-slate-700"><span className="whitespace-pre">{r.variant || "(blank)"}</span></td>
                    <td className="px-4 py-2.5 text-slate-700">{r.scholars.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!confirming ? (
            <button onClick={() => setConfirming(true)} className={`${BTN_PRIMARY} mt-3`}>Standardize school names…</button>
          ) : (
            <div role="region" aria-label="Confirm standardize" className="mt-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
              <p className="text-[14px] text-amber-950 mb-3">
                This rewrites the written school name on <strong>{total.toLocaleString()}</strong> scholar record{total === 1 ? "" : "s"} to the official name shown on the left. Nothing else on the records changes, and the school each scholar belongs to stays the same.
              </p>
              <div className="flex gap-2">
                <button onClick={() => void run()} disabled={working} className={BTN_PRIMARY}>{working ? "Working…" : "Yes, standardize"}</button>
                <button onClick={() => setConfirming(false)} disabled={working} className={BTN_SECONDARY}>Cancel</button>
              </div>
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}

// ── 4. Aliases ───────────────────────────────────────────────
function AliasesSection({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<SchoolAlias[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchSchoolAliases().then(r => {
      if (cancelled) return;
      if (r.ok) { setRows(r.rows); setError(""); } else setError(r.error);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [refreshKey]);

  return (
    <SectionCard icon={<History size={18} />} title="Old school names (aliases)"
      intro="Names kept from earlier merges. If a scholar is entered with one of these names, the system recognizes it as the school it was merged into.">
      {error && <p role="alert" className="text-[14px] text-red-700 mb-3">{error}</p>}
      {loading ? <p className="text-[14px] text-slate-700">Loading…</p> : rows.length === 0 ? (
        <p className="text-[14px] text-slate-700">No schools have been merged yet.</p>
      ) : (
        <div className="border border-[#e6ecf5] rounded-xl overflow-x-auto max-h-64 overflow-y-auto relative">
          <table className="w-full min-w-[520px] text-[14px]">
            <caption className="sr-only">Old school names and the school they now point to</caption>
            <thead className="bg-[#f7f9fc] sticky top-0">
              <tr>
                <th scope="col" className={TH_CLS}>Old name</th>
                <th scope="col" className={TH_CLS}>Now means</th>
                <th scope="col" className={TH_CLS}>Merged on</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-t border-[#f0f3f8]">
                  <td className="px-4 py-2.5 text-slate-800">{r.alias}</td>
                  <td className="px-4 py-2.5 font-semibold text-[#062444]">{r.schoolName}</td>
                  <td className="px-4 py-2.5 text-slate-700">{r.mergedAt.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}
