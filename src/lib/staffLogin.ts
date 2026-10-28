// ─────────────────────────────────────────────────────────────
// src/lib/staffLogin.ts
// Small helpers for the staff sign-in page (src/app/App.tsx, SignInPage), kept here so they can be tested without a browser.
// ─────────────────────────────────────────────────────────────

/**
 * What the person typed in the username / email box, cleaned. A phone keyboard or the browser's autofill often adds a space at the end (or the start); the username look-up
 * in the database already ignores spaces and capitals, but an EMAIL goes straight to the sign-in service, which does not, so a trailing space made a correct email fail.
 * Invisible characters (zero-width spaces, the byte-order mark) are removed too. The PASSWORD is never touched: it must be sent exactly as typed.
 */
export function cleanLoginName(raw: string): string {
  return raw.replace(/[​-‍⁠﻿]/g, "").trim();
}

/**
 * A password pasted from a message or a notice often carries a space, a line break or an invisible character at the start or the end, which makes a CORRECT password fail.
 * Returns the password without such stray edges when there are any (to try once more after the exact password was refused), otherwise null. The password the person typed is
 * always tried first, exactly as typed, so a password that really does start or end with a space still works. Nothing inside the password is ever changed.
 */
export function passwordWithoutStrayEdges(password: string): string | null {
  const cleaned = password.replace(/^[\s\u200B-\u200D\u2060\uFEFF]+|[\s\u200B-\u200D\u2060\uFEFF]+$/g, "");
  return cleaned !== password && cleaned.length > 0 ? cleaned : null;
}

export interface AuthErrorLike { message?: string | null; status?: number | null; code?: string | null }

/**
 * The message for a failed password sign-in. Only a really wrong username / password gets "Incorrect username or password"; the other causes get their own message, so a
 * person with the right password is told what is actually wrong. (The sign-in service answers "banned" or "not confirmed" only AFTER the password was accepted, so this does not
 * tell a stranger anything.)
 */
export function staffSignInErrorMessage(e: AuthErrorLike | null | undefined): string {
  const text = `${e?.code ?? ""} ${e?.message ?? ""}`.toLowerCase();
  if (e?.status === 429 || /over_request_rate_limit|rate limit|too many/.test(text)) return "Too many attempts. Please wait a few minutes and try again.";
  if (/banned|user_banned/.test(text)) return "This account has been deactivated. Please contact an administrator.";
  if (/email_not_confirmed|not confirmed/.test(text)) return "This account's email has not been confirmed yet. Please contact an administrator.";
  if (e?.status === 0 || /failed to fetch|network|timeout|timed out/.test(text)) return "Couldn't reach the server. Check your internet connection and try again.";
  if (e?.status != null && e.status >= 500) return "The sign-in service is having a problem right now. Please try again in a moment.";
  return "Incorrect username or password.";
}
