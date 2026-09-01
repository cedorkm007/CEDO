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
    } else {
      index++;
    }
  }
  return matches;
}
