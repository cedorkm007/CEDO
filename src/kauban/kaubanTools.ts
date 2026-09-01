import type { ComponentType } from "react";
import { MessageSquareText, Wrench, Captions, Pencil, Siren } from "lucide-react";
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
  /** A distinct bright color per tool (icon circle background + icon
   *  color) instead of one uniform blue everywhere — most Kauban users
   *  are kids under 8, so a colorful, distinguishable dashboard reads
   *  friendlier than a monochrome one. Colors are lifted from the
   *  original app's own per-icon SVG fills in layout.blade.php /
   *  sign-language-tools.blade.php, not invented from scratch. */
  bg: string;
  fg: string;
  /** "all" or the specific roles that can see this tool — mirrors the
   *  original Laravel app's own per-controller role checks (routes/web.php
   *  + QuickPhraseController/SpeechToSignLanguageController), not a new
   *  restriction invented here. */
  roles: KaubanRole[] | "all";
}

// Sign Language, Sign Language Quiz, Speech to Sign Language, and Text to
// Speech are deliberately NOT separate dashboard tiles — the original
// app's own bottom nav (resources/views/layout.blade.php) only ever
// exposed one combined "Sign Language Tools" icon for all of them (its
// `active` check literally matches all their route names at once). They
// stay reachable through SignLanguageToolsPage.tsx, which already
// contains the correct role-based subset of them — having them here too
// was a redundant second entry point that never existed in the source.
export const KAUBAN_TOOLS: KaubanTool[] = [
  { page: "quickPhrases", label: "Quick Phrases", description: "Tap out common sentences instantly.", icon: MessageSquareText, bg: "#EBF8FF", fg: "#2B6CB0", roles: ["deaf", "hard-of-hearing"] },
  { page: "signLanguageTools", label: "Sign Language Tools", description: "Everything sign-language related, all in one place.", icon: Wrench, bg: "#FAF5FF", fg: "#6B46C1", roles: "all" },
  { page: "speechToText", label: "Speech to Text", description: "See spoken words as text in real time.", icon: Captions, bg: "#FFFAF0", fg: "#DD6B20", roles: "all" },
  { page: "drawingPad", label: "Drawing Pad", description: "Draw to communicate when words aren't enough.", icon: Pencil, bg: "#F0FFF4", fg: "#38A169", roles: "all" },
  { page: "emergency", label: "Emergency", description: "Quick access to emergency contacts and messages.", icon: Siren, bg: "#FFF5F5", fg: "#E53E3E", roles: "all" },
];

export function toolsForRole(role: KaubanRole): KaubanTool[] {
  return KAUBAN_TOOLS.filter(t => t.roles === "all" || t.roles.includes(role));
}
