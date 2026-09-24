import { useState } from "react";
import { motion } from "motion/react";
import { Building2, Lock, Eye, EyeOff, LogIn } from "lucide-react";
import { schoolSignIn } from "../schoolApi";
import CEDOSeal from "@/imports/CEDO_Seal.png";

interface SchoolLoginPageProps {
  onLoginSuccess: () => void;
}

/** Same visual benchmark as the Scholar Portal's login page — a single login path (school name + password), no alternate identification mode needed. */
export function SchoolLoginPage({ onLoginSuccess }: SchoolLoginPageProps) {
  const [schoolName, setSchoolName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!schoolName.trim() || !password) {
      setError("Enter your school name and password.");
      return;
    }
    setBusy(true);
    const result = await schoolSignIn(schoolName.trim(), password);
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    onLoginSuccess();
  }

  const inputWrapCls = "flex items-center border-2 border-slate-200 rounded-xl px-3 py-2.5 gap-2 focus-within:border-[#F3BC00] transition-colors bg-white";

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
          <p className="text-slate-400 text-xs mt-1 text-center">City Education and Development Office</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">School Name</label>
            <div className={inputWrapCls}>
              <Building2 size={15} className="text-[#F3BC00] shrink-0" />
              <input value={schoolName} onChange={e => setSchoolName(e.target.value)} placeholder="e.g. Capitol University"
                className="w-full text-sm outline-none placeholder:text-slate-300" />
            </div>
          </div>

          <div className="mb-5">
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

          {error && <p className="text-[13px] text-red-500 bg-red-50 px-3 py-2 rounded-lg mb-4">{error}</p>}

          <motion.button
            type="submit"
            disabled={busy}
            whileHover={!busy ? { scale: 1.02 } : {}}
            whileTap={!busy ? { scale: 0.98 } : {}}
            className="w-full flex items-center justify-center gap-2 bg-[#F3BC00] hover:bg-[#e0ac00] disabled:opacity-60 text-[#1B3372] font-extrabold text-sm tracking-wide py-3.5 rounded-xl shadow-lg transition-colors"
          >
            {busy ? "SIGNING IN…" : "SIGN IN"} <LogIn size={16} />
          </motion.button>

          <p className="text-center text-[12px] text-slate-400 mt-5">
            Accounts are created by CEDO staff. Contact your CEDO coordinator if you need access.
          </p>
        </form>
      </motion.div>
    </div>
  );
}
