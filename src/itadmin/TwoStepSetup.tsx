import { useEffect, useState } from "react";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { supabase } from "@/lib/supabase";

/**
 * Two-step sign-in for the IT administrator account (SDP Monitoring update, Phase 6). The person scans a code with an authenticator app (Google
 * Authenticator, Microsoft Authenticator, Authy…); from then on, signing in also asks for the 6-digit code, and the account-creation and password-reset
 * functions refuse a session that did not pass that check — so a stolen password alone cannot create or reset accounts.
 */
export function TwoStepSetup() {
  const [factor, setFactor] = useState<{ id: string } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [enrol, setEnrol] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function refresh() {
    const { data } = await supabase.auth.mfa.listFactors();
    setFactor(data?.totp?.[0] ?? null);
    setLoaded(true);
  }
  useEffect(() => { void refresh(); }, []);

  async function start() {
    setBusy(true); setMessage(null);
    // A half-finished earlier try would block a new one with the same name, so remove any unverified factor first.
    const { data: existing } = await supabase.auth.mfa.listFactors();
    for (const f of existing?.all ?? []) if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "CEDO tracker" });
    setBusy(false);
    if (error || !data) { setMessage({ kind: "error", text: error?.message ?? "Could not start the set-up." }); return; }
    setEnrol({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }

  async function confirm() {
    if (!enrol) return;
    const clean = code.replace(/\s+/g, "");
    if (!/^\d{6}$/.test(clean)) { setMessage({ kind: "error", text: "Enter the 6 numbers shown in the app." }); return; }
    setBusy(true); setMessage(null);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrol.factorId, code: clean });
    setBusy(false);
    if (error) { setMessage({ kind: "error", text: "That code was not accepted. Try the next code the app shows." }); return; }
    setEnrol(null); setCode("");
    setMessage({ kind: "ok", text: "Two-step sign-in is on. Next time you sign in, you will be asked for a code." });
    await refresh();
  }

  async function turnOff() {
    if (!factor) return;
    if (!window.confirm("Turn off two-step sign-in? Your account will be protected by the password alone.")) return;
    setBusy(true); setMessage(null);
    const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
    setBusy(false);
    if (error) { setMessage({ kind: "error", text: "Could not turn it off: " + error.message + " (sign out and in again with a code first)." }); return; }
    setMessage({ kind: "ok", text: "Two-step sign-in is off." });
    await refresh();
  }

  if (!loaded) return null;
  const verified = factor !== null; // listFactors().totp only lists factors that finished set-up

  return (
    <section aria-label="Two-step sign-in" className="mb-5 rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          {verified ? <ShieldCheck size={18} className="mt-0.5 text-green-600" aria-hidden="true" /> : <ShieldAlert size={18} className="mt-0.5 text-amber-600" aria-hidden="true" />}
          <div>
            <h2 className="text-sm font-bold text-foreground">Two-step sign-in {verified ? "is on" : "is not set up"}</h2>
            <p className="text-[12.5px] text-muted-foreground">
              {verified
                ? "Signing in asks for a code from your authenticator app, and creating or resetting accounts needs it too."
                : "Strongly recommended for this account: it can create and reset every login. Set it up with an authenticator app on your phone."}
            </p>
          </div>
        </div>
        {verified
          ? <button type="button" disabled={busy} onClick={() => void turnOff()} className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-[12.5px] font-semibold hover:bg-muted">Turn off</button>
          : !enrol && <button type="button" disabled={busy} onClick={() => void start()} className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-primary-foreground">Set up</button>}
      </div>

      {enrol && (
        <div className="mt-4 grid gap-4 sm:grid-cols-[auto_1fr]">
          <img src={enrol.qr} alt="QR code to scan with the authenticator app" className="h-40 w-40 rounded-lg border border-border bg-white p-1" />
          <div className="space-y-3 text-[13px]">
            <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>Open the authenticator app and choose to add an account by scanning.</li>
              <li>Scan this picture (or type the key: <code className="rounded bg-muted px-1 font-mono">{enrol.secret}</code>).</li>
              <li>Type the 6-digit code the app shows, then press Confirm.</li>
            </ol>
            <div className="flex items-center gap-2">
              <input inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={e => setCode(e.target.value)} placeholder="123456" aria-label="6-digit code"
                className="w-36 rounded-lg border border-border bg-input-background px-3 py-2 text-center tracking-[0.25em]" />
              <button type="button" disabled={busy} onClick={() => void confirm()} className="rounded-lg bg-primary px-4 py-2 text-[12.5px] font-semibold text-primary-foreground">Confirm</button>
              <button type="button" onClick={() => { setEnrol(null); setCode(""); }} className="text-[12.5px] text-muted-foreground hover:underline">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {message && <p role="status" className={`mt-3 text-[12.5px] ${message.kind === "ok" ? "text-green-700" : "text-destructive"}`}>{message.text}</p>}
    </section>
  );
}
