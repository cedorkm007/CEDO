import { useEffect, useState } from "react";
import { Briefcase, FileText, Download, BookOpen, Info } from "lucide-react";
import { SectionCard } from "./SectionCard";
import { ServicesContent } from "./ServicesPanel";
import { fetchFormMaterialsForScholar, fetchFormMaterialDownloadUrl, type FormMaterial } from "../../formsApi";

type Tab = "forms" | "services";

function FormMaterialCard({ material }: { material: FormMaterial }) {
  const [opening, setOpening] = useState(false);
  const notYetUploaded = material.kind === "pdf" && !material.fileName;

  async function handleOpen() {
    if (notYetUploaded) return;
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
      disabled={notYetUploaded || opening}
      className="flex flex-col items-start gap-2.5 bg-[#f7f9fc] hover:bg-white border border-[#e6ecf5] hover:border-[#cfe0f5] rounded-xl p-4 text-left hover:-translate-y-0.5 hover:shadow-[0_6px_16px_rgba(6,36,68,0.1)] transition-all disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none"
    >
      <span className="w-[42px] h-[42px] rounded-[10px] bg-[#062444] text-[#F3BC00] flex items-center justify-center">
        {material.kind === "pdf" ? <FileText size={18} /> : <BookOpen size={18} />}
      </span>
      <span className="text-[13.5px] font-bold text-[#062444] leading-snug">{material.title}</span>
      {material.description && <span className="text-[12px] text-slate-500 leading-snug">{material.description}</span>}
      <span className="flex items-center gap-1 text-[11.5px] text-slate-400">
        <Download size={12} /> {notYetUploaded ? "Not yet uploaded" : opening ? "Opening…" : material.kind === "pdf" ? "Download" : "Open flipbook"}
      </span>
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
