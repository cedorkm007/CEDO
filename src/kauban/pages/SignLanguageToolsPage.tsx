import { Volume2, Mic, Hand, Captions, GraduationCap } from "lucide-react";
import type { KaubanPage, KaubanRole } from "../types";
import { KaubanPageHeader } from "../components/KaubanPageHeader";

interface FeatureCard {
  page: KaubanPage;
  label: string;
  description: string;
  icon: typeof Volume2;
  bg: string;
  fg: string;
  show: boolean;
}

const KID_FONT = { fontFamily: "'Fredoka', sans-serif" };

/**
 * A navigation hub grouping the other sign-language-related tools onto
 * one page — this is a direct port of the original app's own
 * `sign-language-tools.blade.php`, found and read after the fact (it was
 * missed during milestone 1's initial investigation, which is why this
 * screen was left as a placeholder through milestones 12-15). Every
 * card's role-based visibility and label copy is copied straight from
 * that source, including "Sign Language" vs. "Sign Language Tutorial"
 * depending on role. Each card's bg/fg is a distinct bright color (a
 * different one per card, not the source's exact multi-color SVGs, but
 * pulled from the same hues that source used) rather than one uniform
 * blue, since most users are kids under 8.
 */
export function SignLanguageToolsPage({ role, onNavigate }: {
  role: KaubanRole;
  onNavigate: (page: KaubanPage) => void;
}) {
  const cards: FeatureCard[] = [
    {
      page: "textToSpeech", label: "Text to Speech", description: "Type and let it speak",
      icon: Volume2, bg: "#F0FFF4", fg: "#38A169", show: role !== "hearing",
    },
    {
      page: "speechToSignLanguage", label: "Speech to Sign", description: "Listen and convert to sign videos",
      icon: Mic, bg: "#EBF8FF", fg: "#2563EB", show: role === "deaf",
    },
    {
      page: "signLanguage",
      label: role === "hearing" ? "Sign Language" : "Sign Language Tutorial",
      description: role === "hearing" ? "Type and watch it sign" : "Watch and learn sign language",
      icon: Hand, bg: "#FAF5FF", fg: "#6B46C1", show: true,
    },
    {
      page: "speechToText", label: "Speech to Text", description: "Listen and read what others say",
      icon: Captions, bg: "#FFFAF0", fg: "#DD6B20", show: role === "hearing",
    },
    {
      page: "signLanguageQuiz", label: "Sign Language Quiz", description: "Test your sign language skills!",
      icon: GraduationCap, bg: "#FFF5F7", fg: "#D53F8C", show: true,
    },
  ];

  return (
    <div className="rounded-[20px] bg-[#F7FAFC] p-5 shadow-xl sm:p-10">
      <KaubanPageHeader title="Sign Language Tools" subtitle="Everything sign-language related, all in one place." />

      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        {cards.filter(c => c.show).map(card => (
          <button
            key={card.page}
            onClick={() => onNavigate(card.page)}
            className="flex min-h-[140px] flex-col items-center justify-center gap-2 rounded-3xl border-2 border-transparent bg-white p-4 text-center shadow-sm transition-all duration-150 active:scale-95 active:shadow-md sm:p-6 sm:hover:-translate-y-0.5 sm:hover:border-[#3182CE] sm:hover:shadow-md focus:outline-none focus-visible:ring-4 focus-visible:ring-[#3182CE]/30"
          >
            <span
              className="flex h-14 w-14 items-center justify-center rounded-2xl"
              style={{ backgroundColor: card.bg, color: card.fg }}
            >
              <card.icon size={24} />
            </span>
            <span className="text-base font-semibold text-[#2D3748]" style={KID_FONT}>{card.label}</span>
            <span className="text-xs text-[#718096] sm:text-sm">{card.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
