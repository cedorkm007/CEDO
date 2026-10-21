// The scholar "I forgot my password" flow (Option A): a scholar proves who they are with their Scholar ID, name and the answer to the security question
// they set earlier, and then CHOOSES THEIR OWN new password. No fixed password is ever created or shown. Rules:
//   • a scholar who never set a security question cannot reset this way (they ask the SEAD office);
//   • at most 5 wrong answers per hour for one Scholar ID, and a limit on tries per address;
//   • every kind of failure (no such ID, wrong name, no question set, wrong answer) looks exactly the same from the outside, and a made-up question is
//     shown for an ID that does not exist, so nobody can find out which Scholar IDs are real.
// Pure logic with the outside world passed in (`deps`), so the same code runs in the Edge Function and in the tests. No Deno-only calls.
import { validateNewPassword } from "./passwordPolicy.ts";

export const SECURITY_QUESTIONS = [
  "What was the name of your first pet?",
  "What is your mother's maiden name?",
  "What elementary school did you attend?",
  "What was your childhood nickname?",
  "What is the name of your best friend growing up?",
  "In what city or town were you born?",
  "Who is your favorite teacher, and what subject did they teach?",
];

export const TOO_MANY_TRIES = "Too many attempts. Please wait a while and try again, or ask the SEAD office to reset your password.";
export const ANSWER_FAILED = "We couldn't verify those details. If you never set a security question, please ask the SEAD office to reset your password.";
export const LOCKED_OUT = "Too many wrong answers. Please try again in an hour, or ask the SEAD office to reset your password.";

export interface ScholarRecord { id: string; first_name: string | null; last_name: string | null; security_question: string | null }

export interface SelfResetDeps {
  /** Counts this try; returns an error text when there have been too many from this ID / address. */
  gate(identity: string, ip: string): Promise<string | null>;
  isLocked(identity: string): Promise<boolean>;
  registerFailure(identity: string, ip: string): Promise<void>;
  clearFailures(identity: string): Promise<void>;
  findScholar(scholarIdNumber: string): Promise<ScholarRecord | null>;
  verifyAnswer(scholarId: string, answer: string): Promise<boolean>;
  setPassword(scholarId: string, password: string): Promise<string | null>;
  log(entry: { scholarId: string; scholarIdNumber: string; scholarName: string }): Promise<void>;
}

export interface SelfResetBody { scholarIdNumber?: unknown; lastName?: unknown; firstName?: unknown; securityAnswer?: unknown; newPassword?: unknown }
export interface SelfResetResult { status: number; body: Record<string, unknown> }

/** A question to show for an ID that does not exist (or has no question): always the same one for the same ID, so it looks real. */
export function decoyQuestion(identity: string): string {
  let h = 0;
  for (const ch of identity.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return SECURITY_QUESTIONS[h % SECURITY_QUESTIONS.length];
}

export async function handleScholarSelfReset(raw: SelfResetBody, ip: string, deps: SelfResetDeps): Promise<SelfResetResult> {
  const scholarIdNumber = String(raw.scholarIdNumber ?? "").trim();
  const lastName = String(raw.lastName ?? "").trim();
  const firstName = String(raw.firstName ?? "").trim();
  const answer = typeof raw.securityAnswer === "string" ? raw.securityAnswer.trim() : "";
  const newPassword = typeof raw.newPassword === "string" ? raw.newPassword : "";
  if (!scholarIdNumber || !lastName || !firstName) return { status: 400, body: { error: "Please fill in your Scholar ID, Last Name, and First Name." } };

  const tooMany = await deps.gate(scholarIdNumber, ip);
  if (tooMany) return { status: 429, body: { error: tooMany } };

  const scholar = await deps.findScholar(scholarIdNumber);
  const nameMatches = !!scholar
    && String(scholar.last_name ?? "").trim().toLowerCase() === lastName.toLowerCase()
    && String(scholar.first_name ?? "").trim().toLowerCase() === firstName.toLowerCase();
  const eligible = !!scholar && nameMatches && !!scholar.security_question;
  const question = eligible ? String(scholar!.security_question) : decoyQuestion(scholarIdNumber);

  // Step 1: only the identity: show the question (the real one, or a made-up one that looks the same).
  if (!answer) return { status: 200, body: { ok: true, needsAnswer: true, question } };

  // Step 2: the answer and the new password.
  const passwordProblem = validateNewPassword(newPassword, { avoid: [scholarIdNumber, firstName, lastName] });
  if (passwordProblem) return { status: 400, body: { error: passwordProblem, needsAnswer: true, question } };
  if (await deps.isLocked(scholarIdNumber)) return { status: 429, body: { error: LOCKED_OUT } };

  const answerOk = eligible && await deps.verifyAnswer(scholar!.id, answer);
  if (!answerOk) {
    await deps.registerFailure(scholarIdNumber, ip);
    return { status: 401, body: { error: ANSWER_FAILED, needsAnswer: true, question } };
  }

  const setError = await deps.setPassword(scholar!.id, newPassword);
  if (setError) return { status: 500, body: { error: "We couldn't save your new password. Please try again." } };
  await deps.clearFailures(scholarIdNumber);
  await deps.log({ scholarId: scholar!.id, scholarIdNumber, scholarName: `${scholar!.first_name ?? ""} ${scholar!.last_name ?? ""}`.trim() });
  return { status: 200, body: { ok: true, reset: true } };
}
