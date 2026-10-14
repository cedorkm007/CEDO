import { useEffect, useState } from "react";
import { Download, FileText, Loader2 } from "lucide-react";
import { pickStudyPlanForm } from "@/lib/renewal";
import { fetchFormMaterialDownloadUrl, fetchFormMaterialsForScholar } from "../../formsApi";
import { fetchMyStudyPlanForm, fetchMyStudyPlanFormUrl, type MyStudyPlanForm } from "../../renewalApi";

/** A form from the Forms tab that looks like the study plan form (only used when the office has not uploaded a template for this scholar's school). */
interface PlanForm { id: string; title: string; kind: "pdf" | "flipbook"; url: string; fileName: string; isUnlocked?: boolean }
type Found = { template: MyStudyPlanForm } | { material: PlanForm } | null;

/**
 * "Download the study plan form": every school has its own template, uploaded by the CEDO office in Forms Management (Renewal study plans). This
 * shows the one for THIS scholar's school (or the default). If the office has not uploaded one yet it falls back to a form the scholar can open
 * with "study plan" in its title, and otherwise points the scholar to the Forms tab.
 */
export function StudyPlanFormLink() {
  const [found, setFound] = useState<Found | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const template = await fetchMyStudyPlanForm();
      let result: Found = template ? { template } : null;
      if (!result) {
        const material = pickStudyPlanForm<PlanForm>(null, await fetchFormMaterialsForScholar());
        if (material) result = { material };
      }
      if (!cancelled) setFound(result);
    })();
    return () => { cancelled = true; };
  }, []);

  async function open() {
    if (!found) return;
    setError("");
    if ("material" in found && found.material.kind === "flipbook") { window.open(found.material.url, "_blank", "noopener,noreferrer"); return; }
    setBusy(true);
    const url = "template" in found ? await fetchMyStudyPlanFormUrl(found.template) : await fetchFormMaterialDownloadUrl((found as { material: PlanForm }).material.id);
    setBusy(false);
    if (!url) { setError("The form couldn't be downloaded right now. Please try again in a moment."); return; }
    const link = document.createElement("a");
    link.href = url;
    link.download = "template" in found ? found.template.downloadName : (found.material.fileName || `${found.material.title}.pdf`);
    link.click();
  }

  if (found === undefined) return null;
  return (
    <div className="mt-2">
      {found ? (
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
