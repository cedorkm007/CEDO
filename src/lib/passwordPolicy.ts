// The rules for passwords. This is the website's copy of supabase/functions/_shared/passwordPolicy.ts (the server checks the same rules again);
// tests/sdp-update/phase6_logic_tests.mjs checks that both give the same answer for the same password. If you change one, change the other.

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 72; // the most the password hashing (bcrypt) looks at

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

/** The checklist shown while someone types a new password (each line says whether it is met; never colour alone). */
export function passwordChecklist(password: string, confirm: string): { label: string; met: boolean }[] {
  const kinds = [/[a-z]/.test(password), /[A-Z]/.test(password), /\d/.test(password), /[^A-Za-z0-9]/.test(password)].filter(Boolean).length;
  return [
    { label: `At least ${PASSWORD_MIN} characters`, met: password.length >= PASSWORD_MIN },
    { label: "Two or more kinds of characters (letters, numbers, symbols)", met: kinds >= 2 },
    { label: "Not a common or simple password", met: password.length > 0 && !/too common|simple sequence|too few/.test(validateNewPassword(password) ?? "") },
    { label: "Both entries match", met: password.length > 0 && password === confirm },
  ];
}
