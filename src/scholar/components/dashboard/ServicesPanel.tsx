import { useEffect, useState } from "react";
import { Briefcase, RotateCw, MessageSquare, FileText, BadgeCheck, CreditCard, AlertCircle, Info, Construction } from "lucide-react";
import { SectionCard } from "./SectionCard";
import { RenewalPanel } from "./RenewalPanel";
import { ConsultationPanel } from "./ConsultationPanel";
import { useUrlState } from "@/app/useUrlState";
import { fetchMyRenewals, type MyRenewalWindow } from "../../renewalApi";
import { consultationTileChip, renewalTileChip } from "../../renewalSummary";

const SERVICES = [
  { key: "renewal", label: "Renewal", icon: <RotateCw size={18} /> },
  { key: "consultation", label: "Consultation", icon: <MessageSquare size={18} /> },
  { key: "guarantee-letter", label: "Request for Guarantee Letter", icon: <FileText size={18} /> },
  { key: "certification", label: "Request for Certification for Recognized City Scholar", icon: <BadgeCheck size={18} /> },
  { key: "atm-application", label: "ATM Application", icon: <CreditCard size={18} /> },
  { key: "atm-concerns", label: "ATM Concerns", icon: <AlertCircle size={18} /> },
];

const CHIP_TONE = { action: "border-amber-400 bg-amber-50 text-amber-950", waiting: "border-sky-300 bg-sky-50 text-sky-900", done: "border-green-300 bg-green-50 text-green-900" } as const;

export function ServicesContent() {
  // The chosen service is kept in the address bar (?service=renewal) so a link, a refresh and the Back button all work, and the portal home can open it directly.
  const [service, setService] = useUrlState<string>("service", "", v => SERVICES.some(s => s.key === v));
  const selected: string | null = service || null;
  const setSelected = (next: string | null) => setService(next ?? "");
  const [windows, setWindows] = useState<MyRenewalWindow[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchMyRenewals().then(r => { if (!cancelled && r.ok) setWindows(r.overview.windows); });
    return () => { cancelled = true; };
  }, [selected]);
  const chips: Record<string, { text: string; tone: keyof typeof CHIP_TONE } | null> = {
    renewal: windows ? renewalTileChip(windows) : null,
    consultation: windows ? consultationTileChip(windows) : null,
  };

  return (
    <>
      <p className="text-[13px] text-slate-600 italic flex items-center gap-1.5 mb-5">
        <Info size={13} /> Services you can avail from the City Education and Development Office (CEDO).
      </p>

      {selected === "renewal" || selected === "consultation" ? (
        <div>
          <button onClick={() => setSelected(null)} className="mb-4 text-[14px] font-semibold text-[#00709f] hover:underline">← Back to services</button>
          {selected === "renewal" ? <RenewalPanel /> : <ConsultationPanel />}
        </div>
      ) : (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5">
        {SERVICES.map(s => (
          <button
            key={s.key}
            onClick={() => setSelected(s.key)}
            className="flex flex-col items-start gap-2.5 bg-[#f7f9fc] hover:bg-white border border-[#e6ecf5] hover:border-[#cfe0f5] rounded-xl p-4 text-left hover:-translate-y-0.5 hover:shadow-[0_6px_16px_rgba(6,36,68,0.1)] transition-all"
          >
            <span className="w-[42px] h-[42px] rounded-[10px] bg-[#062444] text-[#F3BC00] flex items-center justify-center">{s.icon}</span>
            <span className="text-[13.5px] font-bold text-[#062444] leading-snug">{s.label}</span>
            {chips[s.key] && <span className={`rounded-full border px-2.5 py-0.5 text-[13px] font-bold ${CHIP_TONE[chips[s.key]!.tone]}`}>{chips[s.key]!.text}</span>}
          </button>
        ))}
      </div>
      )}

      {selected && selected !== "renewal" && selected !== "consultation" && (
        <div className="mt-5 flex items-center gap-2.5 bg-[#F3BC00]/10 border border-[#F3BC00]/25 rounded-lg px-4 py-3 text-[13.5px] text-[#7a5c00]">
          <Construction size={16} className="shrink-0" />
          This service is under development — please contact the CEDO office directly for now.
        </div>
      )}
    </>
  );
}

/** Kept for any other place that still wants Services as its own standalone card. */
export function ServicesPanel() {
  return (
    <SectionCard icon={<Briefcase size={14} />} title="Services">
      <ServicesContent />
    </SectionCard>
  );
}
