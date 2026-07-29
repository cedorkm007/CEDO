import { useState } from "react";
import { Briefcase, RotateCw, MessageSquare, FileText, BadgeCheck, CreditCard, AlertCircle, Info, Construction } from "lucide-react";
import { SectionCard } from "./SectionCard";

const SERVICES = [
  { key: "renewal", label: "Renewal", icon: <RotateCw size={18} /> },
  { key: "consultation", label: "Consultation", icon: <MessageSquare size={18} /> },
  { key: "guarantee-letter", label: "Request for Guarantee Letter", icon: <FileText size={18} /> },
  { key: "certification", label: "Request for Certification for Recognized City Scholar", icon: <BadgeCheck size={18} /> },
  { key: "atm-application", label: "ATM Application", icon: <CreditCard size={18} /> },
  { key: "atm-concerns", label: "ATM Concerns", icon: <AlertCircle size={18} /> },
];

export function ServicesPanel() {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <SectionCard icon={<Briefcase size={14} />} title="Services">
      <p className="text-[13px] text-slate-400 italic flex items-center gap-1.5 mb-5">
        <Info size={13} /> Services you can avail from the City Education and Development Office (CEDO).
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5">
        {SERVICES.map(s => (
          <button
            key={s.key}
            onClick={() => setSelected(s.key)}
            className="flex flex-col items-start gap-2.5 bg-[#f7f9fc] hover:bg-white border border-[#e6ecf5] hover:border-[#cfe0f5] rounded-xl p-4 text-left hover:-translate-y-0.5 hover:shadow-[0_6px_16px_rgba(6,36,68,0.1)] transition-all"
          >
            <span className="w-[42px] h-[42px] rounded-[10px] bg-[#062444] text-[#F3BC00] flex items-center justify-center">{s.icon}</span>
            <span className="text-[13.5px] font-bold text-[#062444] leading-snug">{s.label}</span>
          </button>
        ))}
      </div>

      {selected && (
        <div className="mt-5 flex items-center gap-2.5 bg-[#F3BC00]/10 border border-[#F3BC00]/25 rounded-lg px-4 py-3 text-[13.5px] text-[#7a5c00]">
          <Construction size={16} className="shrink-0" />
          This service is under development — please contact the CEDO office directly for now.
        </div>
      )}
    </SectionCard>
  );
}
