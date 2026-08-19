import { useEffect, useState } from "react";
import { Briefcase, FileText, Download, BookOpen, Info, Lock } from "lucide-react";
import { SectionCard } from "./SectionCard";
import { ServicesContent } from "./ServicesPanel";
import { fetchFormMaterialsForScholar, fetchFormMaterialDownloadUrl, type FormMaterial, type UnmetRequirement } from "../../formsApi";

type Tab = "forms" | "services";

/** Friendly prefix per condition type for a locked material's requirement list. Falls back to a generic label for any future condition type this component doesn't know about yet, rather than showing nothing. */
const REQUIREMENT_TYPE_LABELS: Record<string, string> = {
  quest_subject: "Pass Quest subject",
  formation_activity: "Attend Formation activity",
  sdp_activity: "Complete SDP activity",
  course: "Be enrolled in course",
};

function requirementText(req: UnmetRequirement): string {
  const prefix = REQUIREMENT_TYPE_LABELS[req.type] ?? "Requirement";
  return req.label ? `${prefix}: ${req.label}` : prefix;
}

function FormMaterialCard({ material }: { material: FormMaterial }) {
  const [opening, setOpening] = useState(false);
  const locked = !material.isUnlocked;
  const notYetUploaded = material.kind === "pdf" && !material.fileName;
  const disabled = locked || notYetUploaded || opening;

  async function handleOpen() {
    // Locked is checked again here (not just via the disabled attribute) so
    // this can't be triggered by anything other than a real click on an
    // enabled button — e.g. a stray Enter/Space on a disabled button
    // shouldn't be able to reach fetchFormMaterialDownloadUrl at all. The
    // real enforcement is still server-side (storage RLS), this is just
    // making sure the UI never even tries for a card it knows is locked.
    if (disabled) return;
    if (material.kind === "flipbook") { window.open(material.url, "_blank", "noopener,noreferrer"); return; }
    setOpening(true);
    const url = await fetchFormMaterialDownloadUrl(material.id);
    setOpening(false);
    if (!url) { window.alert("This file couldn't be opened right now — please try again later."); return; }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <button
      onClick={() => void handleOpen()}
      disabled={disabled}
      aria-disabled={disabled}
      className={`flex flex-col items-start gap-2.5 border rounded-xl p-4 text-left transition-all disabled:cursor-not-allowed ${
        locked
          ? "bg-[#f4f5f7] border-[#e6ecf5]"
          : "bg-[#f7f9fc] hover:bg-white border-[#e6ecf5] hover:border-[#cfe0f5] hover:-translate-y-0.5 hover:shadow-[0_6px_16px_rgba(6,36,68,0.1)] disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-none"
      }`}
    >
      <span className={`w-[42px] h-[42px] rounded-[10px] flex items-center justify-center shrink-0 ${locked ? "bg-slate-300 text-white" : "bg-[#062444] text-[#F3BC00]"}`}>
        {locked ? <Lock size={18} /> : material.kind === "pdf" ? <FileText size={18} /> : <BookOpen size={18} />}
      </span>
      <span className="text-[13.5px] font-bold text-[#062444] leading-snug">{material.title}</span>
      {material.description && <span className="text-[12px] text-slate-500 leading-snug">{material.description}</span>}

      {locked ? (
        <span className="flex flex-col gap-1 w-full">
          <span className="flex items-center gap-1 text-[11.5px] font-bold text-slate-500">
            <Lock size={12} /> Locked
          </span>
          {material.unmetRequirements.length > 0 && (
            <span className="flex flex-col gap-0.5">
              {material.unmetRequirements.map((req, i) => (
                <span key={i} className="text-[11px] text-slate-400 leading-snug">• {requirementText(req)}</span>
              ))}
            </span>
          )}
        </span>
      ) : (
        <span className="flex items-center gap-1 text-[11.5px] text-slate-400">
          <Download size={12} /> {notYetUploaded ? "Not yet uploaded" : opening ? "Opening…" : material.kind === "pdf" ? "Download" : "Open flipbook"}
        </span>
      )}
    </button>
  );
}

function FormsContent() {
  const [materials, setMaterials] = useState<FormMaterial[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => { setMaterials(await fetchFormMaterialsForScholar()); setLoading(false); })();
  }, []);

  return (
    <>
      <p className="text-[13px] text-slate-400 italic flex items-center gap-1.5 mb-5">
        <FileText size={13} /> Forms, handbooks, and tools available for scholars.
      </p>
      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : materials.length === 0 ? (
        <p className="text-sm text-slate-400 flex items-center gap-2">
          <Info size={14} /> No forms have been added yet — check back later.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5">
          {materials.map(m => <FormMaterialCard key={m.id} material={m} />)}
        </div>
      )}
    </>
  );
}

export function FormsAndServicesPanel() {
  const [tab, setTab] = useState<Tab>("forms");

  return (
    <SectionCard icon={<Briefcase size={14} />} title="Forms and Services">
      <div className="flex gap-2 mb-5">
        <button onClick={() => setTab("forms")}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12.5px] font-bold ${tab === "forms" ? "bg-[#062444] text-white" : "bg-[#f7f9fc] text-slate-500 hover:bg-[#eef3fb]"}`}>
          <FileText size={14} /> Forms
        </button>
        <button onClick={() => setTab("services")}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12.5px] font-bold ${tab === "services" ? "bg-[#062444] text-white" : "bg-[#f7f9fc] text-slate-500 hover:bg-[#eef3fb]"}`}>
          <Briefcase size={14} /> Services
        </button>
      </div>

      {tab === "forms" ? <FormsContent /> : <ServicesContent />}
    </SectionCard>
  );
}
