import { useState } from "react";
import { Copy, Check, Download, KeyRound } from "lucide-react";

export interface TemporaryCredential { who: string; login?: string; password: string }

/**
 * Shows a TEMPORARY password to the administrator who just created or reset an account, ONCE (SDP Monitoring update, Phase 6). It is never shown again,
 * and the person must choose their own password the first time they sign in. The administrator hands it over privately (in person, or by a private
 * message), never in a group chat. Several people at once (a bulk reset) are offered as one downloadable list.
 */
export function TemporaryPasswordNotice({ title, credentials, warning, onClose }: {
  title: string;
  credentials: TemporaryCredential[];
  warning?: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<number | null>(null);
  const many = credentials.length > 1;

  async function copy(index: number) {
    try { await navigator.clipboard.writeText(credentials[index].password); setCopied(index); window.setTimeout(() => setCopied(null), 2000); } catch { /* the password is on screen to copy by hand */ }
  }

  function download() {
    const lines = ["name,login,temporary_password", ...credentials.map(c => [c.who, c.login ?? "", c.password].map(v => `"${v.replace(/"/g, '""')}"`).join(","))];
    const blob = new Blob([lines.join("\r\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `temporary_passwords_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center px-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4">
          <h2 className="flex items-center gap-2 text-white text-[15px] font-bold"><KeyRound size={16} className="text-[#F3BC00]" aria-hidden="true" /> {title}</h2>
        </div>
        <div className="p-6 space-y-4">
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">
            <strong>This is shown only once.</strong> Copy {many ? "the list" : "it"} now and give {many ? "each password" : "it"} to the person privately. They must choose their own password the first time they sign in.
          </p>
          {warning && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[13px] text-red-900">{warning}</p>}
          <ul className="space-y-2">
            {credentials.slice(0, many ? 8 : 1).map((c, i) => (
              <li key={`${c.who}-${i}`} className="flex items-center justify-between gap-2 rounded-lg border border-[#e6ecf5] bg-[#f8fafd] px-3 py-2">
                <span className="min-w-0 text-[13px] text-[#062444]"><span className="block truncate font-semibold">{c.who}</span>{c.login && <span className="block truncate text-slate-600">{c.login}</span>}</span>
                <span className="flex items-center gap-2 shrink-0">
                  <code className="rounded bg-white border border-[#e6ecf5] px-2 py-1 text-[14px] font-bold tracking-wide text-[#062444]">{c.password}</code>
                  <button type="button" onClick={() => void copy(i)} aria-label={`Copy the password for ${c.who}`} className="p-1.5 text-[#0077b6] hover:text-[#062444]">
                    {copied === i ? <Check size={15} /> : <Copy size={15} />}
                  </button>
                </span>
              </li>
            ))}
          </ul>
          {many && <p className="text-[12.5px] text-slate-700">{credentials.length} people. The first few are shown; download the whole list (it is not kept anywhere else).</p>}
          <div className="flex items-center justify-between gap-3 pt-1">
            {many ? (
              <button type="button" onClick={download} className="flex items-center gap-1.5 rounded-lg border border-[#062444]/25 px-3 py-2 text-[13px] font-bold text-[#062444]"><Download size={14} /> Download the list (CSV)</button>
            ) : <span />}
            <button type="button" onClick={onClose} className="rounded-lg bg-[#062444] px-5 py-2.5 text-[13px] font-bold text-white">I have noted it</button>
          </div>
        </div>
      </div>
    </div>
  );
}
