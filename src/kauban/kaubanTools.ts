import type { ComponentType } from "react";
import { MessageSquareText, Hand, GraduationCap, Wrench, Volume2, Captions, Mic, Pencil, Siren } from "lucide-react";
import type { KaubanPage, KaubanRole } from "./types";

export interface KaubanTool {
  page: KaubanPage;
  label: string;
  description: string;
  // size/className match lucide-react's own LucideProps shape (size
  // accepts string|number there) — narrowing to just `number` here is
  // what broke `tsc -b` (structural propTypes comparison) even though
  // plain `tsc --noEmit` didn't catch it.
  icon: ComponentType<{ size?: string | number; className?: string }>;
  /** "all" or the specific roles that can see this tool — mirrors the
   *  original Laravel app's own per-controller role checks (routes/web.php
   *  + QuickPhraseController/SpeechToSignLanguageController), not a new
   *  restriction invented here. */
  roles: KaubanRole[] | "all";
}

export const KAUBAN_TOOLS: KaubanTool[] = [
  { page: "quickPhrases", label: "Quick Phrases", description: "Tap out common sentences instantly.", icon: MessageSquareText, roles: ["deaf", "hard-of-hearing"] },
  { page: "signLanguage", label: "Sign Language", description: "Learn and browse Filipino Sign Language.", icon: Hand, roles: "all" },
  { page: "signLanguageQuiz", label: "Sign Language Quiz", description: "Test what you've learned.", icon: GraduationCap, roles: "all" },
  { page: "signLanguageTools", label: "Sign Language Tools", description: "More sign language resources.", icon: Wrench, roles: "all" },
  { page: "textToSpeech", label: "Text to Speech", description: "Type something and have it spoken aloud.", icon: Volume2, roles: "all" },
  { page: "speechToText", label: "Speech to Text", description: "See spoken words as text in real time.", icon: Captions, roles: "all" },
  { page: "speechToSignLanguage", label: "Speech to Sign Language", description: "See spoken words translated into sign video.", icon: Mic, roles: ["deaf"] },
  { page: "drawingPad", label: "Drawing Pad", description: "Draw to communicate when words aren't enough.", icon: Pencil, roles: "all" },
  { page: "emergency", label: "Emergency", description: "Quick access to emergency contacts and messages.", icon: Siren, roles: "all" },
];

export function toolsForRole(role: KaubanRole): KaubanTool[] {
  return KAUBAN_TOOLS.filter(t => t.roles === "all" || t.roles.includes(role));
}

export function toolLabel(page: KaubanPage): string {
  return KAUBAN_TOOLS.find(t => t.page === page)?.label ?? page;
}
