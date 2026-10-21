// "You must choose your own password" gate (SDP Monitoring update, Phase 6). Every account that was given a temporary password is marked in the database
// (supabase_migration_sdp_update_p6_password_security.sql); the staff, school and scholar sites ask here and, when marked, show the choose-a-password
// screen before anything else. Until the database update is installed the questions simply answer "no", so nothing changes.
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { validateNewPassword } from "@/lib/passwordPolicy";

/** Does the signed-in person still have to choose a new password? */
export async function isPasswordChangeRequired(): Promise<boolean> {
  const { data, error } = await supabase.rpc("my_password_change_required");
  return !error && data === true;
}

/**
 * Saves the password the person chose and clears the marker (which only clears if the password really changed).
 * `avoid` = words the password must not contain (user name, Scholar ID, name).
 */
export async function finishForcedPasswordChange(newPassword: string, avoid: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const problem = validateNewPassword(newPassword, { avoid });
  if (problem) return { ok: false, error: problem };
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    const text = /different from the old/i.test(error.message) ? "Your new password must be different from your temporary password." : error.message;
    return { ok: false, error: text || "Could not save your new password. Please try again." };
  }
  const { error: completeError } = await supabase.rpc("complete_password_change");
  if (completeError) return { ok: false, error: "Your password was changed, but we could not finish. Please sign out and sign in again with your new password." };
  return { ok: true };
}

/** Asks (once per sign-in) whether the person must choose a new password. */
export function usePasswordChangeRequired(signedInAs: string | null | undefined): { required: boolean; clear: () => void } {
  const [required, setRequired] = useState(false);
  useEffect(() => {
    if (!signedInAs) { setRequired(false); return; }
    let cancelled = false;
    void isPasswordChangeRequired().then(r => { if (!cancelled) setRequired(r); });
    return () => { cancelled = true; };
  }, [signedInAs]);
  return { required, clear: () => setRequired(false) };
}
