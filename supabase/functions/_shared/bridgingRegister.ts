// The steps of registering a Kagay-anon Bridging account, with no imports and no Deno-only calls, so the SAME code runs in the server function
// (supabase/functions/bridging-register), in the local demo and in the tests. The database function bridging_register() checks every detail again.
// Accounts are made by this server function, so public sign-up stays OFF in the Bridging project.

export const ACCOUNT_DOMAIN = "bridging.cedo.local";
/** Generous on purpose: a whole computer lab shares one internet address. */
export const PER_HOUR = 120, PER_DAY = 800;

export interface RegisterDeps {
  /** false when this is not a Bridging database (the function was deployed to the wrong project). */
  isBridgingDatabase(): Promise<boolean>;
  /** Counts this attempt; false when this address has made too many. */
  allowAttempt(ip: string, perHour: number, perDay: number): Promise<boolean>;
  /** null = no "I am human" check is set up. */
  turnstile: { verify(token: string, ip: string): Promise<boolean> } | null;
  createUser(email: string, password: string): Promise<{ id: string } | { error: string }>;
  register(userId: string, details: unknown): Promise<{ duplicate: boolean } | { error: string }>;
  deleteUser(userId: string): Promise<void>;
}

export interface RegisterOutcome { status: number; json: { ok?: boolean; duplicate?: boolean; error?: string } }
const fail = (status: number, error: string): RegisterOutcome => ({ status, json: { error } });

export async function handleBridgingRegister(body: Record<string, unknown>, ip: string, deps: RegisterDeps): Promise<RegisterOutcome> {
  const username = String(body.username ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const details = body.details as Record<string, unknown> | undefined;
  const role = details?.role;

  if (!details || (role !== "student" && role !== "teacher")) return fail(400, "Choose Student or Teacher.");
  if (!/^[a-z0-9][a-z0-9._]{3,29}$/.test(username)) return fail(400, "Use 4 to 30 letters or numbers for your username (dot and underscore are fine).");
  const min = role === "teacher" ? 10 : 8;
  if (password.length < min) return fail(400, `Use at least ${min} characters for your password.`);
  if (password.length > 72) return fail(400, "Use at most 72 characters for your password.");
  if (password.toLowerCase() === username) return fail(400, "Do not use your username as your password.");

  if (!(await deps.isBridgingDatabase())) return fail(500, "Registration is not set up correctly. Please tell CEDO.");
  if (!(await deps.allowAttempt(ip, PER_HOUR, PER_DAY))) return fail(429, "Too many registrations from this connection. Please wait a while and try again.");
  if (deps.turnstile && !(await deps.turnstile.verify(String(body.captchaToken ?? ""), ip))) return fail(400, "Please complete the check that you are a person, then try again.");

  const user = await deps.createUser(`${username}@${ACCOUNT_DOMAIN}`, password);
  if ("error" in user) return /already|exists|registered/i.test(user.error) ? fail(409, "That username is already taken.") : fail(500, "Couldn't create the account. Please try again.");

  // the profile and consent are saved by one database call; when it refuses (or warns), the sign-in account is removed again, so nothing is left half-made
  let saved: { duplicate: boolean } | { error: string };
  try { saved = await deps.register(user.id, details); }
  catch { saved = { error: "Couldn't save your registration. Please try again." }; }
  if ("error" in saved) { await deps.deleteUser(user.id); return fail(400, saved.error); }
  if (saved.duplicate) { await deps.deleteUser(user.id); return { status: 200, json: { ok: false, duplicate: true } }; }
  return { status: 200, json: { ok: true } };
}
