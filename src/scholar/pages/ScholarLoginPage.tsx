import { useState } from "react";
import { motion } from "motion/react";
import { User, Calendar, IdCard, Lock, Eye, EyeOff, LogIn } from "lucide-react";
import { scholarSignIn } from "../scholarApi";
import CEDOSeal from "@/imports/CEDO_Seal.png";

interface ScholarLoginPageProps {
  onLoginSuccess: () => void;
  onResetPassword: () => void;
}

/**
 * Visual style benchmarked against the reference mobile app's sign-in page
 * (centered white rounded-3xl card, circular seal, navy/gold palette,
 * subtle motion on load and button taps) — the actual fields stay what
 * this app's backend requires: identify by (First/Last/M.I. + Birthday) OR
 * Scholar ID Number, plus a password.
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

  const inputWrapCls = "flex items-center border-2 border-slate-200 rounded-xl px-3 py-2.5 gap-2 focus-within:border-[#F3BC00] transition-colors bg-white";

  return (
    <div className="min-h-[calc(100vh-64px)] bg-gradient-to-br from-[#1B3372] to-[#0d1a3d] flex items-center justify-center px-4 py-10">
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4 }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8"
      >
        <div className="flex flex-col items-center mb-7">
          <img src={CEDOSeal} alt="CEDO" className="w-24 h-24 rounded-full object-cover border-4 border-[#F3BC00] shadow-lg mb-3" />
          <h1 className="text-xl font-extrabold text-[#1B3372] text-center">Scholar Portal Login</h1>
          <p className="text-slate-400 text-xs mt-1 text-center">City Education and Development Office</p>
        </div>

        <form onSubmit={handleSubmit}>
          <p className="text-[11px] font-bold tracking-wide text-slate-500 mb-3 uppercase">Personal Information</p>

          <div className="grid grid-cols-[1fr_1fr_60px] gap-2 mb-4">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">First Name</label>
              <div className={inputWrapCls}>
                <User size={15} className="text-[#F3BC00] shrink-0" />
                <input value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="First Name"
                  className="w-full text-sm outline-none placeholder:text-slate-300" />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">Last Name</label>
              <div className={inputWrapCls}>
                <User size={15} className="text-[#F3BC00] shrink-0" />
                <input value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Last Name"
                  className="w-full text-sm outline-none placeholder:text-slate-300" />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">M.I</label>
              <div className={`${inputWrapCls} px-2`}>
                <input value={middleInitial} onChange={e => setMiddleInitial(e.target.value.slice(0, 1))} maxLength={1}
                  className="w-full text-sm outline-none" />
              </div>
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Birthday</label>
            <div className={inputWrapCls}>
              <Calendar size={15} className="text-[#F3BC00] shrink-0" />
              <input type="date" value={birthday} onChange={e => setBirthday(e.target.value)}
                className="w-full text-sm outline-none text-slate-600" />
            </div>
          </div>

          <div className="relative py-1 mb-4">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-dashed border-slate-200" /></div>
            <div className="relative flex justify-center"><span className="bg-white px-3 text-[11px] font-bold text-slate-400">OR</span></div>
          </div>

          <div className="mb-4">
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Scholar ID Number</label>
            <div className={inputWrapCls}>
              <IdCard size={15} className="text-[#F3BC00] shrink-0" />
              <input value={scholarId} onChange={e => setScholarId(e.target.value)} placeholder="20180000"
                className="w-full text-sm outline-none placeholder:text-slate-300" />
            </div>
            <p className="text-[11px] text-slate-400 italic mt-1">(If you don't know your Scholar ID, please use your name and birthday above.)</p>
          </div>

          <div className="mb-3">
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Password</label>
            <div className={inputWrapCls}>
              <Lock size={15} className="text-[#F3BC00] shrink-0" />
              <input type={showPassword ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••••" className="w-full text-sm outline-none placeholder:text-slate-300" />
              <button type="button" onClick={() => setShowPassword(s => !s)} className="text-slate-400 hover:text-[#1B3372]">
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          <label className="flex items-center gap-2 text-[13px] text-slate-600 mb-5 cursor-pointer">
            <input type="checkbox" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)} className="w-4 h-4 accent-[#F3BC00]" />
            Remember Me
          </label>

          {error && <p className="text-[13px] text-red-500 bg-red-50 px-3 py-2 rounded-lg mb-4">{error}</p>}

          <motion.button
            type="submit"
            disabled={busy}
            whileHover={!busy ? { scale: 1.02 } : {}}
            whileTap={!busy ? { scale: 0.98 } : {}}
            className="w-full flex items-center justify-center gap-2 bg-[#F3BC00] hover:bg-[#e0ac00] disabled:opacity-60 text-[#1B3372] font-extrabold text-sm tracking-wide py-3.5 rounded-xl shadow-lg transition-colors"
          >
            {busy ? "SIGNING IN…" : "PROCEED TO LOGIN"} <LogIn size={16} />
          </motion.button>

          <p className="text-center text-[13px] text-slate-500 mt-4">
            Don't have an access yet?{" "}
            <button type="button" onClick={onResetPassword} className="font-bold text-[#1B3372] underline underline-offset-2">
              RESET PASSWORD
            </button>
          </p>
        </form>
      </motion.div>
    </div>
  );
}
