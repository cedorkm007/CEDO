import { useState } from "react";
import { motion } from "motion/react";
import { User, Lock, Eye, EyeOff, LogIn } from "lucide-react";
import { schoolSignIn, requestSchoolPasswordReset } from "../schoolApi";
import { SchoolDialog } from "../components/SchoolDialog";
import { CEDO_CONTACT } from "../helpContent";
import CEDOSeal from "@/imports/CEDO_Seal.png";

interface SchoolLoginPageProps {
  onLoginSuccess: () => void;
}

/**
 * "Forgot password?": asks CEDO to reset it (the login emails are internal addresses nobody receives, so no email can be sent).
 * The answer is the same whether or not the login exists, so the form cannot be used to find out which schools have accounts.
 */
function ForgotPasswordDialog({ onClose }: { onClose: () => void }) {
  const [login, setLogin] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!login.trim()) { setError("Enter your username or email."); return; }
    setBusy(true);
    setError("");
    const result = await requestSchoolPasswordReset(login);
    setBusy(false);
    if (!result.ok) { setError("We could not send the request. Please try again, or contact CEDO."); return; }
    setSent(true);
  }

  return (
    <SchoolDialog title="Forgot your password?" onClose={onClose}>
      {sent ? (
        <div>
          <p role="status" className="text-[15px] text-[#062444] mb-3">
            Thank you. If that username or email belongs to a school account, the CEDO IT administrator has been told and will reset the password.
            You will be given a temporary password — change it after you sign in (Account menu, then Change password).
          </p>
          <p className="text-[14.5px] text-slate-800 mb-4">
            To follow up: <a href={`mailto:${CEDO_CONTACT.email}`} className="text-[#0077b6] underline">{CEDO_CONTACT.email}</a> ·{" "}
            <a href={`tel:${CEDO_CONTACT.mobileLink}`} className="text-[#0077b6] underline">{CEDO_CONTACT.mobile}</a>
          </p>
          <button onClick={onClose} className="bg-[#1B3372] text-white text-[14.5px] font-semibold rounded-lg px-5 py-2.5">Close</button>
        </div>
      ) : (
        <form onSubmit={submit} noValidate>
          <p className="text-[14.5px] text-slate-800 mb-3">Enter your school's username or email. CEDO will reset your password and give you a temporary one.</p>
          <label htmlFor="forgot-login" className="block text-[14px] font-semibold text-[#1B3372] mb-1">Username or email</label>
          <input id="forgot-login" value={login} onChange={e => setLogin(e.target.value)} autoCapitalize="none" spellCheck={false}
            className="w-full border-2 border-slate-300 rounded-xl px-3 py-2.5 text-[15px] outline-none focus:border-[#1B3372] mb-3" />
          {error && <p role="alert" className="text-[14px] text-red-800 bg-red-50 border border-red-300 px-3 py-2 rounded-lg mb-3">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-lg border border-slate-400 text-[14.5px] font-semibold text-[#1B3372]">Cancel</button>
            <button type="submit" disabled={busy} className="bg-[#1B3372] disabled:opacity-60 text-white text-[14.5px] font-semibold rounded-lg px-5 py-2.5">{busy ? "Sending…" : "Send request"}</button>
          </div>
        </form>
      )}
    </SchoolDialog>
  );
}

/** Same visual benchmark as the Scholar Portal's login page — one login path: username (or login email) + password. */
export function SchoolLoginPage({ onLoginSuccess }: SchoolLoginPageProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [forgot, setForgot] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!username.trim() || !password) {
      setError("Enter your username (or email) and password.");
      return;
    }
    setBusy(true);
    const result = await schoolSignIn(username.trim(), password);
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    onLoginSuccess();
  }

  const inputWrapCls = "flex items-center border-2 border-slate-300 rounded-xl px-3 py-2.5 gap-2 focus-within:border-[#1B3372] transition-colors bg-white";

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1B3372] to-[#0d1a3d] flex items-center justify-center px-4 py-10">
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4 }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8"
      >
        <div className="flex flex-col items-center mb-7">
          <img src={CEDOSeal} alt="CEDO" className="w-24 h-24 rounded-full object-cover border-4 border-[#F3BC00] shadow-lg mb-3" />
          <h1 className="text-xl font-extrabold text-[#1B3372] text-center">School Portal Login</h1>
          <p className="text-slate-700 text-[14px] mt-1 text-center">City Education and Development Office</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor="school-login" className="block text-[14px] font-semibold text-[#1B3372] mb-1">Username or email</label>
            <div className={inputWrapCls}>
              <User size={15} className="text-[#8a6a00] shrink-0" aria-hidden="true" />
              <input id="school-login" value={username} onChange={e => setUsername(e.target.value)} placeholder="e.g. capitol.university"
                autoComplete="username" autoCapitalize="none" spellCheck={false}
                className="w-full text-[15px] outline-none placeholder:text-slate-500" />
            </div>
          </div>

          <div className="mb-5">
            <label htmlFor="school-password" className="block text-[14px] font-semibold text-[#1B3372] mb-1">Password</label>
            <div className={inputWrapCls}>
              <Lock size={15} className="text-[#8a6a00] shrink-0" aria-hidden="true" />
              <input id="school-password" type={showPassword ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)}
                autoComplete="current-password" placeholder="••••••••••" className="w-full text-[15px] outline-none placeholder:text-slate-500" />
              <button type="button" onClick={() => setShowPassword(s => !s)} aria-label={showPassword ? "Hide password" : "Show password"} className="text-slate-700 hover:text-[#1B3372]">
                {showPassword ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
              </button>
            </div>
          </div>

          {error && <p role="alert" className="text-[14px] text-red-800 bg-red-50 border border-red-300 px-3 py-2 rounded-lg mb-4">{error}</p>}

          <motion.button
            type="submit"
            disabled={busy}
            whileHover={!busy ? { scale: 1.02 } : {}}
            whileTap={!busy ? { scale: 0.98 } : {}}
            className="w-full flex items-center justify-center gap-2 bg-[#F3BC00] hover:bg-[#e0ac00] disabled:opacity-60 text-[#1B3372] font-extrabold text-sm tracking-wide py-3.5 rounded-xl shadow-lg transition-colors"
          >
            {busy ? "SIGNING IN…" : "SIGN IN"} <LogIn size={16} aria-hidden="true" />
          </motion.button>

          <p className="text-center mt-4">
            <button type="button" onClick={() => setForgot(true)} className="text-[14.5px] font-semibold text-[#1B3372] underline">Forgot password?</button>
          </p>
          <p className="text-center text-[14px] text-slate-700 mt-4">
            Accounts are created by CEDO staff. Contact your CEDO coordinator if you need access.
          </p>
        </form>
      </motion.div>
      {forgot && <ForgotPasswordDialog onClose={() => setForgot(false)} />}
    </div>
  );
}
