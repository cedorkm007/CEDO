import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, Download, ExternalLink } from "lucide-react";
import { publicSurveyUrl } from "../publishApi";

/**
 * The survey's public link with "Copy link", plus its QR code with
 * "Download QR (PNG)". Used by the Publish dialog and by the list page's
 * "Get Link / QR" action. Plain black-on-white QR with a quiet margin: the
 * most reliably scannable form.
 */
export function LinkAndQr({ slug, closed }: { slug: string; closed?: boolean }) {
  const url = publicSurveyUrl(slug);
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 2, width: 640, color: { dark: "#000000", light: "#ffffff" } })
      .then(data => { if (!cancelled) setQr(data); })
      .catch(() => { if (!cancelled) setQr(""); });
    return () => { cancelled = true; };
  }, [url]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API unavailable (older browser / insecure context): fall back to selecting a hidden field.
      const field = document.createElement("textarea");
      field.value = url;
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      document.execCommand("copy");
      field.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-4">
      {closed && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] font-medium text-amber-800">
          This survey is closed, so anyone opening the link sees “This survey is no longer accepting responses”.
        </p>
      )}
      <div>
        <label htmlFor="survey-public-link" className="block text-[11.5px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">Survey link</label>
        <div className="flex gap-2">
          <input
            id="survey-public-link" readOnly value={url} onFocus={e => e.target.select()}
            className="min-w-0 flex-1 rounded-lg border border-[#e6ecf5] bg-[#f7f9fc] px-3 py-2 text-[13px] text-[#062444] outline-none focus:border-[#0088cc]"
          />
          <button
            type="button" onClick={() => void copy()}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[#062444] px-3.5 py-2 text-[12.5px] font-semibold text-white hover:bg-[#0a3a6b]"
          >
            {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy link</>}
          </button>
        </div>
        <a href={url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-[#0088cc] hover:underline">
          <ExternalLink size={12} /> Open the survey page
        </a>
      </div>

      <div className="flex flex-col items-center gap-3 rounded-xl border border-[#e6ecf5] p-4 sm:flex-row sm:items-center">
        <div className="h-[168px] w-[168px] shrink-0 rounded-lg bg-white">
          {qr ? <img src={qr} alt="QR code that opens the survey" width={168} height={168} className="h-full w-full" /> : <div className="h-full w-full animate-pulse rounded-lg bg-[#f0f3f8]" />}
        </div>
        <div className="text-center sm:text-left">
          <p className="text-[13px] font-semibold text-[#062444]">QR code</p>
          <p className="mt-0.5 text-[12px] text-slate-500">Print it, put it on a slide, or share the image. Scanning it opens the survey on any phone.</p>
          <a
            href={qr || undefined} download={`survey-qr-${slug}.png`}
            aria-disabled={!qr}
            className={`mt-3 inline-flex items-center gap-1.5 rounded-lg border border-[#e6ecf5] px-3.5 py-2 text-[12.5px] font-semibold text-[#062444] hover:bg-[#f7f9fc] ${qr ? "" : "pointer-events-none opacity-50"}`}
          >
            <Download size={14} /> Download QR (PNG)
          </a>
        </div>
      </div>
    </div>
  );
}
