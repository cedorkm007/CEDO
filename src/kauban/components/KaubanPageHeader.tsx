import { ArrowLeft } from "lucide-react";

/**
 * Shared header for every tool screen — same back-to-dashboard button and
 * title layout everywhere rather than each screen rolling its own.
 * Colors match the original app's own `.header-nav-btn` (back button)
 * and `.welcome-header h2`/`p` (title/subtitle) rules in
 * resources/views/layout.blade.php and sign-language-tools.blade.php.
 */
export function KaubanPageHeader({ title, subtitle, onBack }: { title: string; subtitle?: string; onBack: () => void }) {
  return (
    <div className="mb-6 flex items-center gap-3">
      <button
        onClick={onBack}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#EBF8FF] text-[#2B6CB0] hover:bg-[#BEE3F8]"
        aria-label="Back to Dashboard"
      >
        <ArrowLeft size={18} />
      </button>
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-[#2D3748]">{title}</h1>
        {subtitle && <p className="text-sm text-[#718096]">{subtitle}</p>}
      </div>
    </div>
  );
}
