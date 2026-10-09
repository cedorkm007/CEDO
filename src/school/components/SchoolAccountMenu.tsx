import { useEffect, useRef, useState } from "react";
import { UserCircle2, ChevronDown, KeyRound, LifeBuoy, LogOut, Mail, Phone, MapPin, Facebook, CheckCircle2 } from "lucide-react";
import { SchoolDialog } from "./SchoolDialog";
import { changeSchoolPassword } from "../schoolApi";
import { validateNewPassword, MIN_PASSWORD_LENGTH } from "../portalLogic";
import { CEDO_CONTACT, HELP_STEPS } from "../helpContent";
import { fieldClass, focusRing } from "./portalParts";

type Dialog = "password" | "help" | null;

function ChangePasswordDialog({ onClose, returnFocusTo }: { onClose: () => void; returnFocusTo: React.RefObject<HTMLElement | null> }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const problem = validateNewPassword(current, next, confirm);
    if (problem) { setError(problem); return; }
    setBusy(true);
    const result = await changeSchoolPassword(current, next);
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setDone(true);
  }

  return (
    <SchoolDialog title="Change password" onClose={onClose} returnFocusTo={returnFocusTo}>
      {done ? (
        <div className="text-center py-3">
          <CheckCircle2 size={34} className="mx-auto text-green-700 mb-2" aria-hidden="true" />
          <p role="status" className="text-[15px] font-semibold text-[#062444] mb-4">Your password was changed. Use the new one next time you sign in.</p>
          <button onClick={onClose} className={`bg-[#062444] text-white text-[14px] font-semibold rounded-lg px-5 py-2.5 ${focusRing}`}>Done</button>
        </div>
      ) : (
        <form onSubmit={submit} noValidate>
          <div className="space-y-3.5 mb-4">
            <div>
              <label htmlFor="pw-current" className="block text-[14px] font-semibold text-[#062444] mb-1">Current password</label>
              <input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} className={`${fieldClass} w-full`} />
            </div>
            <div>
              <label htmlFor="pw-new" className="block text-[14px] font-semibold text-[#062444] mb-1">New password</label>
              <input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} aria-describedby="pw-hint" className={`${fieldClass} w-full`} />
              <p id="pw-hint" className="text-[14px] text-slate-700 mt-1">At least {MIN_PASSWORD_LENGTH} characters, and different from your current password.</p>
            </div>
            <div>
              <label htmlFor="pw-confirm" className="block text-[14px] font-semibold text-[#062444] mb-1">Confirm new password</label>
              <input id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} className={`${fieldClass} w-full`} />
            </div>
          </div>
          {error && <p role="alert" className="text-[14px] text-red-800 bg-red-50 border border-red-300 rounded-lg px-3 py-2 mb-3">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className={`px-4 py-2.5 rounded-lg border border-[#062444]/40 text-[14px] font-semibold text-[#062444] ${focusRing}`}>Cancel</button>
            <button type="submit" disabled={busy} className={`bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-60 text-white text-[14px] font-semibold rounded-lg px-5 py-2.5 ${focusRing}`}>
              {busy ? "Changing…" : "Change password"}
            </button>
          </div>
        </form>
      )}
    </SchoolDialog>
  );
}

function HelpDialog({ onClose, returnFocusTo }: { onClose: () => void; returnFocusTo: React.RefObject<HTMLElement | null> }) {
  return (
    <SchoolDialog title="Help / Contact CEDO" onClose={onClose} returnFocusTo={returnFocusTo}>
      <h3 className="text-[15px] font-bold text-[#062444] mb-2">Entering grades, step by step</h3>
      <ol className="list-decimal pl-5 space-y-2 mb-5 text-[14.5px] text-slate-800">
        {HELP_STEPS.map(step => (
          <li key={step.title}><strong className="text-[#062444]">{step.title}.</strong> {step.body}</li>
        ))}
      </ol>
      <h3 className="text-[15px] font-bold text-[#062444] mb-2">Contact CEDO</h3>
      <p className="text-[14.5px] text-slate-800 mb-2">{CEDO_CONTACT.office}</p>
      <ul className="space-y-2 text-[14.5px] text-slate-800">
        <li className="flex items-start gap-2"><Mail size={16} className="mt-0.5 shrink-0 text-[#0077b6]" aria-hidden="true" />
          <a href={`mailto:${CEDO_CONTACT.email}`} className="text-[#0077b6] underline break-all">{CEDO_CONTACT.email}</a></li>
        <li className="flex items-start gap-2"><Phone size={16} className="mt-0.5 shrink-0 text-[#0077b6]" aria-hidden="true" />
          <a href={`tel:${CEDO_CONTACT.mobileLink}`} className="text-[#0077b6] underline">{CEDO_CONTACT.mobile}</a></li>
        <li className="flex items-start gap-2"><Facebook size={16} className="mt-0.5 shrink-0 text-[#0077b6]" aria-hidden="true" /> <span>Facebook: {CEDO_CONTACT.facebook}</span></li>
        <li className="flex items-start gap-2"><MapPin size={16} className="mt-0.5 shrink-0 text-[#0077b6]" aria-hidden="true" /> <span>{CEDO_CONTACT.address}</span></li>
      </ul>
      <div className="flex justify-end mt-5">
        <button onClick={onClose} className={`bg-[#062444] text-white text-[14px] font-semibold rounded-lg px-5 py-2.5 ${focusRing}`}>Close</button>
      </div>
    </SchoolDialog>
  );
}

/**
 * The header's account menu: Change password, Help / Contact CEDO, Sign out. Opens with a click, closes with Escape
 * or a click outside, and every item is reachable with the keyboard.
 */
export function SchoolAccountMenu({ username, onSignOut }: { username: string | null; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") { setOpen(false); buttonRef.current?.focus(); } }
    function onClick(e: MouseEvent) { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onClick); };
  }, [open]);

  const item = `w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-[14.5px] text-[#062444] hover:bg-[#f7f9fc] ${focusRing}`;

  return (
    <div ref={wrapRef} className="relative">
      <button ref={buttonRef} onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open}
        className={`flex items-center gap-2 border border-[#062444]/40 rounded-lg bg-white px-3.5 py-2 text-[14.5px] font-semibold text-[#062444] hover:bg-[#f7f9fc] ${focusRing}`}>
        <UserCircle2 size={18} aria-hidden="true" /> Account <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" aria-label="Account" className="absolute right-0 mt-1.5 w-64 bg-white border border-[#e6ecf5] rounded-xl shadow-lg z-40 overflow-hidden">
          {username && <p className="px-4 py-2.5 text-[14px] text-slate-700 border-b border-[#f0f3f8]">Signed in as <strong className="text-[#062444]">{username}</strong></p>}
          <button role="menuitem" className={item} onClick={() => { setOpen(false); setDialog("password"); }}><KeyRound size={16} aria-hidden="true" /> Change password</button>
          <button role="menuitem" className={item} onClick={() => { setOpen(false); setDialog("help"); }}><LifeBuoy size={16} aria-hidden="true" /> Help / Contact CEDO</button>
          <button role="menuitem" className={`${item} border-t border-[#f0f3f8] text-red-800`} onClick={() => { setOpen(false); onSignOut(); }}><LogOut size={16} aria-hidden="true" /> Sign out</button>
        </div>
      )}
      {dialog === "password" && <ChangePasswordDialog onClose={() => setDialog(null)} returnFocusTo={buttonRef} />}
      {dialog === "help" && <HelpDialog onClose={() => setDialog(null)} returnFocusTo={buttonRef} />}
    </div>
  );
}
