// Root of the Kagay-anon Bridging Application (/bridging). A separate app with its own database: see src/bridging/api.ts.
import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Navigate, NavLink, Route, Routes, useNavigate } from "react-router";
import { BookOpen, ClipboardList, Home as HomeIcon, User } from "lucide-react";
import { acceptNotice, configured, db, fetchMe, fetchOptions, signOut, type Me, type Options } from "./api";
import { consentPayload, consentProblem, emptyConsent } from "./logic";
import { AuthShell, Button, Card, ErrorText, Logo } from "./ui";
import { SignIn } from "./pages/SignIn";
import { Register } from "./pages/Register";
import { Profile } from "./pages/Profile";
import { ConsentForm } from "./pages/Consent";
import { Home, Materials, Quest, TeacherHome, Tests } from "./pages/Screens";

export function BridgingApp() {
  return <BrowserRouter basename="/bridging"><Root /></BrowserRouter>;
}

const Waiting = ({ text }: { text: string }) => <AuthShell><p className="text-center text-[15px] text-white/80">{text}</p></AuthShell>;

type State = { kind: "loading" } | { kind: "failed" } | { kind: "signedOut" } | { kind: "signedIn"; me: Me | null };

function Root() {
  const [options, setOptions] = useState<Options | null>(null);
  const [state, setState] = useState<State>({ kind: "loading" });
  const navigate = useNavigate();

  const load = useCallback(async () => {
    const [opts, { data }] = await Promise.all([fetchOptions(), db.auth.getSession()]);
    if (!opts) { setState({ kind: "failed" }); return; }
    setOptions(opts);
    if (!data.session) { setState({ kind: "signedOut" }); return; }
    const me = await fetchMe();
    setState(me === undefined ? { kind: "failed" } : { kind: "signedIn", me });
  }, []);

  // Only sign-OUT is followed automatically. The sign-in and registration screens call load() themselves when they are finished.
  useEffect(() => {
    if (!configured) return;
    void load();
    const { data } = db.auth.onAuthStateChange(event => { if (event === "SIGNED_OUT") setState({ kind: "signedOut" }); });
    return () => data.subscription.unsubscribe();
  }, [load]);

  const leave = useCallback(async () => { await signOut(); navigate("/", { replace: true }); }, [navigate]);
  const arrive = useCallback(async () => { await load(); navigate("/home", { replace: true }); }, [load, navigate]);

  if (!configured) return <Waiting text="The Bridging Application is not set up yet. Please come back soon." />;
  if (state.kind === "failed") {
    return (
      <AuthShell>
        <Card className="space-y-3 text-center">
          <p className="text-[15px] text-slate-700">We couldn't reach the server. Check your connection and try again.</p>
          <Button className="w-full" onClick={() => { setState({ kind: "loading" }); void load(); }}>Try again</Button>
        </Card>
      </AuthShell>
    );
  }
  if (state.kind === "loading" || !options) return <Waiting text="Loading…" />;

  if (state.kind === "signedOut") {
    return (
      <Routes>
        <Route path="/" element={<SignIn onSignedIn={() => void arrive()} onRegister={() => navigate("/register")} />} />
        <Route path="/register" element={<Register options={options} onBack={() => navigate("/")} onDone={() => void arrive()} />} />
        <Route path="/admin/*" element={<AdminSoon />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  const { me } = state;
  // signed in, but there is no profile (for example it was removed)
  if (!me) {
    return <AuthShell><Card className="space-y-3 text-center"><p className="text-[15px] text-slate-700">This account is not complete. Please contact CEDO, or sign out and register with another username.</p><Button className="w-full" onClick={() => void leave()}>Sign out</Button></Card></AuthShell>;
  }
  if (me.status === "deactivated") {
    return <AuthShell><Card className="space-y-3 text-center"><p className="text-[15px] text-slate-700">This account has been deactivated. Please contact CEDO.</p><Button className="w-full" onClick={() => void leave()}>Sign out</Button></Card></AuthShell>;
  }
  if (me.needsConsent) return <AgreeAgain me={me} options={options} onDone={() => void load()} onSignOut={() => void leave()} />;

  const student = me.role === "student";
  const profile = <Profile me={me} options={options} onChanged={() => void load()} onSignOut={() => void leave()} />;
  return (
    <Shell student={student}>
      <Routes>
        {student ? (
          <>
            <Route path="/home" element={<Home me={me} />} />
            <Route path="/quest" element={<Quest />} />
            <Route path="/quest/:subject" element={<Quest />} />
            <Route path="/tests" element={<Tests />} />
            <Route path="/materials" element={<Materials />} />
          </>
        ) : (
          <Route path="/teacher/*" element={<TeacherHome me={me} />} />
        )}
        <Route path="/profile" element={profile} />
        <Route path="/admin/*" element={<AdminSoon />} />
        <Route path="*" element={<Navigate to={student ? "/home" : "/teacher"} replace />} />
      </Routes>
    </Shell>
  );
}

function AdminSoon() {
  return (
    <AuthShell title="Administrator">
      <Card><p className="text-[15px] text-slate-700">The administrator tools arrive in the next phase. CEDO staff with the Bridging administrator role will sign in here.</p></Card>
    </AuthShell>
  );
}

/** The privacy notice changed since this person last agreed. */
function AgreeAgain({ me, options, onDone, onSignOut }: { me: Me; options: Options; onDone: () => void; onSignOut: () => void }) {
  const [consent, setConsent] = useState(emptyConsent);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function agree() {
    const problem = consentProblem(consent, me.role, options.settings.under18Mode);
    if (problem) { setError(problem); return; }
    setBusy(true);
    const r = await acceptNotice(consentPayload(consent, options.notice.version, me.role));
    setBusy(false);
    if (r.ok === false) setError(r.error); else onDone();
  }
  return (
    <AuthShell title="Our privacy notice changed">
      <Card className="space-y-4">
        <ConsentForm options={options} role={me.role} value={consent} onChange={v => { setConsent(v); setError(""); }} />
        <ErrorText>{error}</ErrorText>
        <Button className="w-full" disabled={busy} onClick={() => void agree()}>Agree and continue</Button>
        <Button variant="ghost" className="w-full" onClick={onSignOut}>Sign out</Button>
      </Card>
    </AuthShell>
  );
}

/** Bottom menu on phones, side menu on computers. */
function Shell({ student, children }: { student: boolean; children: React.ReactNode }) {
  const items = student
    ? [{ to: "/home", label: "Home", icon: HomeIcon }, { to: "/quest", label: "Quest", icon: BookOpen }, { to: "/tests", label: "Tests", icon: ClipboardList }, { to: "/profile", label: "Profile", icon: User }]
    : [{ to: "/teacher", label: "Home", icon: HomeIcon }, { to: "/profile", label: "Profile", icon: User }];
  const look = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-1 rounded-xl px-3 py-2 text-[12px] font-bold max-lg:flex-col lg:gap-3 lg:text-[15px] ${isActive ? "bg-[#f4c430] text-[#1e3a5f]" : "text-slate-500 lg:text-white/80"}`;
  return (
    <div className="min-h-dvh bg-gradient-to-br from-[#1e3a5f] to-[#2a5080] lg:flex">
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t border-slate-200 bg-white px-1 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]
        lg:static lg:w-60 lg:shrink-0 lg:flex-col lg:justify-start lg:gap-1.5 lg:border-0 lg:bg-black/20 lg:p-4">
        <div className="mb-3 hidden items-center gap-3 lg:flex"><Logo className="h-12 w-12" /><p className="text-[13px] font-bold leading-tight text-[#f4c430]">Kagay-anon Bridging Application</p></div>
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className={look}><Icon size={20} aria-hidden="true" />{label}</NavLink>
        ))}
      </nav>
      <main className="mx-auto w-full max-w-2xl px-4 pb-28 pt-5 lg:pb-8">{children}</main>
    </div>
  );
}
