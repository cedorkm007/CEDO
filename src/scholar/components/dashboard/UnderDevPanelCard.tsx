import { Construction } from "lucide-react";

export function UnderDevPanelCard({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-5 text-center text-slate-400">
      <Construction size={40} className="text-[#F3BC00] mb-3" />
      <p className="font-bold text-base text-[#062444] tracking-wide">{label}</p>
    </div>
  );
}
