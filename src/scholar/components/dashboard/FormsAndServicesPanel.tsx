import { useState } from "react";
import { Briefcase, FileText, Download, BookOpen, Wrench, Construction } from "lucide-react";
import { SectionCard } from "./SectionCard";
import { ServicesContent } from "./ServicesPanel";

type Tab = "forms" | "services";

const FORMS = [
  { key: "scholarship-application", label: "Scholarship Application Form", icon: <FileText size={18} /> },
  { key: "handbook", label: "Scholars' Handbook", icon: <BookOpen size={18} /> },
  { key: "sdp-proposal", label: "SDP Activity Proposal Template", icon: <FileText size={18} /> },
  { key: "other-tools", label: "Other Tools & Templates", icon: <Wrench size={18} /> },
];

function FormsContent() {
  return (
    <>
      <p className="text-[13px] text-slate-400 italic flex items-center gap-1.5 mb-5">
        <FileText size={13} /> Forms, handbooks, and tools available for scholars.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5">
        {FORMS.map(f => (
          <div key={f.key} className="flex flex-col items-start gap-2.5 bg-[#f7f9fc] border border-[#e6ecf5] rounded-xl p-4">
            <span className="w-[42px] h-[42px] rounded-[10px] bg-[#062444] text-[#F3BC00] flex items-center justify-center">{f.icon}</span>
            <span className="text-[13.5px] font-bold text-[#062444] leading-snug">{f.label}</span>
            <span className="flex items-center gap-1 text-[11.5px] text-slate-400">
              <Download size={12} /> Not yet uploaded
            </span>
          </div>
        ))}
      </div>
      <div className="mt-5 flex items-center gap-2.5 bg-[#F3BC00]/10 border border-[#F3BC00]/25 rounded-lg px-4 py-3 text-[13.5px] text-[#7a5c00]">
        <Construction size={16} className="shrink-0" />
        Downloadable files aren't uploaded yet — this section will let staff attach the actual documents.
      </div>
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
