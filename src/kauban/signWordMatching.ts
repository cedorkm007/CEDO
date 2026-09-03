import type { SignWord } from "./kaubanPublicApi";

export interface MatchedClip {
  word: SignWord;
  label: string;
}

interface MatchEntry {
  words: string[];
  word: SignWord;
}

/**
 * Greedy longest-phrase-first matcher — this is a direct port of the
 * original Laravel app's own algorithm from
 * speech-to-sign-language.blade.php's signVideoLibrary matching code
 * (captured in docs/kauban/PROGRESS.md's milestone-1 entry), just run
 * against kauban_sign_words rows instead of a hardcoded JS object. Multi-
 * word phrases ("good morning") are checked before single words so they
 * win over accidentally matching just "good", exactly like the original.
 * A word with no match is simply skipped, not an error.
 */
export function matchSignWords(transcript: string, pool: SignWord[]): MatchedClip[] {
  const words = transcript
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean);

  const entries: MatchEntry[] = pool
    .map(word => ({ words: word.phrase.split(" "), word }))
    .sort((a, b) => b.words.length - a.words.length);

  const matches: MatchedClip[] = [];
  for (let index = 0; index < words.length; ) {
    const match = entries.find(entry => entry.words.every((w, offset) => words[index + offset] === w));
    if (match) {
      matches.push({ word: match.word, label: match.word.label });
      index += match.words.length;
      continue;
    }
    // Speech recognition doesn't reliably agree with a stored phrase's
    // word boundaries for compound words — "good bye" can come back from
    // Vosk as one fused token ("goodbye") just as easily as two, and
    // which way it goes isn't consistent even for the same word. Rather
    // than pick one spelling and be right only half the time, also try
    // each multi-word phrase joined with no spaces against a single
    // transcript word before giving up on this position.
    const merged = entries.find(entry => entry.words.length > 1 && entry.words.join("") === words[index]);
    if (merged) {
      matches.push({ word: merged.word, label: merged.word.label });
      index++;
      continue;
    }
    index++;
  }

  // Speech recognition can still emit the same word or phrase back-to-back
  // as a duplicate (a browser/engine restart artifact — see
  // browserSpeechRecognition.ts's onresult dedup for one source of it, but
  // not the only possible one) even when the on-screen caption looks
  // right, since a transcript-level near-duplicate the caption's own dedup
  // doesn't happen to catch still reaches here. Playing the identical sign
  // clip twice in a row with nothing else between is never a meaningful
  // communication choice in this context, so collapsing an immediate
  // repeat of the same matched word is a safe backstop regardless of
  // exactly how the duplicate got into the transcript.
  const deduped: MatchedClip[] = [];
  for (const m of matches) {
    const prev = deduped[deduped.length - 1];
    if (!prev || prev.word.id !== m.word.id) deduped.push(m);
  }
  return deduped;
}
