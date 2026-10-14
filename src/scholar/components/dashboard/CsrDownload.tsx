import { useCallback, useEffect, useState } from "react";
import { Download, FileCheck2, Loader2 } from "lucide-react";
import { fetchCsrInfo, openCsrDownload, requestCsr, type CsrInfo } from "@/lib/csrApi";
import { formatDateTime } from "@/lib/renewal";

/**
 * The scholar's Certificate of Scholarship Renewal, on the Renewal tile once the evaluator has confirmed the renewal.
 * The certificate is made the first time it is asked for and then stays the same stored file; if the office issued a corrected copy,
 * the newest one is what the scholar gets.
 */
export function CsrDownload({ recordId }: { recordId: string }) {
  const [info, setInfo] = useState<CsrInfo | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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

  if (info === undefined) return null;
  if (!info || !info.eligible) return null;
  const latest = info.copies.find(c => !c.replaced) ?? info.copies[0];
  return (
    <div className="rounded-xl border border-green-300 bg-green-50 px-4 py-4" aria-label="Your Certificate of Scholarship Renewal">
      <p className="flex items-center gap-2 text-[15px] font-bold text-green-950"><FileCheck2 size={17} aria-hidden="true" /> Certificate of Scholarship Renewal</p>
      {info.enabled ? (
        <>
          <p className="mt-1 text-[14px] text-green-950">
            {latest ? <>Your certificate is ready: <strong>{latest.csrNumber}</strong>{latest.version > 1 ? ` (corrected copy ${latest.version})` : ""}{latest.issuedAt ? `, made ${formatDateTime(latest.issuedAt)}` : ""}.</> : "Your renewal is confirmed. You can download your certificate now."}
          </p>
          <button onClick={() => void download()} disabled={busy} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[#062444] px-4 py-2.5 text-[14px] font-bold text-white hover:bg-[#0a3a6e] disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Download size={15} aria-hidden="true" />} Download my certificate (PDF)
          </button>
          <p className="mt-2 text-[13.5px] text-green-950">The QR on the certificate lets your school check that it is real.</p>
        </>
      ) : (
        <p className="mt-1 text-[14px] text-green-950">Your renewal is confirmed. The CEDO office has not switched certificates on yet — we will tell you here as soon as yours is ready to download.</p>
      )}
      {error && <p role="alert" className="mt-2 text-[14px] text-red-800">{error}</p>}
    </div>
  );
}
