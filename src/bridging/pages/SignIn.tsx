// /bridging: sign in, and "Forgot password" (the request goes to CEDO; the admin screen that answers it comes in Phase 2).
import { useState } from "react";
import { forgotPassword, signIn } from "../api";
import { AuthShell, Button, Card, ErrorText, OkText, PasswordInput, TextInput } from "../ui";

export function SignIn({ onSignedIn, onRegister }: { onSignedIn: () => void; onRegister: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit() {
    if (!username.trim() || !password) { setError("Enter your username and password."); return; }
    setBusy(true);
    setError("");
    const r = await signIn(username, password);
    setBusy(false);
    if (r.ok === false) { setError(r.error); return; }
    onSignedIn();
  }

  async function askReset() {
    if (!username.trim()) { setError("Enter your username first."); return; }
    setBusy(true);
    setError("");
    const r = await forgotPassword(username);
    setBusy(false);
    if (r.ok === false) setError(r.error); else setSent(true);
  }

  if (forgot) {
    return (
      <AuthShell title="Forgot password" onBack={() => { setForgot(false); setSent(false); setError(""); }}>
        <Card className="space-y-4">
          {sent ? (
            <OkText>Your request was noted. Ask your teacher or CEDO for a temporary password. If you typed your username wrongly, send it again.</OkText>
          ) : (
            <p className="text-[14px] text-slate-700">Type your username. CEDO will be told that you need a new password, and your teacher or CEDO will give you a temporary one.</p>
          )}
          <TextInput label="Username" value={username} onChange={v => { setUsername(v); setSent(false); setError(""); }} autoComplete="username" autoCapitalize="none" spellCheck={false} />
          <ErrorText>{error}</ErrorText>
          <Button className="w-full" onClick={() => void askReset()} disabled={busy}>{busy ? "Sending…" : "Send request"}</Button>
        </Card>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <Card>
        <form className="space-y-4" onSubmit={e => { e.preventDefault(); void submit(); }} noValidate>
          <h1 className="text-2xl font-bold text-[#1e3a5f]">Sign in</h1>
          <TextInput label="Username" value={username} onChange={v => { setUsername(v); setError(""); }} autoComplete="username" autoCapitalize="none" spellCheck={false} />
          <PasswordInput label="Password" value={password} onChange={v => { setPassword(v); setError(""); }} autoComplete="current-password" />
          <ErrorText>{error}</ErrorText>
          <Button type="submit" className="w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
          <button type="button" onClick={() => { setForgot(true); setError(""); }} className="block w-full text-center text-[14px] font-bold text-[#1e3a5f] underline">Forgot password?</button>
        </form>
      </Card>
      <Card className="text-center">
        <p className="mb-3 text-[14px] text-slate-700">New here? Students and teachers of Cagayan de Oro City can register.</p>
        <Button variant="gold" className="w-full" onClick={onRegister}>Create an account</Button>
      </Card>
    </AuthShell>
  );
}
