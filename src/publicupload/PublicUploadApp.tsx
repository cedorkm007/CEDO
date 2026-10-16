import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, FileUp, Loader2, Lock, UploadCloud, X } from "lucide-react";
import { checkStart } from "../../supabase/functions/_shared/storageToolPublic";
import { fetchInfo, finishFile, myFiles, openVisit, sendToAddress, startFile, type InfoReply, type LinkInfoPublic, type MyFile } from "./publicUploadApi";

const TURNSTILE_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ?? "";
const PARALLEL = 2;

const tokenOfPath = () => (/^\/upload\/([a-f0-9]{64})\/?$/i.exec(window.location.pathname)?.[1] ?? "").toLowerCase();
const storeKey = (token: string) => `storage-tool-upload-${token}`;
function readVisit(token: string): { sessionToken: string; name: string } | null { try { const v = sessionStorage.getItem(storeKey(token)); return v ? (JSON.parse(v) as { sessionToken: string; name: string }) : null; } catch { return null; } }
function saveVisit(token: string, v: { sessionToken: string; name: string } | null) { try { if (v) sessionStorage.setItem(storeKey(token), JSON.stringify(v)); else sessionStorage.removeItem(storeKey(token)); } catch { /* private window: the visit just ends when the page is closed */ } }

const sizeText = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(b >= 10485760 ? 0 : 1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const GONE_TEXT = "This upload link is no longer active.";

interface Job { id: string; file: File; status: "waiting" | "sending" | "checking" | "done" | "error" | "cancelled"; progress: number; error?: string }

/**
 * The page people outside CEDO see when they open an upload link (https://<site>/upload/<code>). No account: they type their name (and the email, phone and
 * lock key when the owner asked for them), then send files. They can only add files; they never see what is inside the folder, only what they sent in this visit.
 */
export function PublicUploadApp() {
  const token = tokenOfPath();
  const [info, setInfo] = useState<InfoReply | null>(null);
  const [loadError, setLoadError] = useState("");
  const [visit, setVisit] = useState<{ sessionToken: string; name: string } | null>(() => readVisit(token));

  useEffect(() => {
    document.title = "Send files";
    let cancelled = false;
    if (!token) { setInfo({ active: false, status: "gone" }); return; }
    void fetchInfo(token).then(r => {
      if (cancelled) return;
      if (r.ok) setInfo(r.value); else if (r.status === 404 || r.status === 410) setInfo({ active: false, status: "gone" }); else setLoadError(r.error);
    });
    return () => { cancelled = true; };
  }, [token]);

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-[#f3f6fb] px-4 py-8 text-slate-900">
      <div className="mx-auto w-full max-w-xl">
        <header><p className="mb-3 text-center text-[13px] font-bold uppercase tracking-wide text-[#062444]">CEDO · Send files</p></header>
        <main className="overflow-hidden rounded-2xl bg-white shadow-lg">{children}</main>
        <footer><p className="mt-4 text-center text-[13px] text-slate-700">Only the person who made this link can see what you send.</p></footer>
      </div>
    </div>
  );

  if (loadError) return shell(<Notice icon={<AlertCircle size={36} aria-hidden="true" />} title="We could not open this page" text={loadError} />);
  if (!info) return shell(<p className="flex items-center justify-center gap-2 px-6 py-14 text-[15px] text-slate-700" role="status"><Loader2 size={18} className="animate-spin" aria-hidden="true" /> Opening…</p>);
  if (!info.active) return shell(<Notice icon={<Lock size={36} aria-hidden="true" />} title={GONE_TEXT} text="The person who shared it may have paused it, stopped it, or it may have reached its end date. Please ask them for a new link." />);
  if (!visit) return shell(<OpenForm token={token} info={info} onOpened={v => { saveVisit(token, v); setVisit(v); }} />);
  return shell(<Uploader token={token} info={info} visit={visit} onExpired={() => { saveVisit(token, null); setVisit(null); }} />);
}

function Notice({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center text-[#062444]" role="alert">
      {icon}<h1 className="text-[19px] font-bold">{title}</h1><p className="max-w-sm text-[15px] text-slate-800">{text}</p>
    </div>
  );
}

function Header({ info }: { info: LinkInfoPublic }) {
  return (
    <div className="bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-5 text-white">
      <h1 className="text-[20px] font-bold">{info.title || `Send files to “${info.folderName}”`}</h1>
    </div>
  );
}

// ── Cloudflare Turnstile (only when the server has a key) ──
function Turnstile({ onToken }: { onToken: (t: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) { setFailed(true); return; }
    let widget: string | undefined;
    const render = () => {
      const w = window as unknown as { turnstile?: { render: (el: HTMLElement, o: Record<string, unknown>) => string; remove: (id: string) => void } };
      if (!box.current || !w.turnstile) return;
      widget = w.turnstile.render(box.current, { sitekey: TURNSTILE_SITE_KEY, callback: (t: string) => onToken(t), "expired-callback": () => onToken(""), "error-callback": () => setFailed(true) });
    };
    if ((window as unknown as { turnstile?: unknown }).turnstile) render();
    else {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"; s.async = true; s.onload = render; s.onerror = () => setFailed(true);
      document.head.appendChild(s);
    }
    return () => { const w = window as unknown as { turnstile?: { remove: (id: string) => void } }; if (widget) w.turnstile?.remove(widget); };
  }, [onToken]);
  return failed ? <p role="alert" className="text-[14px] text-red-700">The “are you a person” check could not load. Please reload the page.</p> : <div ref={box} />;
}

// ── Step 1: who are you ──
function OpenForm({ token, info, onOpened }: { token: string; info: LinkInfoPublic; onOpened: (v: { sessionToken: string; name: string }) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [lockKey, setLockKey] = useState("");
  const [captcha, setCaptcha] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const onCaptcha = useCallback((t: string) => setCaptcha(t), []);

  async function go(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Please type your name."); return; }
    if (info.requireEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError("Please type a valid email address."); return; }
    if (info.requirePhone && phone.replace(/\D/g, "").length < 7) { setError("Please type your phone number."); return; }
    if (info.needsLockKey && !lockKey) { setError("Please type the lock key you were given."); return; }
    if (info.captcha && !captcha) { setError("Please complete the check that you are a person."); return; }
    setBusy(true); setError("");
    const r = await openVisit(token, { name: name.trim(), email: email.trim(), phone: phone.trim(), lockKey, captchaToken: captcha });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    onOpened({ sessionToken: r.value.sessionToken, name: name.trim() });
  }
  const field = "mt-1 w-full rounded-lg border border-slate-400 px-3 py-2.5 text-[16px] outline-none focus:border-[#062444] focus:ring-2 focus:ring-[#062444]/20";
  return (
    <>
      <Header info={info} />
      <form onSubmit={e => void go(e)} className="space-y-4 px-6 py-6">
        {info.instructions && <p className="whitespace-pre-line rounded-lg bg-[#f7f9fc] px-4 py-3 text-[15px] text-slate-900">{info.instructions}</p>}
        <label className="block text-[15px] font-semibold text-[#062444]">Your name
          <input value={name} onChange={e => setName(e.target.value)} maxLength={120} autoComplete="name" className={field} />
        </label>
        {info.requireEmail && <label className="block text-[15px] font-semibold text-[#062444]">Your email address
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} maxLength={200} autoComplete="email" className={field} />
        </label>}
        {info.requirePhone && <label className="block text-[15px] font-semibold text-[#062444]">Your phone number
          <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} maxLength={40} autoComplete="tel" className={field} />
        </label>}
        {info.needsLockKey && <label className="block text-[15px] font-semibold text-[#062444]"><span className="inline-flex items-center gap-1.5"><Lock size={15} aria-hidden="true" /> Lock key</span>
          <input type="password" value={lockKey} onChange={e => setLockKey(e.target.value)} autoComplete="off" className={field} />
          <span className="mt-1 block text-[14px] font-normal text-slate-700">The person who sent you this link gave you a lock key.</span>
        </label>}
        {info.captcha && <Turnstile onToken={onCaptcha} />}
        {error && <p role="alert" className="text-[15px] text-red-700">{error}</p>}
        <button type="submit" disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#062444] px-4 py-3 text-[16px] font-bold text-white hover:bg-[#0a3a6e] disabled:opacity-60">{busy && <Loader2 size={16} className="animate-spin" aria-hidden="true" />} Continue</button>
      </form>
    </>
  );
}

// ── Step 2: send files ──
function Uploader({ token, info, visit, onExpired }: { token: string; info: LinkInfoPublic; visit: { sessionToken: string; name: string }; onExpired: () => void }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [mine, setMine] = useState<MyFile[]>([]);
  const [folderId, setFolderId] = useState<string>("");
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef<string[]>([]);
  const running = useRef(0);
  const controllers = useRef(new Map<string, AbortController>());
  const jobsRef = useRef<Job[]>([]);
  jobsRef.current = jobs;
  const folderRef = useRef(""); folderRef.current = folderId;
  const dragDepth = useRef(0);

  const patch = useCallback((id: string, p: Partial<Job>) => setJobs(list => list.map(j => (j.id === id ? { ...j, ...p } : j))), []);
  const refreshMine = useCallback(async () => {
    const r = await myFiles(token, visit.sessionToken);
    if (r.ok) setMine(r.value.files); else if (r.code === "session" || r.status === 401) onExpired();
  }, [token, visit.sessionToken, onExpired]);
  useEffect(() => { void refreshMine(); }, [refreshMine]);

  const limit = info.maxFilesPerPerson;
  const sentCount = mine.length;
  const queuedCount = jobs.filter(j => j.status === "waiting" || j.status === "sending" || j.status === "checking").length;
  const remaining = limit === null ? null : Math.max(0, limit - sentCount - queuedCount);
  const remainingRef = useRef<number | null>(remaining); remainingRef.current = remaining;

  const runOne = useCallback(async (id: string) => {
    const job = jobsRef.current.find(j => j.id === id);
    if (!job || job.status !== "waiting") return;
    const folder = folderRef.current || null;
    const controller = new AbortController();
    controllers.current.set(id, controller);
    patch(id, { status: "sending", progress: 0 });
    const started = await startFile(token, visit.sessionToken, job.file.name, job.file.size, folder);
    if (!started.ok) { controllers.current.delete(id); if (started.code === "session" || started.status === 401) { onExpired(); return; } patch(id, { status: "error", error: started.error }); return; }
    const sent = await sendToAddress(started.value.uploadUrl, job.file, p => patch(id, { progress: p }), controller.signal);
    controllers.current.delete(id);
    if (!sent.ok) { patch(id, sent.cancelled ? { status: "cancelled" } : { status: "error", error: sent.error }); return; }
    patch(id, { status: "checking", progress: 99 });
    const finished = await finishFile(token, visit.sessionToken, started.value.fileId, started.value.fileName, folder);
    if (!finished.ok) { patch(id, { status: "error", error: finished.error }); return; }
    patch(id, { status: "done", progress: 100 });
    void refreshMine();
  }, [token, visit.sessionToken, patch, refreshMine, onExpired]);

  const pump = useCallback(() => {
    while (running.current < PARALLEL && pending.current.length > 0) {
      const id = pending.current.shift()!;
      running.current++;
      void runOne(id).finally(() => { running.current--; pump(); });
    }
  }, [runOne]);

  function add(files: File[]) {
    if (files.length === 0) return;
    const messages: string[] = [];
    const accepted: Job[] = [];
    let room = remainingRef.current;
    const rules = { allowedTypes: info.allowedTypes.map(t => t.ext), maxFileMb: info.maxFileMb };
    for (const f of files) {
      if (room !== null && room <= 0) { messages.push(`“${f.name}” was not added: you have reached the limit of ${limit} files.`); continue; }
      const v = checkStart(f.name, f.size, rules);
      if (!v.ok) { messages.push(`“${f.name}”: ${v.error}`); continue; }
      accepted.push({ id: crypto.randomUUID(), file: f, status: "waiting", progress: 0 });
      if (room !== null) room--;
    }
    setNotice(messages.slice(0, 4).join(" ") + (messages.length > 4 ? ` (and ${messages.length - 4} more were not added.)` : ""));
    if (accepted.length === 0) return;
    setJobs(list => [...accepted, ...list]);
    jobsRef.current = [...accepted, ...jobsRef.current];
    pending.current.push(...accepted.map(a => a.id));
    pump();
  }
  const cancel = (id: string) => {
    const at = pending.current.indexOf(id);
    if (at >= 0) { pending.current.splice(at, 1); patch(id, { status: "cancelled" }); return; }
    controllers.current.get(id)?.abort();
  };

  const canSend = remaining === null || remaining > 0;
  const accept = info.allowedTypes.map(t => "." + t.ext).join(",");
  return (
    <>
      <Header info={info} />
      <div className="space-y-4 px-6 py-6"
        onDragEnter={e => { if (Array.from(e.dataTransfer.types).includes("Files")) { dragDepth.current++; setDragging(true); } }}
        onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragging(false); }}
        onDragOver={e => { if (Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault(); }}
        onDrop={e => { e.preventDefault(); dragDepth.current = 0; setDragging(false); if (canSend) add(Array.from(e.dataTransfer.files)); }}>
        <p className="text-[15px] text-slate-900">Hello, <strong>{visit.name}</strong>.</p>
        {info.instructions && <p className="whitespace-pre-line rounded-lg bg-[#f7f9fc] px-4 py-3 text-[15px] text-slate-900">{info.instructions}</p>}

        {info.allowSubfolders && info.subfolders.length > 0 && (
          <label className="block text-[15px] font-semibold text-[#062444]">Put my files in
            <select value={folderId} onChange={e => setFolderId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-400 bg-white px-3 py-2.5 text-[16px]">
              <option value="">{info.folderName}</option>
              {info.subfolders.map(s => <option key={s.id} value={s.id}>{s.location || s.name}</option>)}
            </select>
          </label>
        )}

        <div className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center ${dragging ? "border-[#00709f] bg-sky-50" : "border-[#062444]/40 bg-[#f7f9fc]"}`}>
          <UploadCloud size={38} className="text-[#062444]" aria-hidden="true" />
          {canSend ? (
            <>
              <p className="text-[16px] font-bold text-[#062444]">Drop your files here</p>
              <button onClick={() => input.current?.click()} className="inline-flex items-center gap-2 rounded-lg bg-[#062444] px-5 py-3 text-[16px] font-bold text-white hover:bg-[#0a3a6e]"><FileUp size={18} aria-hidden="true" /> Choose files</button>
              <input ref={input} type="file" multiple accept={accept} className="sr-only" aria-label="Choose files to send" tabIndex={-1} onChange={e => { add(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
            </>
          ) : <p className="text-[16px] font-bold text-[#062444]">You have sent the most files allowed ({limit}). Thank you!</p>}
          <p className="text-[14px] text-slate-800">Accepted: {info.allowedTypes.map(t => "." + t.ext).join(" ")} · biggest file {info.maxFileMb} MB{limit !== null ? ` · ${remaining} more file${remaining === 1 ? "" : "s"} allowed` : ""}</p>
        </div>

        {notice && <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-[14px] text-amber-950">{notice}</p>}

        {jobs.length > 0 && (
          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-300" aria-label="Files being sent">
            {jobs.map(j => (
              <li key={j.id} className="px-3 py-2.5 text-[14px]">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 break-all font-semibold text-[#062444]">{j.file.name} <span className="font-normal text-slate-700">({sizeText(j.file.size)})</span></span>
                  {(j.status === "waiting" || j.status === "sending") && <button onClick={() => cancel(j.id)} aria-label={`Cancel ${j.file.name}`} className="shrink-0 rounded p-1 text-slate-700 hover:bg-slate-100"><X size={16} aria-hidden="true" /></button>}
                </div>
                {j.status === "sending" || j.status === "checking" ? (
                  <div className="mt-1.5"><div className="h-2 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={j.progress} aria-label={`Sending ${j.file.name}`}><div className="h-full rounded-full bg-[#00709f]" style={{ width: `${j.progress}%` }} /></div>
                    <p className="mt-1 text-slate-700">{j.status === "checking" ? "Checking the file…" : `Sending… ${j.progress}%`}</p></div>
                ) : j.status === "done" ? <p className="mt-1 flex items-center gap-1.5 text-green-800"><CheckCircle2 size={15} aria-hidden="true" /> Sent</p>
                  : j.status === "error" ? <p role="alert" className="mt-1 flex items-start gap-1.5 text-red-800"><AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {j.error}</p>
                  : j.status === "cancelled" ? <p className="mt-1 text-slate-700">Cancelled</p> : <p className="mt-1 text-slate-700">Waiting…</p>}
              </li>
            ))}
          </ul>
        )}

        {mine.length > 0 && (
          <section aria-label="What you sent">
            <h2 className="text-[15px] font-bold text-[#062444]">What you have sent ({mine.length})</h2>
            <ul className="mt-1.5 space-y-1 text-[14px] text-slate-900">
              {mine.map((f, i) => <li key={i} className="flex items-center justify-between gap-2 rounded-lg bg-green-50 px-3 py-1.5"><span className="break-all">{f.name}</span><span className="shrink-0 text-slate-700">{sizeText(f.size)}</span></li>)}
            </ul>
            <p className="mt-2 text-[14px] text-slate-700">You cannot open or change what you sent. If you sent a wrong file, please tell the person who gave you this link.</p>
          </section>
        )}
      </div>
    </>
  );
}
