// Giving an account a temporary password: a random one, marked "must choose a new password" (public.account_password_flags), shown ONCE to the
// administrator who asked for it. Used by every function that creates or resets an account. Runs in Deno and (for the tests) in Node.
import { generateTemporaryPassword } from "./passwordPolicy.ts";

/** The small part of the Supabase admin client these helpers use (so tests can stand in for it). */
export interface AdminLike {
  auth: { admin: { updateUserById(id: string, attrs: { password: string }): Promise<{ error: { message: string } | null }> } };
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }>;
}

/** Marks an account (already holding a temporary password) as "must choose a new password". Returns an error text, or null. */
export async function markMustChangePassword(admin: Pick<AdminLike, "rpc">, userId: string, reason = "temporary_password"): Promise<string | null> {
  const { error } = await admin.rpc("flag_password_change", { p_user_id: userId, p_reason: reason });
  return error ? error.message : null;
}

/**
 * Sets a new random temporary password on an existing account and marks it. `password` is for the administrator's screen ONLY: never log it.
 * If the password was changed but the mark could not be saved, `warning` says so (the administrator can simply reset again).
 */
export async function issueTemporaryPassword(admin: AdminLike, userId: string, reason = "temporary_password"): Promise<{ ok: true; password: string; warning?: string } | { ok: false; error: string }> {
  const password = generateTemporaryPassword();
  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) return { ok: false, error: error.message };
  const markError = await markMustChangePassword(admin, userId, reason);
  return markError
    ? { ok: true, password, warning: "The password was changed, but the account could not be marked to choose a new password at sign-in. Run the Phase 6 database update, then reset it again." }
    : { ok: true, password };
}
