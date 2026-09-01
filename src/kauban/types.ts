/**
 * Shared types for the public Kauban app (src/kauban/KaubanApp.tsx —
 * mounted at /kauban, see src/main.tsx). Kept in their own file so
 * kaubanTools.ts and KaubanApp.tsx can both import them without a
 * circular import between the two.
 */

/** Matches the original Laravel app's session role values exactly
 *  ('deaf' | 'hard-of-hearing' | 'hearing') so anything ported from its
 *  controllers/views needs no translation layer. */
export type KaubanRole = "deaf" | "hard-of-hearing" | "hearing";

export type KaubanPage =
  | "dashboard"
  | "quickPhrases"
  | "signLanguage"
  | "signLanguageQuiz"
  | "signLanguageTools"
  | "textToSpeech"
  | "speechToText"
  | "speechToSignLanguage"
  | "drawingPad"
  | "emergency";
