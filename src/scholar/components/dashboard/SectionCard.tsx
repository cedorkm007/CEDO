import type { ReactNode } from "react";

export function SectionCard({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-[#e8edf2] shadow-[0_2px_16px_rgba(6,36,68,0.06)] overflow-hidden">
      <div className="flex items-center gap-2.5 bg-[#f8fafd] border-b border-[#e8edf2] px-5 py-3.5">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#062444] to-[#0a3a6b] flex items-center justify-center shrink-0 text-[#F3BC00]">
          {icon}
        </div>
        <h3 className="text-[12px] font-bold uppercase tracking-[1.3px] text-[#062444]">{title}</h3>
      </div>
      <div className="p-5 md:p-6">{children}</div>
    </div>
  );
}
