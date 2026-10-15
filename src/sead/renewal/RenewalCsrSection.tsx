import { useCallback, useEffect, useState } from "react";
import { Download, FilePlus2, Loader2 } from "lucide-react";
import { fetchCsrInfo, openCsrDownload, requestCsr, type CsrInfo } from "@/lib/csrApi";
import { formatDateTime } from "@/lib/renewal";
import { ReasonDialog } from "./ReasonDialog";

/**
 * The Certificate of Scholarship Renewal on a confirmed renewal: the copies that exist, a download for the evaluator, and "Issue a corrected copy"
 * (a new version with the reason kept; the older copy stays on file, marked as replaced). Everyone who may view renewals sees the list;
 * only the evaluator (canAct) can download or correct.
 */
export function RenewalCsrSection({ recordId, scholarName, canAct }: { recordId: string; scholarName: string; canAct: boolean }) {
  const [info, setInfo] = useState<CsrInfo | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [correcting, setCorrecting] = useState(false);

  const load = useCallback(async () => { setInfo(await fetchCsrInfo(recordId)); }, [recordId]);
  useEffect(() => { void load(); }, [load]);

  async function download() {
    setBusy(true); setError("");
    const r = await requestCsr(recordId);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    openCsrDownload(r.url, r.fileName);
    await load();
  }

  if (info === undefined || info === null || !info.eligible) return null;
  const hasCopy = info.copies.length > 0;
  return (
    <section className="rounded-xl border border-[#e6ecf5] bg-white" aria-label="Certificate of Scholarship Renewal">
      <h3 className="border-b border-[#e6ecf5] px-4 py-2.5 text-[15px] font-bold text-[#062444]">Certificate of Scholarship Renewal (CSR)</h3>
      <div className="px-4 py-3 text-[14px] text-slate-800">
        {!info.enabled && <p>Certificates are switched off, so {scholarName} cannot download one yet. {canAct ? "Switch them on in the Certificate tab." : ""}</p>}
        {info.enabled && !hasCopy && <p>No certificate has been made yet. It is made the first time {scholarName} (or you) asks for it.</p>}
        {hasCopy && (
          <ul className="space-y-1.5">
            {info.copies.map(c => (
              <li key={c.csrNumber + c.version}>
                <strong>{c.csrNumber}</strong>{c.version > 1 ? ` · corrected copy ${c.version}` : ""} · {c.issuedAt ? formatDateTime(c.issuedAt) : "—"}
                {c.replaced ? <span className="font-bold text-amber-900"> · replaced by a newer copy</span> : <span className="font-bold text-green-800"> · current</span>}
                {c.reason && <span className="text-slate-700"> — reason: {c.reason}</span>}{c.by && <span className="text-slate-600"> · {c.by}</span>}
              </li>
            ))}
          </ul>
        )}
        {canAct && info.enabled && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => void download()} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-[#062444] px-4 py-2 text-[14px] font-bold text-white hover:bg-[#0a3a6e] disabled:opacity-60">
              {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Download size={15} aria-hidden="true" />} {hasCopy ? "Download the current copy" : "Make and download the certificate"}
            </button>
            {hasCopy && (
              <button onClick={() => setCorrecting(true)} disabled={busy} className="inline-flex items-center gap-2 rounded-lg border border-[#062444]/40 px-4 py-2 text-[14px] font-bold text-[#062444] hover:bg-[#f7f9fc] disabled:opacity-60">
                <FilePlus2 size={15} aria-hidden="true" /> Issue a corrected copy
              </button>
            )}
          </div>
        )}
        {error && <p role="alert" className="mt-2 text-red-700">{error}</p>}
      </div>
      {correcting && (
        <ReasonDialog title="Issue a corrected copy" intro={<>A new certificate is made for {scholarName} with the information as it is now (for example a corrected name or program). The older copy stays on file, marked as replaced, and {scholarName} is told.</>}
          label="What was wrong with the old copy?" minLength={5} confirmLabel="Issue corrected copy" onCancel={() => setCorrecting(false)}
          onConfirm={async reason => {
            const r = await requestCsr(recordId, reason);
            if (!r.ok) return r.error;
            setCorrecting(false); openCsrDownload(r.url, r.fileName); await load(); return null;
          }} />
      )}
    </section>
  );
}
