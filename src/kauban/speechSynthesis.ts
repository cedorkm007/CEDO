/**
 * Thin wrapper over the browser's Web Speech API — used by Quick Phrases
 * now, and by the Text to Speech tool (milestone 14). Pure client-side,
 * no backend, matching everything else in Kauban's tool set.
 */
export function speakText(text: string): void {
  if (!("speechSynthesis" in window) || !text.trim()) return;
  window.speechSynthesis.cancel(); // stop whatever was speaking before
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

export function isSpeechSynthesisSupported(): boolean {
  return "speechSynthesis" in window;
}
