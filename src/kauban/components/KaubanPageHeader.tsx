import { ArrowLeft } from "lucide-react";

/** Shared header for every tool screen (Quick Phrases, Sign Language, the
 *  Quiz, and the ones milestones 13-15 add) — same back-to-dashboard
 *  button and title layout everywhere rather than each screen rolling
 *  its own. */
export function KaubanPageHeader({ title, subtitle, onBack }: { title: string; subtitle?: string; onBack: () => void }) {
  return (
    <div className="mb-6 flex items-center gap-3">
      <button
        onClick={onBack}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#4F46E5]/20 bg-white text-[#4F46E5] hover:bg-[#4F46E5]/5"
        aria-label="Back to Dashboard"
      >
        <ArrowLeft size={18} />
      </button>
      <div className="min-w-0">
        <h1 className="text-xl font-extrabold text-[#1E1B3A]">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
      </div>
    </div>
  );
}
