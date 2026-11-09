import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Search, Upload } from "lucide-react";
import { ListPagination } from "@/app/components/PaginatedList";
import { formatDateTime, stageTitle, termLabelOf } from "@/lib/renewal";
import { parseScholarIds, tagResultText, type TagResult } from "@/lib/renewalTagging";
import { fetchTaggedList, fetchTagTerms, tagScholars, TAGGED_PAGE_SIZE, untagScholars, type TaggedRow, type TagTerm } from "../renewalTaggingApi";

/**
 * Scholar Renewal > Scholar tagging. A scholar tagged for a renewal term is renewed AUTOMATICALLY when they apply and their grades and SDP are approved (the scholarship status stays what it is).
 * A tagged scholar with a failed, DRP or INC subject follows the usual process, and Summer renewals are never automatic. Only it.admin1 and the accounts it appoints can tag (canManage); the renewal evaluator reads the list.
 */
export function RenewalTaggingTab({ canManage, refreshKey, onChanged }: { canManage: boolean; refreshKey: number; onChanged?: () => void }) {
  const [terms, setTerms] = useState<TagTerm[] | null>(null);
  const [termKey, setTermKey] = useState("");
  const [typedIds, setTypedIds] = useState("");
  const [autoApprove, setAutoApprove] = useState(false);
  const [busy, setBusy] = useState<"tag" | "untag" | null>(null);
  const [result, setResult] = useState<{ text: string; detail: string[] } | null>(null);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  const [rows, setRows] = useState<TaggedRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);

  const term = useMemo(() => terms?.find(t => `${t.schoolYear}|${t.term}` === termKey) ?? null, [terms, termKey]);
  const ids = useMemo(() => parseScholarIds(typedIds), [typedIds]);

  useEffect(() => {
    let live = true;
    void (async () => {
      const r = await fetchTagTerms();
      if (!live) return;
      if (!r.ok) { if (r.missing) setMissing(true); else setError(r.error); return; }
      setTerms(r.terms); setMissing(false);
      setTermKey(k => k || (r.terms[0] ? `${r.terms[0].schoolYear}|${r.terms[0].term}` : ""));
    })();
    return () => { live = false; };
  }, [refreshKey]);
  useEffect(() => { const t = setTimeout(() => { setQuery(typed); setPage(1); }, 350); return () => clearTimeout(t); }, [typed]);

  const load = useCallback(async () => {
    if (!term) { setRows([]); setTotal(0); return; }
    const r = await fetchTaggedList(term.schoolYear, term.term, query, page);
    if (!r.ok) { if (r.missing) setMissing(true); else setError(r.error); return; }
    setRows(r.rows); setTotal(r.total); setError("");
  }, [term, query, page]);
  useEffect(() => { setRows(null); void load(); }, [load, refreshKey]);

  async function run(kind: "tag" | "untag") {
    if (!term || ids.length === 0) return;
    setBusy(kind); setError(""); setResult(null);
    if (kind === "tag") {
      const r = await tagScholars(term.schoolYear, term.term, ids, autoApprove);
      if (!r.ok) setError(r.error);
      else {
        const res: TagResult = r.result;
        setResult({ text: tagResultText(res), detail: [...(res.notFound.length ? [`Not found: ${res.notFound.join(", ")}`] : []), ...(res.skipped.length ? [`Skipped: ${res.skipped.join(", ")}`] : [])] });
        if (res.notFound.length === 0 && res.skipped.length === 0) setTypedIds(""); else setTypedIds(res.notFound.join("\n"));
        setPage(1); await load(); onChanged?.();
      }
    } else {
      const r = await untagScholars(term.schoolYear, term.term, ids);
      if (!r.ok) setError(r.error);
      else { setResult({ text: `${r.removed} tag${r.removed === 1 ? "" : "s"} removed.`, detail: [] }); setTypedIds(""); await load(); onChanged?.(); }
    }
    setBusy(null);
  }
  async function removeOne(id: string) {
    if (!term) return;
    setBusy("untag"); setError(""); setConfirming(null);
    const r = await untagScholars(term.schoolYear, term.term, [id]);
    if (!r.ok) setError(r.error); else { setResult({ text: `${r.removed} tag removed.`, detail: [] }); await load(); onChanged?.(); }
    setBusy(null);
  }
  async function readFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 1_000_000) { setError("That file is too big. Use a text or CSV file of Scholar IDs (up to 1 MB)."); return; }
    try { const text = await file.text(); setTypedIds(t => (t.trim() ? t.trim() + "\n" : "") + text); setError(""); }
    catch { setError("That file could not be read. Paste the Scholar IDs into the box instead."); }
  }

  if (missing) return <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[14px] text-amber-950">Scholar tagging needs the latest database update (supabase_migration_renewal_tagged_scholars.sql). Until it is run, this tab cannot show anything.</p>;

  return (
    <div className="space-y-4 text-[14px] text-slate-900">
      <div className="rounded-xl border border-[#e6ecf5] bg-white px-4 py-3">
        <p className="font-bold text-[#062444]">Automatic renewal</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-slate-800">
          <li>A tagged scholar applies as usual. All they have to do is enter their grades (if the school has not uploaded them yet) and, if they did not comply with the SDP, ask for an SDP reconsideration.</li>
          <li>When the grades and the SDP are approved, the renewal is confirmed automatically and the scholarship status stays the same.</li>
          <li>With <strong>auto-approve</strong>, the grades the scholar enters and the SDP reconsideration request are approved by the system too: no Grades Approver or SDP approver has to act.</li>
          <li>A tagged scholar with a failed, DRP or INC subject goes through the usual process (consultation, documents, Division Head). Summer renewals are never automatic.</li>
          <li>A tag counts for the chosen renewal term only.</li>
        </ul>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-[#e6ecf5] bg-[#f7f9fc] px-4 py-3">
        <label htmlFor="tag-term" className="font-bold text-[#062444]">Renewal term</label>
        {terms && terms.length > 0
          ? <select id="tag-term" value={termKey} onChange={e => { setTermKey(e.target.value); setPage(1); setResult(null); }} className="rounded-lg border border-[#062444]/25 bg-white px-3 py-2 outline-none focus:border-[#062444]">
              {terms.map(t => <option key={`${t.schoolYear}|${t.term}`} value={`${t.schoolYear}|${t.term}`}>{termLabelOf(t.schoolYear, t.term)}</option>)}
            </select>
          : <span className="text-slate-700">{terms ? "No renewal term yet: open a renewal window first." : "Loading…"}</span>}
      </div>

      {canManage && term && (
        <div className="rounded-xl border border-[#e6ecf5] bg-white px-4 py-3">
          <label htmlFor="tag-ids" className="font-bold text-[#062444]">Scholar IDs for {termLabelOf(term.schoolYear, term.term)}</label>
          <p className="text-[13px] text-slate-700">One ID or many: type or paste them one per line (a column copied from Excel works), or separated by commas or spaces. You can also choose a text or CSV file.</p>
          <textarea id="tag-ids" value={typedIds} onChange={e => setTypedIds(e.target.value)} rows={4} placeholder={"2506-00177\n2306-00092"} className="mt-2 w-full rounded-lg border border-[#062444]/25 bg-white px-3 py-2 font-mono text-[13px] outline-none focus:border-[#062444]" />
          <label className="mt-2 flex items-start gap-2 text-slate-900"><input type="checkbox" checked={autoApprove} onChange={e => setAutoApprove(e.target.checked)} className="mt-1 h-4 w-4 shrink-0" />
            <span><strong>Also auto-approve</strong> the grades these scholars enter and their SDP reconsideration request (what already waits for approval is approved now). Tagging a scholar again with the other choice changes it.</span></label>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void run("tag")} disabled={!!busy || ids.length === 0} className="rounded-lg bg-[#062444] px-3.5 py-2 font-bold text-white hover:bg-[#0a3a6e] disabled:opacity-50">
              {busy === "tag" ? "Tagging…" : ids.length > 0 ? `Tag ${ids.length} scholar${ids.length === 1 ? "" : "s"}${autoApprove ? " with auto-approve" : ""}` : "Tag scholars"}
            </button>
            <button type="button" onClick={() => void run("untag")} disabled={!!busy || ids.length === 0} className="rounded-lg border border-[#062444]/25 bg-white px-3.5 py-2 font-semibold text-[#062444] hover:bg-[#f7f9fc] disabled:opacity-50">
              {busy === "untag" ? "Removing…" : "Remove the tag from these"}
            </button>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#062444]/25 bg-white px-3 py-2 font-semibold text-[#062444] hover:bg-[#f7f9fc]">
              <Upload size={14} aria-hidden="true" /> Choose a file
              <input type="file" accept=".txt,.csv,text/plain,text/csv" className="sr-only" onChange={e => { void readFile(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
            <span className="text-slate-700">{ids.length > 0 ? `${ids.length} ID${ids.length === 1 ? "" : "s"} ready` : "No IDs yet"}</span>
          </div>
          {result && <div role="status" className="mt-3 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-green-950"><p className="font-semibold">{result.text}</p>{result.detail.map(d => <p key={d} className="break-words text-[13px] text-slate-900">{d}</p>)}</div>}
        </div>
      )}
      {!canManage && <p className="text-[13px] text-slate-700">You can see the list. Only it.admin1 and the accounts it.admin1 appoints can tag scholars.</p>}
      {error && <p role="alert" className="text-red-700">{error}</p>}

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="font-bold text-[#062444]">Tagged scholars{term ? ` · ${termLabelOf(term.schoolYear, term.term)}` : ""}{rows ? ` · ${total}` : ""}</p>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" aria-hidden="true" />
            <input value={typed} onChange={e => setTyped(e.target.value)} placeholder="Search name or ID" aria-label="Search tagged scholars" className="rounded-lg border border-[#062444]/25 bg-white py-2 pl-9 pr-3 outline-none focus:border-[#062444]" />
          </div>
        </div>
        {!rows ? <p className="flex items-center gap-2 text-slate-700"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…</p>
          : rows.length === 0 ? <p className="rounded-xl border border-dashed border-[#e6ecf5] px-4 py-8 text-center text-slate-700">{query ? "No tagged scholar matches this search." : "No scholar is tagged for this term yet."}</p>
          : (
            <ul className="space-y-2.5">
              {rows.map(r => (
                <li key={r.scholarIdNumber} className="rounded-xl border border-[#e6ecf5] bg-white px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-[#062444]">{r.name} <span className="font-mono text-[13px] font-normal text-slate-700">· {r.scholarIdNumber}</span></p>
                      <p className="text-slate-800">{r.school || "No school"} · {r.program || "No program"} · {r.yearLevel || "No year level"} · {r.scholarStatus}</p>
                      <p className="text-[13px] text-slate-700">{r.autoApprove && <span className="mr-1.5 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[13px] font-semibold text-amber-900">Auto-approve</span>}Tagged {formatDateTime(r.taggedAt)}{r.taggedByLabel ? ` by ${r.taggedByLabel}` : ""}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <span className={`rounded-full border px-2.5 py-0.5 text-[13px] font-semibold ${r.renewed ? "border-green-300 bg-green-50 text-green-900" : r.stage ? "border-sky-300 bg-sky-50 text-sky-900" : "border-slate-200 bg-slate-100 text-slate-800"}`}>
                        {r.renewed ? "Renewed" : r.stage ? stageTitle(r.stage) : "Has not applied yet"}
                      </span>
                      {canManage && !r.renewed && (confirming === r.scholarIdNumber
                        ? <span className="flex items-center gap-1.5 text-[13px]">Remove the tag?
                            <button type="button" onClick={() => void removeOne(r.scholarIdNumber)} disabled={!!busy} className="rounded-md bg-red-700 px-2 py-0.5 font-semibold text-white disabled:opacity-60">Yes, remove</button>
                            <button type="button" onClick={() => setConfirming(null)} className="rounded-md border border-slate-300 px-2 py-0.5 font-semibold text-slate-800">No</button></span>
                        : <button type="button" onClick={() => setConfirming(r.scholarIdNumber)} aria-label={`Remove the tag from ${r.name}`} className="text-[13px] font-semibold text-[#00709f] hover:underline">Remove tag</button>)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        {rows && rows.length > 0 && <div className="mt-3"><ListPagination page={page} totalPages={Math.max(1, Math.ceil(total / TAGGED_PAGE_SIZE))} onPageChange={setPage} filteredCount={total} pageSize={TAGGED_PAGE_SIZE} itemLabel="scholars" /></div>}
      </div>
    </div>
  );
}
