// The privacy notice and the agreement: shown during registration, again when the notice changes, and (to read) from the profile.
import { useState } from "react";
import { fillNotice, type ConsentState, type Role } from "../logic";
import type { Options } from "../api";
import { TextInput } from "../ui";

export function NoticeText({ options }: { options: Options }) {
  const [lang, setLang] = useState<"en" | "ceb">("en");
  return (
    <div>
      <div className="mb-2 flex gap-1" role="group" aria-label="Language">
        {(["en", "ceb"] as const).map(l => (
          <button key={l} type="button" onClick={() => setLang(l)} aria-pressed={lang === l}
            className={`rounded-lg px-3 py-1.5 text-[13px] font-bold ${lang === l ? "bg-[#1e3a5f] text-white" : "bg-slate-100 text-slate-600"}`}>
            {l === "en" ? "English" : "Bisaya"}
          </button>
        ))}
      </div>
      <div lang={lang} className="max-h-60 overflow-y-auto whitespace-pre-line rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-[14px] leading-relaxed text-slate-800">
        {fillNotice(options.notice[lang], options.settings, lang)}
      </div>
    </div>
  );
}

export function ConsentForm({ options, role, value, onChange }: { options: Options; role: Role; value: ConsentState; onChange: (v: ConsentState) => void }) {
  const set = (patch: Partial<ConsentState>) => onChange({ ...value, ...patch });
  const guardian = options.settings.under18Mode === "guardian";
  return (
    <div className="space-y-4">
      <NoticeText options={options} />
      {role === "student" && (
        <fieldset>
          <legend className="mb-1 text-[13px] font-bold text-[#1e3a5f]">Are you under 18 years old?</legend>
          <div className="flex gap-2">
            {([["Yes", true], ["No", false]] as const).map(([label, v]) => (
              <label key={label} className={`flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border-2 text-[15px] font-bold ${value.under18 === v ? "border-[#f4c430] bg-amber-50 text-[#1e3a5f]" : "border-slate-200 text-slate-600"}`}>
                <input type="radio" name="under18" checked={value.under18 === v} onChange={() => set({ under18: v })} className="accent-[#1e3a5f]" /> {label}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {role === "student" && value.under18 && (
        guardian ? (
          <div className="space-y-3 rounded-xl bg-amber-50 p-3.5">
            <TextInput label="Parent or guardian's full name" value={value.guardianName} onChange={v => set({ guardianName: v })} autoComplete="off" />
            <label className="flex cursor-pointer items-start gap-2.5 text-[14px] text-slate-800">
              <input type="checkbox" checked={value.guardianAgreed} onChange={e => set({ guardianAgreed: e.target.checked })} className="mt-0.5 h-5 w-5 shrink-0 accent-[#1e3a5f]" />
              <span>I am this student's parent or guardian. I have read the notice and I allow the collection and use of my child's data for this application.</span>
            </label>
          </div>
        ) : <p className="rounded-xl bg-amber-50 p-3.5 text-[14px] text-slate-800">Please read this notice with your parent or guardian before you continue.</p>
      )}
      <label className="flex cursor-pointer items-start gap-2.5 text-[14px] font-semibold text-slate-800">
        <input type="checkbox" checked={value.agreed} onChange={e => set({ agreed: e.target.checked })} className="mt-0.5 h-5 w-5 shrink-0 accent-[#1e3a5f]" />
        <span>I have read and agree to the collection and use of my data for the Kagay-anon Bridging Application, in accordance with the Data Privacy Act of 2012 (RA 10173).</span>
      </label>
    </div>
  );
}
