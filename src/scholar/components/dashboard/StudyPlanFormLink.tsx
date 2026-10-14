import { useEffect, useState } from "react";
import { Download, FileText, Loader2 } from "lucide-react";
import { isStudyPlanFormTitle } from "@/lib/renewal";
import { fetchFormMaterialDownloadUrl, fetchFormMaterialsForScholar, type FormMaterial } from "../../formsApi";

/**
 * "Download the study plan form": the blank form is added by the CEDO office in Forms Management (the Forms tab of Forms and Services), not
 * built here. This finds it by its title (anything with "study plan" in it) and links straight to it; until it exists it points the scholar
 * to the Forms tab.
 */
export function StudyPlanFormLink() {
  const [form, setForm] = useState<FormMaterial | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetchFormMaterialsForScholar().then(list => {
      if (!cancelled) setForm(list.find(m => isStudyPlanFormTitle(m.title) && m.isUnlocked) ?? null);
    });
    return () => { cancelled = true; };
  }, []);

  async function open() {
    if (!form) return;
    setError("");
    if (form.kind === "flipbook") { window.open(form.url, "_blank", "noopener,noreferrer"); return; }
    setBusy(true);
    const url = await fetchFormMaterialDownloadUrl(form.id);
    setBusy(false);
    if (!url) { setError("The form couldn't be downloaded right now. Please try again in a moment."); return; }
    const link = document.createElement("a");
    link.href = url;
    link.download = form.fileName || `${form.title}.pdf`;
    link.click();
  }

  if (form === undefined) return null;
  return (
    <div className="mt-2">
      {form ? (
        <button onClick={() => void open()} disabled={busy} className="inline-flex items-center gap-2 rounded-lg border border-[#062444]/25 bg-white px-3.5 py-2 text-[14px] font-semibold text-[#062444] hover:bg-[#f7f9fc] disabled:opacity-60">
          {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Download size={14} aria-hidden="true" />} Download the study plan form
        </button>
      ) : (
        <p className="flex items-start gap-1.5 text-[14px] text-slate-700">
          <FileText size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>The blank study plan form will be in <strong>Forms and Services → Forms</strong> once the CEDO office adds it.</span>
        </p>
      )}
      {error && <p role="alert" className="mt-1 text-[14px] text-red-700">{error}</p>}
    </div>
  );
}
