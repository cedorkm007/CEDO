import { Ear, EarOff, Volume2 } from "lucide-react";
import type { KaubanRole } from "../types";

const OPTIONS: { role: KaubanRole; label: string; description: string; icon: typeof Ear }[] = [
  { role: "deaf", label: "Deaf", description: "I'm Deaf.", icon: EarOff },
  { role: "hard-of-hearing", label: "Hard of Hearing", description: "I have some hearing.", icon: Ear },
  { role: "hearing", label: "Hearing", description: "I can hear and want to communicate with someone who can't.", icon: Volume2 },
];

/**
 * First screen a visitor sees — no accounts, no sign-in, just this
 * one-time choice (see localRole.ts), matching the original app's own
 * "no sign-in required" entry point (docs/kauban/PROGRESS.md milestone 1).
 * The choice decides which tools show up on the dashboard afterward.
 * Colors/background match the original app's own layout.blade.php: the
 * emerald-to-blue gradient body, a light content card, and the app-brand
 * green (#10B981) used for the "Kauban" title.
 */
export function RoleSelectionPage({ onSelect }: { onSelect: (role: KaubanRole) => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#059669] to-[#2563EB] p-4 sm:p-8">
      <div className="w-full max-w-lg rounded-[20px] bg-[#F7FAFC] p-6 shadow-xl sm:p-10">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-extrabold text-[#10B981] sm:text-3xl">Welcome to Kauban</h1>
          <p className="mt-2 text-base text-[#718096]">Which best describes you?</p>
        </div>

        <div className="space-y-3">
          {OPTIONS.map(({ role, label, description, icon: Icon }) => (
            <button
              key={role}
              onClick={() => onSelect(role)}
              className="flex w-full items-center gap-4 rounded-2xl border-2 border-transparent bg-white p-5 text-left shadow-sm transition hover:border-[#3182CE] hover:shadow-md focus:outline-none focus-visible:ring-4 focus-visible:ring-[#3182CE]/30"
            >
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[#EBF8FF] text-[#2B6CB0]">
                <Icon size={26} />
              </span>
              <span>
                <span className="block text-lg font-bold text-[#2D3748]">{label}</span>
                <span className="block text-sm text-[#718096]">{description}</span>
              </span>
            </button>
          ))}
        </div>

        <p className="mt-6 text-center text-xs text-[#A0AEC0]">
          You can change this anytime from the dashboard.
        </p>
      </div>
    </div>
  );
}
