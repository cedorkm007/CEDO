import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";

/**
 * Second step of signing in for an account that has an authenticator app set up (SDP Monitoring update, Phase 6): the 6-digit code from the app.
 * Used on the staff sign-in page. The account is already signed in with its password at this point; until the code is accepted the person is signed
 * out again if they cancel, so a password alone never opens the tools that check for the code.
 */
export function TwoStepCodeEntry({ onVerified, onCancel }: { onVerified: () => void; onCancel: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const clean = code.replace(/\s+/g, "");
    if (!/^\d{6}$/.test(clean)) { setError("Enter the 6 numbers shown in your authenticator app."); return; }
    setBusy(true); setError("");
    try {
      const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
      const factor = factors?.totp?.[0];
      if (listError || !factor) { setError("No authenticator app is set up for this account. Sign out and contact IT."); return; }
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: clean });
      if (verifyError) { setError("That code was not accepted. Wait for a new code in the app and try again."); setCode(""); return; }
      onVerified();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={e => { e.preventDefault(); void submit(); }} aria-label="Two-step sign-in">
      <h2 className="flex items-center gap-2 text-base font-semibold text-foreground mb-2"><ShieldCheck size={17} aria-hidden="true" /> Two-step sign-in</h2>
      <p className="text-sm text-muted-foreground mb-4">Open your authenticator app and enter the 6-digit code for the CEDO tracker.</p>
      {error && <div role="alert" className="text-sm text-destructive bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 mb-4">{error}</div>}
      <label className="block text-sm font-medium mb-1" htmlFor="two-step-code">Code</label>
      <input id="two-step-code" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={7} value={code} onChange={e => setCode(e.target.value)}
        placeholder="123456" className="w-full px-3 py-2.5 rounded-xl border border-border bg-input-background text-lg tracking-[0.3em] text-center focus:outline-none focus:ring-2 focus:ring-accent/50" />
      <div className="flex flex-col gap-3 mt-5">
        <button type="submit" disabled={busy} className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-60">{busy ? "Checking…" : "Confirm"}</button>
        <button type="button" onClick={onCancel} className="text-xs text-muted-foreground hover:underline">Cancel and sign out</button>
      </div>
    </form>
  );
}
