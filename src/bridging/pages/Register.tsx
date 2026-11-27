// Registration: 1 choose a role, 2 agree to the privacy notice, 3 the form.
import { useEffect, useState } from "react";
import { GraduationCap, Presentation } from "lucide-react";
import { fetchTeachers, register, type Options } from "../api";
import {
  consentProblem, emptyConsent, emptyForm, levelsFor, passwordMin, registerPayload, registerProblem, LEVELS, type ConsentState, type RegisterForm, type Role,
} from "../logic";
import { AuthShell, Button, Captcha, captchaOn, Card, ErrorText, PasswordInput, SearchPick, Select, TextInput } from "../ui";
import { ConsentForm } from "./Consent";

export function Register({ options, onBack, onDone }: { options: Options; onBack: () => void; onDone: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [role, setRole] = useState<Role>("student");
  const [consent, setConsent] = useState<ConsentState>(emptyConsent);
  const [f, setF] = useState<RegisterForm>(emptyForm);
  const [teachers, setTeachers] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [duplicate, setDuplicate] = useState(false);
  const [captcha, setCaptcha] = useState("");
  const [round, setRound] = useState(0);
  const set = (patch: Partial<RegisterForm>) => { setF(prev => ({ ...prev, ...patch })); setError(""); setDuplicate(false); };

  const school = f.notListed ? null : options.schools.find(s => s.id === f.schoolId) ?? null;
  const levels = levelsFor(school);
  const teacherSchool = role === "student" && school && f.level ? school.id : "";

  useEffect(() => {
    let cancelled = false;
    setTeachers([]);
    if (teacherSchool) void fetchTeachers(teacherSchool, f.level).then(list => { if (!cancelled) setTeachers(list); });
    return () => { cancelled = true; };
  }, [teacherSchool, f.level]);

  async function submit(confirmDuplicate: boolean) {
    const problem = registerProblem(f, role) || (captchaOn && !captcha ? "Please complete the \"I am human\" check." : "");
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError("");
    const r = await register(f.username, f.password, registerPayload(f, role, consent, options.notice.version, confirmDuplicate), captcha);
    setBusy(false);
    // a human check can be used once: ask for a new one before the next try
    if (captchaOn) { setCaptcha(""); setRound(n => n + 1); }
    if (r.ok === false) { setError(r.error); return; }
    if (r.duplicate) { setDuplicate(true); return; }
    onDone();
  }

  if (step === 1) {
    return (
      <AuthShell title="Create your account" onBack={onBack}>
        {([
          ["student", "I am a Student", "Answer quests and tests and see your progress.", GraduationCap],
          ["teacher", "I am a Teacher", "Follow your students' progress. An administrator approves teacher accounts first.", Presentation],
        ] as const).map(([key, label, text, Icon]) => (
          <button key={key} type="button" onClick={() => { setRole(key); setConsent(emptyConsent); setError(""); setStep(2); }}
            className="flex items-center gap-4 rounded-2xl bg-white p-5 text-left shadow-lg transition hover:ring-4 hover:ring-[#f4c430]">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#f4c430] text-[#1e3a5f]"><Icon size={28} /></span>
            <span><span className="block text-lg font-bold text-[#1e3a5f]">{label}</span><span className="block text-[13.5px] text-slate-600">{text}</span></span>
          </button>
        ))}
      </AuthShell>
    );
  }

  if (step === 2) {
    return (
      <AuthShell title="Data privacy" onBack={() => setStep(1)}>
        <Card className="space-y-4">
          <ConsentForm options={options} role={role} value={consent} onChange={v => { setConsent(v); setError(""); }} />
          <ErrorText>{error}</ErrorText>
          <Button className="w-full" onClick={() => {
            const problem = consentProblem(consent, role, options.settings.under18Mode);
            if (problem) setError(problem); else { setError(""); setStep(3); }
          }}>Continue</Button>
        </Card>
      </AuthShell>
    );
  }

  const toggle = (list: string[], key: string) => (list.includes(key) ? list.filter(k => k !== key) : [...list, key]);
  const chip = (on: boolean) => `min-h-10 rounded-xl border-2 px-3 text-[13.5px] font-bold ${on ? "border-[#f4c430] bg-amber-50 text-[#1e3a5f]" : "border-slate-200 text-slate-600"}`;

  return (
    <AuthShell title={role === "student" ? "Student registration" : "Teacher registration"} onBack={() => setStep(2)}>
      <Card>
        <form className="space-y-4" onSubmit={e => { e.preventDefault(); void submit(false); }} noValidate>
          <TextInput label="Last name" value={f.lastName} onChange={v => set({ lastName: v })} autoComplete="family-name" maxLength={60} />
          <TextInput label="First name" value={f.firstName} onChange={v => set({ firstName: v })} autoComplete="given-name" maxLength={60} />
          <TextInput label="Middle name" hint="Type N/A if you have none." value={f.middleName} onChange={v => set({ middleName: v })} autoComplete="additional-name" maxLength={60} />

          {f.notListed ? (
            <TextInput label="Name of your school" hint="CEDO will be asked to add it." value={f.otherSchool} onChange={v => set({ otherSchool: v })} maxLength={160} />
          ) : (
            <SearchPick label="School" placeholder="Type to search your school" empty="No school found. Use the button below."
              items={options.schools} value={f.schoolId} onChange={id => set({ schoolId: id, level: "", levels: [], teacher: { kind: "none" } })} />
          )}
          <button type="button" className="text-[13.5px] font-bold text-[#1e3a5f] underline"
            onClick={() => set({ notListed: !f.notListed, schoolId: "", level: "", levels: [], teacher: { kind: "none" } })}>
            {f.notListed ? "Choose from the list instead" : "My school is not listed"}
          </button>

          {role === "student" ? (
            <>
              <Select label="Grade or year level" placeholder={school || f.notListed ? "Choose your level" : "Choose your school first"} value={f.level}
                onChange={v => set({ level: v, teacher: { kind: "none" } })} options={(school || f.notListed ? levels : []).map(l => ({ value: l.key, label: l.label }))} />
              <fieldset className="space-y-2">
                <legend className="mb-1 text-[13px] font-bold text-[#1e3a5f]">Your teacher (optional)</legend>
                <div className="flex flex-col gap-1.5">
                  {([["teacher", "Choose my teacher"], ["no_account", "My teacher has no account yet"], ["none", "I don't have a teacher"]] as const).map(([kind, label]) => (
                    <label key={kind} className="flex cursor-pointer items-center gap-2.5 text-[14px] text-slate-800">
                      <input type="radio" name="teacher" className="h-4 w-4 accent-[#1e3a5f]" checked={f.teacher.kind === kind}
                        onChange={() => set({ teacher: kind === "teacher" ? { kind, id: "", name: "" } : kind === "no_account" ? { kind, name: "" } : { kind } })} />
                      {label}
                    </label>
                  ))}
                </div>
                {f.teacher.kind === "teacher" && (teacherSchool
                  ? <SearchPick label="Teacher" placeholder="Type to search" empty="No teacher with an account yet. Choose the option above." items={teachers} value={f.teacher.id}
                      onChange={id => set({ teacher: { kind: "teacher", id, name: teachers.find(t => t.id === id)?.name ?? "" } })} />
                  : <p className="text-[13px] text-slate-600">Choose a listed school and your level first.</p>)}
                {f.teacher.kind === "teacher" && f.teacher.id && <p className="text-[12.5px] text-slate-600">Your teacher will be asked to confirm.</p>}
                {f.teacher.kind === "no_account" && <TextInput label="Teacher's name" value={f.teacher.name} onChange={v => set({ teacher: { kind: "no_account", name: v } })} maxLength={120} />}
              </fieldset>
            </>
          ) : (
            <>
              <fieldset>
                <legend className="mb-1.5 text-[13px] font-bold text-[#1e3a5f]">Levels you handle</legend>
                <div className="flex flex-wrap gap-1.5">
                  {(school || f.notListed ? levels : LEVELS).map(l => <button key={l.key} type="button" aria-pressed={f.levels.includes(l.key)} onClick={() => set({ levels: toggle(f.levels, l.key) })} className={chip(f.levels.includes(l.key))}>{l.label}</button>)}
                </div>
              </fieldset>
              <fieldset>
                <legend className="mb-1.5 text-[13px] font-bold text-[#1e3a5f]">Subjects you handle</legend>
                <div className="flex flex-wrap gap-1.5">
                  {options.subjects.map(s => <button key={s.key} type="button" aria-pressed={f.subjects.includes(s.key)} onClick={() => set({ subjects: toggle(f.subjects, s.key) })} className={chip(f.subjects.includes(s.key))}>{s.name}</button>)}
                </div>
              </fieldset>
              <TextInput label="Employee ID" hint="Give your employee ID, your work email, or both." value={f.employeeId} onChange={v => set({ employeeId: v })} maxLength={60} />
              <TextInput label="Work email" type="email" value={f.workEmail} onChange={v => set({ workEmail: v })} autoComplete="email" maxLength={160} />
            </>
          )}

          <TextInput label="Your email (optional)" type="email" value={f.contactEmail} onChange={v => set({ contactEmail: v })} autoComplete="email" maxLength={160} />

          <div className="space-y-4 border-t border-slate-200 pt-4">
            <TextInput label="Username" hint="You will use this to sign in." value={f.username} onChange={v => set({ username: v })} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={30} />
            <PasswordInput label="Password" hint={`At least ${passwordMin(role)} characters.`} value={f.password} onChange={v => set({ password: v })} autoComplete="new-password" />
            <PasswordInput label="Type the password again" value={f.confirm} onChange={v => set({ confirm: v })} autoComplete="new-password" />
            <Captcha onToken={setCaptcha} round={round} />
          </div>

          <ErrorText>{error}</ErrorText>
          {duplicate ? (
            <div role="alert" className="space-y-3 rounded-xl bg-amber-50 p-3.5">
              <p className="text-[14px] font-semibold text-amber-900">An account with these details may already exist. If you registered before, sign in instead.</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" onClick={onBack}>Go to sign in</Button>
                <Button onClick={() => void submit(true)} disabled={busy}>This is a different person — register</Button>
              </div>
            </div>
          ) : (
            <Button type="submit" variant="gold" className="w-full" disabled={busy}>{busy ? "Creating your account…" : "Register"}</Button>
          )}
        </form>
      </Card>
    </AuthShell>
  );
}
