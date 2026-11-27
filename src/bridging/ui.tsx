// Small building blocks shared by the Bridging screens, in the prototype's navy and gold.
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { ArrowLeft, Eye, EyeOff, Search } from "lucide-react";
import logo from "./assets/logo.jpg";

export function Logo({ className = "h-24 w-24" }: { className?: string }) {
  return <img src={logo} alt="City Education and Development Office" className={`${className} rounded-2xl object-cover shadow-lg`} />;
}

export function Button({ variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "gold" | "ghost" | "danger" }) {
  const look = {
    primary: "bg-[#1e3a5f] text-white hover:bg-[#2a5080]",
    gold: "bg-[#f4c430] text-[#1e3a5f] hover:bg-[#e5b520]",
    ghost: "border border-[#1e3a5f]/25 bg-white text-[#1e3a5f] hover:bg-slate-50",
    danger: "border border-red-300 bg-white text-red-700 hover:bg-red-50",
  }[variant];
  return <button type="button" {...props} className={`min-h-11 rounded-xl px-4 py-2.5 text-[15px] font-bold transition disabled:cursor-not-allowed disabled:opacity-60 ${look} ${className}`} />;
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-[13px] font-bold text-[#1e3a5f]">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[12.5px] text-slate-500">{hint}</p>}
    </div>
  );
}

const INPUT = "w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-[16px] text-slate-900 outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#f4c430]/60";

export function TextInput({ label, hint, value, onChange, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> & { label: string; hint?: string; value: string; onChange: (v: string) => void }) {
  const id = useId();
  return <Field label={label} hint={hint} htmlFor={id}><input id={id} {...rest} value={value} onChange={e => onChange(e.target.value)} className={INPUT} /></Field>;
}

export function PasswordInput({ label, hint, value, onChange, autoComplete }: { label: string; hint?: string; value: string; onChange: (v: string) => void; autoComplete: string }) {
  const id = useId();
  const [shown, setShown] = useState(false);
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <div className="relative">
        <input id={id} type={shown ? "text" : "password"} value={value} onChange={e => onChange(e.target.value)} autoComplete={autoComplete} className={`${INPUT} pr-12`} />
        <button type="button" onClick={() => setShown(s => !s)} aria-label={shown ? "Hide password" : "Show password"} className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-slate-500">
          {shown ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
    </Field>
  );
}

export function Select({ label, hint, value, onChange, options, placeholder }: { label: string; hint?: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder: string }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <select id={id} value={value} onChange={e => onChange(e.target.value)} className={INPUT}>
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}

/** Type to search a long list, then tap one. Shows at most 30 matches. */
export function SearchPick({ label, items, value, onChange, placeholder, empty }: {
  label: string; items: { id: string; name: string }[]; value: string; onChange: (id: string) => void; placeholder: string; empty: string;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const chosen = items.find(i => i.id === value) ?? null;
  const matches = items.filter(i => i.name.toLowerCase().includes(text.trim().toLowerCase()));
  if (chosen) {
    return (
      <Field label={label}>
        <div className="flex items-center justify-between gap-2 rounded-xl border-2 border-[#f4c430] bg-amber-50 px-3.5 py-2.5">
          <span className="min-w-0 text-[15px] font-semibold text-[#1e3a5f]">{chosen.name}</span>
          <button type="button" onClick={() => { onChange(""); setText(""); }} className="shrink-0 text-[13px] font-bold text-[#1e3a5f] underline">Change</button>
        </div>
      </Field>
    );
  }
  return (
    <Field label={label} htmlFor={id}>
      <div className="relative">
        <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input id={id} value={text} onChange={e => setText(e.target.value)} placeholder={placeholder} autoComplete="off" className={`${INPUT} pl-9`} />
      </div>
      <ul className="mt-1 max-h-44 overflow-y-auto rounded-xl border border-slate-200 bg-white">
        {matches.length === 0 ? <li className="px-3.5 py-2.5 text-[13.5px] text-slate-500">{empty}</li>
          : matches.slice(0, 30).map(i => (
            <li key={i.id}><button type="button" onClick={() => onChange(i.id)} className="block w-full px-3.5 py-2.5 text-left text-[14.5px] text-[#1e3a5f] hover:bg-amber-50">{i.name}</button></li>
          ))}
        {matches.length > 30 && <li className="px-3.5 py-2 text-[12.5px] text-slate-500">Type more to narrow the list.</li>}
      </ul>
    </Field>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-white p-5 shadow-lg ${className}`}>{children}</div>;
}
export function ErrorText({ children }: { children: ReactNode }) {
  return children ? <p role="alert" className="rounded-xl bg-red-50 px-3.5 py-2.5 text-[14px] font-semibold text-red-700">{children}</p> : null;
}
export function OkText({ children }: { children: ReactNode }) {
  return children ? <p role="status" className="rounded-xl bg-green-50 px-3.5 py-2.5 text-[14px] font-semibold text-green-800">{children}</p> : null;
}

/** The navy full-screen frame used before signing in. */
export function AuthShell({ title, onBack, children }: { title?: string; onBack?: () => void; children: ReactNode }) {
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => { top.current?.scrollIntoView(); }, [title]);
  return (
    <div ref={top} className="min-h-dvh bg-gradient-to-br from-[#1e3a5f] to-[#2a5080] px-4 py-6">
      <div className="mx-auto flex w-full max-w-md flex-col gap-4">
        {onBack && (
          <button type="button" onClick={onBack} className="flex items-center gap-1.5 self-start text-[14px] font-bold text-white/80 hover:text-white"><ArrowLeft size={16} /> Back</button>
        )}
        <div className="flex flex-col items-center gap-2 text-center">
          <Logo className={title ? "h-16 w-16" : "h-28 w-28"} />
          <p className="text-[13px] font-bold uppercase tracking-wide text-[#f4c430]">Kagay-anon Bridging Application</p>
          <p className="text-[12.5px] text-white/70">A learning application for CdeO students</p>
          {title && <h1 className="text-2xl font-bold text-white">{title}</h1>}
        </div>
        {children}
      </div>
    </div>
  );
}

/** "I am human" check (Cloudflare Turnstile), only when a site key is set. */
const SITE_KEY = (import.meta.env.VITE_BRIDGING_TURNSTILE_SITE_KEY as string | undefined) ?? "";
export const captchaOn = SITE_KEY !== "";
export function Captcha({ onToken, round }: { onToken: (t: string) => void; round: number }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!SITE_KEY) return;
    let widget: string | undefined;
    type Turnstile = { render: (el: HTMLElement, o: Record<string, unknown>) => string; remove: (id: string) => void };
    const turnstile = () => (window as unknown as { turnstile?: Turnstile }).turnstile;
    const render = () => {
      const t = turnstile();
      if (box.current && t && widget === undefined) widget = t.render(box.current, { sitekey: SITE_KEY, callback: onToken, "expired-callback": () => onToken("") });
    };
    if (turnstile()) render();
    else {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true; s.onload = render;
      document.head.appendChild(s);
    }
    return () => { if (widget !== undefined) turnstile()?.remove(widget); };
  }, [round]); // eslint-disable-line react-hooks/exhaustive-deps
  return SITE_KEY ? <div ref={box} /> : null;
}
