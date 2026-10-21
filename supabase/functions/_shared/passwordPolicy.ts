// The rules for passwords, and the generator for temporary ones. No imports and no Deno-only calls, so the SAME file runs in the server
// functions (Deno), in the tests (Node) and is mirrored word for word in src/lib/passwordPolicy.ts for the website (a test checks they agree).

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 72; // the most the password hashing (bcrypt) looks at

// Letters and digits that cannot be confused when read from a screen or a printout: no 0/O, 1/l/I.
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const DIGITS = "23456789";

type RandomBytes = (length: number) => Uint8Array;
const systemRandom: RandomBytes = length => {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
};

/** One fair random index below `max` (no bias towards the first characters). */
function randomIndex(max: number, random: RandomBytes): number {
  const limit = 256 - (256 % max);
  for (;;) {
    const b = random(1)[0];
    if (b < limit) return b % max;
  }
}

/**
 * A temporary password for a new or reset account, e.g. "Kd7m-Xt4q-Wn9R": 12 characters in three groups of four (easy to read out and type), always
 * with capitals, small letters and digits. Meant to be shown once to the administrator and changed by the person at their first sign-in.
 */
export function generateTemporaryPassword(random: RandomBytes = systemRandom): string {
  const all = UPPER + LOWER + DIGITS;
  const chars: string[] = [];
  for (let i = 0; i < 2; i++) chars.push(UPPER[randomIndex(UPPER.length, random)]);
  for (let i = 0; i < 2; i++) chars.push(LOWER[randomIndex(LOWER.length, random)]);
  for (let i = 0; i < 2; i++) chars.push(DIGITS[randomIndex(DIGITS.length, random)]);
  while (chars.length < 12) chars.push(all[randomIndex(all.length, random)]);
  for (let i = chars.length - 1; i > 0; i--) {   // shuffle, so the guaranteed ones are not always first
    const j = randomIndex(i + 1, random);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8, 12).join("")}`;
}

const COMMON = [
  "1234567890", "12345678910", "0123456789", "0987654321", "1111111111", "0000000000", "9876543210", "1234512345",
  "password", "password1", "password12", "password123", "passw0rd12", "qwertyuiop", "qwerty1234", "qwerty12345", "asdfghjkl1", "iloveyou12",
  "welcome123", "welcome1234", "admin12345", "letmein123", "cedo123456", "scholar123", "scholar1234", "changeme12", "123456abcd", "abcd123456",
];

export interface PasswordContext {
  /** Things the password must not contain: a user name, a Scholar ID, the person's name. */
  avoid?: (string | null | undefined)[];
  /** Passwords the new one must differ from (the current / temporary one). */
  differentFrom?: (string | null | undefined)[];
}

/** The reason a chosen password is not accepted, in plain words, or null when it is fine. */
export function validateNewPassword(password: string, context: PasswordContext = {}): string | null {
  const p = String(password ?? "");
  if (p.length < PASSWORD_MIN) return `Your password must be at least ${PASSWORD_MIN} characters long.`;
  if (p.length > PASSWORD_MAX) return `Your password can be at most ${PASSWORD_MAX} characters long.`;
  if (/^\s|\s$/.test(p)) return "Your password cannot start or end with a space.";
  const lower = p.toLowerCase();
  if (COMMON.includes(lower)) return "That password is too common. Choose something harder to guess.";
  if (/^(?:0123456789|1234567890|abcdefghij)/.test(lower)) return "That password is a simple sequence. Choose something harder to guess.";
  const kinds = [/[a-z]/.test(p), /[A-Z]/.test(p), /\d/.test(p), /[^A-Za-z0-9]/.test(p)].filter(Boolean).length;
  if (kinds < 2) return "Mix at least two kinds of characters: letters, numbers or symbols.";
  if (new Set(lower).size < 4) return "That password repeats too few different characters.";
  for (const raw of context.avoid ?? []) {
    const word = String(raw ?? "").trim().toLowerCase();
    if (word.length >= 4 && lower.includes(word)) return "Your password cannot contain your user name, Scholar ID or name.";
  }
  for (const raw of context.differentFrom ?? []) {
    if (raw && p === raw) return "Your new password must be different from your current password.";
  }
  return null;
}
