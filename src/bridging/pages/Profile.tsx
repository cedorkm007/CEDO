// Profile: name, level, teacher, school (a request), password, privacy notice, delete my account (a request), sign out.
import { useEffect, useState } from "react";
import { cancelRequest, changePassword, chooseTeacher, fetchTeachers, sendRequest, updateProfile, type Me, type Options, type Result } from "../api";
import { levelLabel, levelsFor, passwordMin, passwordProblem, teacherPayload, teacherStatusLabel, type TeacherChoice } from "../logic";
import { Button, Card, ErrorText, OkText, PasswordInput, SearchPick, Select, TextInput } from "../ui";
import { NoticeText } from "./Consent";

const Title = ({ children }: { children: string }) => <h2 className="text-[16px] font-bold text-[#1e3a5f]">{children}</h2>;

/** Runs a change, shows what happened, then reads the profile again. */
function useAction(onChanged: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  async function run(action: () => Promise<Result>, done: string) {
    setBusy(true); setError(""); setOk("");
    const r = await action();
    setBusy(false);
    if (r.ok === false) { setError(r.error); return false; }
    setOk(done);
    onChanged();
    return true;
  }
  return { busy, error, ok, setError, setOk, run };
}

export function Profile({ me, options, onChanged, onSignOut }: { me: Me; options: Options; onChanged: () => void; onSignOut: () => void }) {
  const school = options.schools.find(s => s.id === me.schoolId) ?? null;
  return (
    <div className="space-y-4">
      <Card>
        <p className="text-xl font-bold text-[#1e3a5f]">{me.firstName} {me.lastName}</p>
        <p className="text-[14px] text-slate-600">@{me.username} · {me.role === "student" ? levelLabel(me.level) : "Teacher"}</p>
        <p className="text-[14px] text-slate-600">{me.schoolName}{!me.schoolListed && " (waiting to be added to the list)"}</p>
      </Card>
      <Details me={me} levels={levelsFor(school).map(l => ({ value: l.key, label: l.label }))} onChanged={onChanged} />
      {me.role === "student" && <Teacher me={me} onChanged={onChanged} />}
      <SchoolChange me={me} options={options} onChanged={onChanged} />
      <Password me={me} />
      <Card className="space-y-3">
        <Title>Privacy</Title>
        <p className="text-[14px] text-slate-700">You agreed to the current privacy notice. You can read it again here.</p>
        <NoticeText options={options} />
      </Card>
      <DeleteAccount me={me} onChanged={onChanged} />
      <Button variant="ghost" className="w-full" onClick={onSignOut}>Sign out</Button>
    </div>
  );
}

function Details({ me, levels, onChanged }: { me: Me; levels: { value: string; label: string }[]; onChanged: () => void }) {
  const [f, setF] = useState({ lastName: me.lastName, firstName: me.firstName, middleName: me.middleName, level: me.level ?? "", contactEmail: me.contactEmail ?? "" });
  const a = useAction(onChanged);
  const set = (patch: Partial<typeof f>) => { setF(prev => ({ ...prev, ...patch })); a.setError(""); a.setOk(""); };
  return (
    <Card className="space-y-3">
      <Title>Your details</Title>
      <TextInput label="Last name" value={f.lastName} onChange={v => set({ lastName: v })} maxLength={60} />
      <TextInput label="First name" value={f.firstName} onChange={v => set({ firstName: v })} maxLength={60} />
      <TextInput label="Middle name" value={f.middleName} onChange={v => set({ middleName: v })} maxLength={60} />
      {me.role === "student" && <Select label="Grade or year level" value={f.level} onChange={v => set({ level: v })} options={levels} placeholder="Choose your level" />}
      <TextInput label="Email (optional)" type="email" value={f.contactEmail} onChange={v => set({ contactEmail: v })} maxLength={160} />
      <ErrorText>{a.error}</ErrorText><OkText>{a.ok}</OkText>
      <Button className="w-full" disabled={a.busy} onClick={() => void a.run(() => updateProfile(f), "Saved.")}>Save changes</Button>
    </Card>
  );
}

function Teacher({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const [changing, setChanging] = useState(false);
  const [choice, setChoice] = useState<TeacherChoice>({ kind: "none" });
  const [teachers, setTeachers] = useState<{ id: string; name: string }[]>([]);
  const a = useAction(onChanged);
  useEffect(() => {
    if (changing && me.schoolId && me.level) void fetchTeachers(me.schoolId, me.level).then(setTeachers);
  }, [changing, me.schoolId, me.level]);

  async function save() {
    if (choice.kind === "teacher" && !choice.id) { a.setError("Choose a teacher."); return; }
    if (choice.kind === "no_account" && !choice.name.trim()) { a.setError("Type your teacher's name."); return; }
    if (await a.run(() => chooseTeacher(teacherPayload(choice)), "Saved.")) setChanging(false);
  }

  return (
    <Card className="space-y-3">
      <Title>Your teacher</Title>
      {me.teacher
        ? <p className="text-[14.5px] text-slate-800"><span className="font-bold">{me.teacher.name}</span><br /><span className="text-slate-600">{teacherStatusLabel(me.teacher.status)}</span></p>
        : <p className="text-[14.5px] text-slate-600">No teacher chosen.</p>}
      {changing ? (
        <>
          <div className="flex flex-col gap-1.5">
            {([["teacher", "Choose my teacher"], ["no_account", "My teacher has no account yet"], ["none", "I don't have a teacher"]] as const).map(([kind, label]) => (
              <label key={kind} className="flex cursor-pointer items-center gap-2.5 text-[14px] text-slate-800">
                <input type="radio" name="change-teacher" className="h-4 w-4 accent-[#1e3a5f]" checked={choice.kind === kind}
                  onChange={() => { a.setError(""); setChoice(kind === "teacher" ? { kind, id: "", name: "" } : kind === "no_account" ? { kind, name: "" } : { kind }); }} />
                {label}
              </label>
            ))}
          </div>
          {choice.kind === "teacher" && <SearchPick label="Teacher" placeholder="Type to search" empty="No teacher with an account yet." items={teachers} value={choice.id}
            onChange={id => setChoice({ kind: "teacher", id, name: teachers.find(t => t.id === id)?.name ?? "" })} />}
          {choice.kind === "no_account" && <TextInput label="Teacher's name" value={choice.name} onChange={v => setChoice({ kind: "no_account", name: v })} maxLength={120} />}
          <div className="flex gap-2"><Button variant="ghost" onClick={() => setChanging(false)}>Cancel</Button><Button disabled={a.busy} onClick={() => void save()}>Save teacher</Button></div>
        </>
      ) : <Button variant="ghost" onClick={() => { a.setOk(""); setChanging(true); }}>Change teacher</Button>}
      <ErrorText>{a.error}</ErrorText><OkText>{a.ok}</OkText>
    </Card>
  );
}

function SchoolChange({ me, options, onChanged }: { me: Me; options: Options; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [schoolId, setSchoolId] = useState("");
  const [other, setOther] = useState("");
  const a = useAction(onChanged);
  const waiting = me.openRequests.includes("school_change");
  async function send() {
    if (!schoolId && other.trim().length < 2) { a.setError("Choose a school, or type its name."); return; }
    if (await a.run(() => sendRequest("school_change", schoolId ? { schoolId } : { otherSchool: other.trim() }), "Request sent.")) setOpen(false);
  }
  return (
    <Card className="space-y-3">
      <Title>Change school</Title>
      {waiting ? (
        <>
          <p className="text-[14px] text-slate-700">Your school change is waiting for CEDO.</p>
          <Button variant="ghost" disabled={a.busy} onClick={() => void a.run(() => cancelRequest("school_change"), "Request cancelled.")}>Cancel the request</Button>
        </>
      ) : open ? (
        <>
          <SearchPick label="New school" placeholder="Type to search" empty="Not listed? Type its name below." items={options.schools.filter(s => s.id !== me.schoolId)} value={schoolId} onChange={setSchoolId} />
          {!schoolId && <TextInput label="Or type the school's name" value={other} onChange={setOther} maxLength={160} />}
          <div className="flex gap-2"><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={a.busy} onClick={() => void send()}>Send request</Button></div>
        </>
      ) : (
        <>
          <p className="text-[14px] text-slate-700">A change of school is confirmed by CEDO.</p>
          <Button variant="ghost" onClick={() => { a.setOk(""); setOpen(true); }}>Ask to change school</Button>
        </>
      )}
      <ErrorText>{a.error}</ErrorText><OkText>{a.ok}</OkText>
    </Card>
  );
}

function Password({ me }: { me: Me }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const a = useAction(() => {});
  async function save() {
    const problem = passwordProblem(password, me.role, me.username) || (password !== confirm ? "The two passwords are not the same." : "");
    if (problem) { a.setError(problem); return; }
    if (await a.run(() => changePassword(password), "Password changed.")) { setPassword(""); setConfirm(""); }
  }
  return (
    <Card className="space-y-3">
      <Title>Change password</Title>
      <PasswordInput label="New password" hint={`At least ${passwordMin(me.role)} characters.`} value={password} onChange={v => { setPassword(v); a.setError(""); a.setOk(""); }} autoComplete="new-password" />
      <PasswordInput label="Type it again" value={confirm} onChange={v => { setConfirm(v); a.setError(""); }} autoComplete="new-password" />
      <ErrorText>{a.error}</ErrorText><OkText>{a.ok}</OkText>
      <Button variant="ghost" className="w-full" disabled={a.busy} onClick={() => void save()}>Change password</Button>
    </Card>
  );
}

function DeleteAccount({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const a = useAction(onChanged);
  const waiting = me.openRequests.includes("delete_account");
  return (
    <Card className="space-y-3">
      <Title>Delete my account</Title>
      {waiting ? (
        <>
          <p className="text-[14px] text-slate-700">Your request to delete your account is waiting for CEDO.</p>
          <Button variant="ghost" disabled={a.busy} onClick={() => void a.run(() => cancelRequest("delete_account"), "Request cancelled.")}>Keep my account</Button>
        </>
      ) : open ? (
        <>
          <TextInput label="Reason (optional)" value={reason} onChange={setReason} maxLength={500} />
          <p className="text-[13.5px] text-slate-700">CEDO will remove your account. Until then you can still use it and cancel the request.</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="danger" disabled={a.busy} onClick={() => void a.run(() => sendRequest("delete_account", { reason }), "Request sent.").then(done => done && setOpen(false))}>Ask to delete my account</Button>
          </div>
        </>
      ) : <Button variant="danger" onClick={() => { a.setOk(""); setOpen(true); }}>Delete my account…</Button>}
      <ErrorText>{a.error}</ErrorText><OkText>{a.ok}</OkText>
    </Card>
  );
}
