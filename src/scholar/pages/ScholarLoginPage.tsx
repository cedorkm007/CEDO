import { useState } from "react";
import { User, Calendar, IdCard, Lock, Eye, EyeOff, LogIn } from "lucide-react";
import { scholarSignIn } from "../scholarApi";

interface ScholarLoginPageProps {
  onLoginSuccess: () => void;
  onResetPassword: () => void;
}

/**
 * Matches SCHOLARS_LOGIN_PAGE.png: identify by (First/Last/M.I. + Birthday)
 * OR (Scholar ID Number), a single password field, Remember Me, and a
 * "Don't have an access yet? RESET PASSWORD" link.
 */
export function ScholarLoginPage({ onLoginSuccess, onResetPassword }: ScholarLoginPageProps) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [middleInitial, setMiddleInitial] = useState("");
  const [birthday, setBirthday] = useState("");
  const [scholarId, setScholarId] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const usingId = scholarId.trim().length > 0;
    const usingName = firstName.trim().length > 0 && lastName.trim().length > 0 && birthday.trim().length > 0;

    if (!usingId && !usingName) {
      setError("Enter your name and birthday, or your Scholar ID number.");
      return;
    }
    if (!password) {
      setError("Enter your password.");
      return;
    }

    setBusy(true);
    const result = await scholarSignIn(
      usingId
        ? { mode: "id", scholarIdNumber: scholarId.trim(), password }
        : { mode: "name", firstName: firstName.trim(), lastName: lastName.trim(), middleInitial: middleInitial.trim(), birthday, password }
    );
    setBusy(false);

    if (!result.ok) { setError(result.error); return; }
    onLoginSuccess();
  }

  return (
    <div className="min-h-[calc(100vh-64px)] bg-white flex flex-col md:flex-row">
      {/* Left welcome panel */}
      <div className="relative md:w-[42%] bg-gradient-to-br from-[#1B3372] to-[#16285C] px-8 py-12 md:py-20 overflow-hidden flex items-center">
        <div className="absolute -bottom-16 -left-16 w-64 h-64 rounded-full bg-white/5" />
        <div className="absolute bottom-24 left-40 w-40 h-40 rounded-full bg-white/5" />
        <div className="relative max-w-sm">
          <h1 className="text-3xl md:text-4xl font-extrabold text-white mb-4">Welcome!</h1>
          <div className="w-14 h-1 bg-[#F3BC00] mb-5" />
          <p className="text-white/80 text-sm leading-relaxed">
            Access this scholarship portal to view your information, stay updated on announcements, and manage your scholarship records with ease.
          </p>
        </div>
      </div>

      {/* Right login form */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <form onSubmit={handleSubmit} className="w-full max-w-md">
          <h2 className="text-2xl font-extrabold text-[#1F334F] text-center mb-6">SCHOLAR LOGIN</h2>

          <p className="text-[11px] font-bold tracking-wide text-slate-500 mb-3">PERSONAL INFORMATION</p>

          <div className="grid grid-cols-[1fr_1fr_64px] gap-2 mb-4">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">First Name</label>
              <div className="flex items-center border border-[#1B3372]/30 rounded-lg px-3 py-2 gap-2">
                <User size={15} className="text-[#F3BC00] shrink-0" />
                <input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="First Name"
                  className="w-full text-sm outline-none placeholder:text-slate-300" />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">Last Name</label>
              <div className="flex items-center border border-[#1B3372]/30 rounded-lg px-3 py-2 gap-2">
                <User size={15} className="text-[#F3BC00] shrink-0" />
                <input value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Last Name"
                  className="w-full text-sm outline-none placeholder:text-slate-300" />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">M.I</label>
              <div className="flex items-center border border-[#1B3372]/30 rounded-lg px-2 py-2 gap-1">
                <User size={15} className="text-[#F3BC00] shrink-0" />
                <input value={middleInitial} onChange={e => setMiddleInitial(e.target.value.slice(0, 1))} maxLength={1}
                  className="w-full text-sm outline-none" />
              </div>
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Birthday</label>
            <div className="flex items-center border border-[#1B3372]/30 rounded-lg px-3 py-2 gap-2">
              <Calendar size={15} className="text-[#F3BC00] shrink-0" />
              <input type="date" value={birthday} onChange={e => setBirthday(e.target.value)}
                className="w-full text-sm outline-none text-slate-600" />
            </div>
          </div>

          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 border-t border-dashed border-slate-300" />
            <span className="text-[11px] font-bold text-slate-400">OR</span>
            <div className="flex-1 border-t border-dashed border-slate-300" />
          </div>

          <div className="mb-4">
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Scholar ID Number</label>
            <div className="flex items-center border border-[#1B3372]/30 rounded-lg px-3 py-2 gap-2">
              <IdCard size={15} className="text-[#F3BC00] shrink-0" />
              <input value={scholarId} onChange={e => setScholarId(e.target.value)} placeholder="20180000"
                className="w-full text-sm outline-none placeholder:text-slate-300" />
            </div>
            <p className="text-[11px] text-slate-400 italic mt-1">(If you don't know your Scholar ID, please use your name and birthday above.)</p>
          </div>

          <div className="mb-3">
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Password</label>
            <div className="flex items-center border border-[#1B3372]/30 rounded-lg px-3 py-2 gap-2">
              <Lock size={15} className="text-[#F3BC00] shrink-0" />
              <input type={showPassword ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••••" className="w-full text-sm outline-none placeholder:text-slate-300" />
              <button type="button" onClick={() => setShowPassword(s => !s)} className="text-[#1B3372]/60">
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          <label className="flex items-center gap-2 text-[13px] text-slate-600 mb-4 cursor-pointer">
            <input type="checkbox" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)} className="accent-[#1B3372]" />
            Remember Me
          </label>

          {error && <p className="text-[13px] text-red-600 mb-3">{error}</p>}

          <button type="submit" disabled={busy}
            className="w-full flex items-center justify-center gap-2 bg-[#F3BC00] hover:bg-[#e0ac00] disabled:opacity-60 text-[#1F334F] font-extrabold text-sm tracking-wide py-3 rounded-lg shadow-md transition-colors">
            {busy ? "SIGNING IN…" : "PROCEED TO LOGIN"} <LogIn size={16} />
          </button>

          <p className="text-center text-[13px] text-slate-500 mt-4">
            Don't have an access yet?{" "}
            <button type="button" onClick={onResetPassword} className="font-bold text-[#1B3372] underline underline-offset-2">
              RESET PASSWORD
            </button>
          </p>
        </form>
      </div>
    </div>
  );
}
