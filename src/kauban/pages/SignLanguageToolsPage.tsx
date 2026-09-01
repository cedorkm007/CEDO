import { Volume2, Mic, Hand, Captions, GraduationCap } from "lucide-react";
import type { KaubanPage, KaubanRole } from "../types";
import { KaubanPageHeader } from "../components/KaubanPageHeader";

interface FeatureCard {
  page: KaubanPage;
  label: string;
  description: string;
  icon: typeof Volume2;
  show: boolean;
}

/**
 * A navigation hub grouping the other sign-language-related tools onto
 * one page — this is a direct port of the original app's own
 * `sign-language-tools.blade.php`, found and read after the fact (it was
 * missed during milestone 1's initial investigation, which is why this
 * screen was left as a placeholder through milestones 12-15). Every
 * card's role-based visibility and label copy is copied straight from
 * that source, including "Sign Language" vs. "Sign Language Tutorial"
 * depending on role.
 */
export function SignLanguageToolsPage({ role, onNavigate, onBack }: {
  role: KaubanRole;
  onNavigate: (page: KaubanPage) => void;
  onBack: () => void;
}) {
  const cards: FeatureCard[] = [
    {
      page: "textToSpeech", label: "Text to Speech", description: "Type and let it speak",
      icon: Volume2, show: role !== "hearing",
    },
    {
      page: "speechToSignLanguage", label: "Speech to Sign", description: "Listen and convert to sign videos",
      icon: Mic, show: role === "deaf",
    },
    {
      page: "signLanguage",
      label: role === "hearing" ? "Sign Language" : "Sign Language Tutorial",
      description: role === "hearing" ? "Type and watch it sign" : "Watch and learn sign language",
      icon: Hand, show: true,
    },
    {
      page: "speechToText", label: "Speech to Text", description: "Listen and read what others say",
      icon: Captions, show: role === "hearing",
    },
    {
      page: "signLanguageQuiz", label: "Sign Language Quiz", description: "Test your sign language skills!",
      icon: GraduationCap, show: true,
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#059669] to-[#2563EB] p-4 sm:p-8">
      <div className="mx-auto max-w-3xl rounded-[20px] bg-[#F7FAFC] p-6 shadow-xl sm:p-10">
        <KaubanPageHeader title="Sign Language Tools" subtitle="Everything sign-language related, all in one place." onBack={onBack} />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {cards.filter(c => c.show).map(card => (
            <button
              key={card.page}
              onClick={() => onNavigate(card.page)}
              className="flex flex-col items-center gap-2 rounded-2xl border border-transparent bg-white p-6 text-center shadow-sm transition hover:-translate-y-0.5 hover:border-[#3182CE] hover:shadow-md focus:outline-none focus-visible:ring-4 focus-visible:ring-[#3182CE]/30"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#EBF8FF] text-[#2B6CB0]">
                <card.icon size={22} />
              </span>
              <span className="text-base font-bold text-[#2D3748]">{card.label}</span>
              <span className="text-sm text-[#718096]">{card.description}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
