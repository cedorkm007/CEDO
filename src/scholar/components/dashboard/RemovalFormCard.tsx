import { useCallback, useEffect, useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { useLiveReload } from "@/lib/liveUpdates";
import { formatDay } from "@/lib/renewal";
import { downloadRemovalForm, fetchMyRemovalForms, type RemovalFormItem } from "@/lib/removalFormApi";

/**
 * The scholar's Scholarship Grant Termination Acknowledgement Form: when the Division Head approves the termination of the scholarship, the form is ready here to download, print and
 * sign together with the parent or guardian. (The Division Head's and the City Education and Development Officer's e-signatures are already on it.) Shows nothing when there is none.
 */
export function RemovalFormCard() {
  const [forms, setForms] = useState<RemovalFormItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => { setForms(await fetchMyRemovalForms()); }, []);
  useEffect(() => { void load(); }, [load]);
  useLiveReload(load);
  if (forms.length === 0) return null;

  async function download(id: string) {
    setBusy(id); setError("");
    const r = await downloadRemovalForm(id);
    setBusy(null);
    if (!r.ok) setError(r.error);
  }

  return (
    <section aria-label="Your scholarship termination form" className="rounded-xl border-2 border-red-300 bg-red-50 px-4 py-4 text-[14px] text-red-950">
      <h3 className="text-[15px] font-extrabold">Your scholarship termination form</h3>
      <p className="mt-1">The Division Head approved the termination of your scholarship. Download the Scholarship Grant Termination Acknowledgement Form, print it, sign it together with your parent or guardian and bring it to the CEDO office. The Division Head&apos;s and the City Education and Development Officer&apos;s signatures are already on it. You can ask the CEDO office if you have questions about the grounds.</p>
      <ul className="mt-3 space-y-2">
        {forms.map(f => (
          <li key={f.referralId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-white px-3 py-2.5">
            <span className="text-slate-900">Issued {formatDay(f.issuedOn)}</span>
            <button type="button" onClick={() => void download(f.referralId)} disabled={busy === f.referralId}
              className="inline-flex items-center gap-2 rounded-lg bg-[#062444] px-4 py-2 text-[14px] font-bold text-white hover:bg-[#0a3a6e] disabled:opacity-60">
              {busy === f.referralId ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <FileDown size={15} aria-hidden="true" />} Download the form (PDF)
            </button>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-2 text-red-800">{error}</p>}
    </section>
  );
}
