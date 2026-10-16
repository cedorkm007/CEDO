import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, Download, ExternalLink, Link2, Loader2, Lock, Pause, Pencil, Play, Plus, QrCode, Trash2, Users } from "lucide-react";
import { ModalShell } from "@/sead/components/SeadUiShell";
import { TYPE_CATALOG } from "../../../supabase/functions/_shared/storageToolPublic";
import { createLink, fetchLinks, fetchLinkVisitors, linkAddress, setLinkStatus, updateLink, type LinkInfo, type LinkSettings, type LinkVisitor } from "../storageToolShareApi";
import { countWords } from "../storageToolLogic";
import { ConfirmDialog } from "./Dialogs";

const DEFAULT_TYPES = ["pdf", "jpg", "png", "docx", "xlsx"];
/** One line per kind of file (jpg and jpeg are the same kind), in the order people look for them. */
const TYPE_CHOICES = ["pdf", "jpg", "png", "gif", "webp", "docx", "xlsx", "pptx", "doc", "xls", "ppt", "csv", "txt", "zip", "mp4"].filter(k => TYPE_CATALOG[k]);

const dateTime = (iso: string) => new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
/** "2026-10-20T14:30" (what a date field holds, in the person's own time) <-> an exact moment. */
const toFieldValue = (iso: string | null) => { if (!iso) return ""; const d = new Date(iso); const pad = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

export const STATUS_TEXT: Record<LinkInfo["status"], string> = { active: "Open", paused: "Paused", revoked: "Stopped for good", expired: "Expired" };
const STATUS_CLS: Record<LinkInfo["status"], string> = { active: "bg-green-100 text-green-900", paused: "bg-amber-100 text-amber-950", revoked: "bg-slate-200 text-slate-800", expired: "bg-slate-200 text-slate-800" };

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); } catch {
    const field = document.createElement("textarea");
    field.value = text; field.style.position = "fixed"; field.style.opacity = "0";
    document.body.appendChild(field); field.select(); document.execCommand("copy"); field.remove();
  }
}

/** The upload links of one folder (folderId) or of everything I own (null): a card each, and "Make an upload link". */
export function LinkManager({ folderId, folderName }: { folderId: string | null; folderName?: string }) {
  const [links, setLinks] = useState<LinkInfo[] | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<LinkInfo | "new" | null>(null);
  const [qrFor, setQrFor] = useState<LinkInfo | null>(null);
  const [visitorsFor, setVisitorsFor] = useState<LinkInfo | null>(null);
  const [stopFor, setStopFor] = useState<LinkInfo | null>(null);
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    const r = await fetchLinks(folderId);
    if (!r.ok) { setError(r.error); return; }
    setError(""); setLinks(r.value);
  }, [folderId]);
  useEffect(() => { void load(); }, [load]);

  async function toggle(l: LinkInfo) {
    setBusyId(l.id);
    const r = await setLinkStatus(l.id, l.status === "paused" ? "active" : "paused");
    setBusyId("");
    if (!r.ok) setError(r.error); else await load();
  }

  return (
    <div className="space-y-3">
      {folderId !== null && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[14px] text-slate-800">An upload link lets <strong>anybody with the link</strong> send files into {folderName ? <>“{folderName}”</> : "this folder"}, without an account. They can never see what is inside.</p>
          <button onClick={() => setEditing("new")} className="inline-flex items-center gap-2 rounded-lg bg-[#062444] px-3.5 py-2 text-[14px] font-bold text-white hover:bg-[#0a3a6e]"><Plus size={15} aria-hidden="true" /> Make an upload link</button>
        </div>
      )}
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-[14px] text-red-800">{error}</p>}
      {links === null ? <p className="flex items-center gap-2 py-6 text-[14px] text-slate-700"><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Loading…</p>
        : links.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[#062444]/30 bg-[#f7f9fc] px-6 py-10 text-center">
            <Link2 size={34} className="text-[#062444]" aria-hidden="true" />
            <p className="text-[16px] font-bold text-[#062444]">{folderId === null ? "No upload links yet" : "No upload link for this folder yet"}</p>
            <p className="max-w-md text-[14px] text-slate-700">{folderId === null ? "To collect files from people outside CEDO, open one of your folders, press “Share”, and choose “Upload link”." : "Press “Make an upload link” to get an address and a QR code to give out."}</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {links.map(l => (
              <li key={l.id} className={`rounded-xl border bg-white p-4 ${l.status === "active" ? "border-[#e6ecf5]" : "border-slate-300"}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-[15px] font-bold text-[#062444]"><span className="break-words">{l.title || `Upload to ${l.folderName}`}</span>
                      <span className={`rounded-full px-2.5 py-0.5 text-[13px] font-bold ${STATUS_CLS[l.status]}`}>{STATUS_TEXT[l.status]}</span>
                      {l.hasLock && <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2.5 py-0.5 text-[13px] font-bold text-sky-950"><Lock size={12} aria-hidden="true" /> Lock key</span>}
                    </p>
                    <p className="text-[14px] text-slate-700">Files go into <strong>{l.location}</strong></p>
                  </div>
                  <p className="text-[14px] text-slate-700">{countWords(l.uploads, "file", "files")} from {countWords(l.visitors, "person", "people")}</p>
                </div>
                <p className="mt-2 break-all rounded-lg bg-[#f7f9fc] px-3 py-2 text-[13.5px] text-[#062444]" aria-label="The link address">{linkAddress(l.token)}</p>
                <p className="mt-2 text-[13.5px] text-slate-700">
                  {l.maxFilesPerPerson ? `Up to ${countWords(l.maxFilesPerPerson, "file", "files")} each` : "Any number of files each"} · biggest file {l.maxFileMb} MB · {l.allowedTypes.map(t => "." + t).join(" ")}
                  {l.expiresAt ? ` · ${l.status === "expired" ? "ended" : "ends"} ${dateTime(l.expiresAt)}` : " · no end date"}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <CopyButton text={linkAddress(l.token)} />
                  <SmallButton onClick={() => setQrFor(l)} icon={<QrCode size={15} aria-hidden="true" />}>QR code</SmallButton>
                  <SmallButton onClick={() => setVisitorsFor(l)} icon={<Users size={15} aria-hidden="true" />}>Who sent files</SmallButton>
                  {l.status !== "revoked" && <SmallButton onClick={() => setEditing(l)} icon={<Pencil size={15} aria-hidden="true" />}>Change settings</SmallButton>}
                  {(l.status === "active" || l.status === "paused") && (
                    <SmallButton onClick={() => void toggle(l)} disabled={busyId === l.id} icon={l.status === "paused" ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}>{l.status === "paused" ? "Open it again" : "Pause"}</SmallButton>
                  )}
                  {l.status !== "revoked" && <SmallButton onClick={() => setStopFor(l)} danger icon={<Trash2 size={15} aria-hidden="true" />}>Stop for good</SmallButton>}
                </div>
              </li>
            ))}
          </ul>
        )}
      {editing && folderId !== null && editing === "new" && <LinkSettingsDialog folderId={folderId} link={null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />}
      {editing && editing !== "new" && <LinkSettingsDialog folderId={editing.folderId} link={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />}
      {qrFor && <QrModal link={qrFor} onClose={() => setQrFor(null)} />}
      {visitorsFor && <VisitorsModal link={visitorsFor} onClose={() => setVisitorsFor(null)} />}
      {stopFor && (
        <ConfirmDialog title="Stop this link for good?" confirmLabel="Stop for good" danger onCancel={() => setStopFor(null)}
          onConfirm={async () => { const r = await setLinkStatus(stopFor.id, "revoked"); if (!r.ok) return r.error; setStopFor(null); await load(); return null; }}>
          <p>Nobody will be able to use the address or the QR code any more. The files that were already sent stay in your folder. This cannot be undone; you can always make a new link.</p>
          <p className="text-[13.5px] text-slate-700">If you only want a break, use “Pause” instead.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function SmallButton({ children, icon, onClick, danger, disabled }: { children: React.ReactNode; icon: React.ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className={`inline-flex items-center gap-1.5 rounded-lg border bg-white px-3 py-1.5 text-[14px] font-bold disabled:opacity-60 ${danger ? "border-red-800 text-red-800 hover:bg-red-50" : "border-[#062444]/40 text-[#062444] hover:bg-[#f7f9fc]"}`}>{icon} {children}</button>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <SmallButton onClick={() => { void copyText(text).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 2000); }); }} icon={copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}>{copied ? "Copied" : "Copy link"}</SmallButton>
  );
}

// ── QR code ──
function QrModal({ link, onClose }: { link: LinkInfo; onClose: () => void }) {
  const url = linkAddress(link.token);
  const [qr, setQr] = useState("");
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 2, width: 640, color: { dark: "#000000", light: "#ffffff" } }).then(d => { if (!cancelled) setQr(d); }).catch(() => { if (!cancelled) setQr(""); });
    return () => { cancelled = true; };
  }, [url]);
  return (
    <ModalShell title="QR code of the upload link" onClose={onClose}>
      <div className="flex flex-col items-center gap-3">
        <div className="h-[220px] w-[220px] rounded-lg bg-white">{qr ? <img src={qr} alt="QR code that opens the upload page" width={220} height={220} className="h-full w-full" /> : <div className="h-full w-full animate-pulse rounded-lg bg-[#f0f3f8]" />}</div>
        <p className="text-center text-[14px] text-slate-800">Print it, show it on a slide or send the picture. Scanning it opens the upload page on any phone.</p>
        <p className="break-all text-center text-[13.5px] text-slate-700">{url}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <a href={qr || undefined} download={`upload-link-qr.png`} aria-disabled={!qr} className={`inline-flex items-center gap-1.5 rounded-lg bg-[#062444] px-4 py-2 text-[14px] font-bold text-white ${qr ? "" : "pointer-events-none opacity-50"}`}><Download size={15} aria-hidden="true" /> Download QR (PNG)</a>
          <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-[#062444]/40 px-4 py-2 text-[14px] font-bold text-[#062444]"><ExternalLink size={15} aria-hidden="true" /> Open the page</a>
        </div>
      </div>
    </ModalShell>
  );
}

// ── Who sent files ──
function VisitorsModal({ link, onClose }: { link: LinkInfo; onClose: () => void }) {
  const [rows, setRows] = useState<LinkVisitor[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { void fetchLinkVisitors(link.id).then(r => { if (r.ok) setRows(r.value); else setError(r.error); }); }, [link.id]);
  return (
    <ModalShell title="Who sent files through this link" onClose={onClose} wide>
      {error && <p role="alert" className="text-[14px] text-red-700">{error}</p>}
      {rows === null && !error && <p className="flex items-center gap-2 text-[14px] text-slate-700"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…</p>}
      {rows && rows.length === 0 && <p className="text-[14px] text-slate-800">Nobody has sent a file through this link yet.</p>}
      {rows && rows.length > 0 && (
        <ul className="divide-y divide-[#e6ecf5] rounded-lg border border-[#e6ecf5]">
          {rows.map((v, i) => (
            <li key={i} className="px-3 py-2.5 text-[14px]">
              <p className="font-bold text-[#062444]">{v.name || "No name given"} <span className="font-normal text-slate-700">· {countWords(v.files, "file", "files")}</span></p>
              <p className="text-slate-700">{[v.email, v.phone].filter(Boolean).join(" · ") || "No contact details"}{v.lastAt ? ` · last upload ${dateTime(v.lastAt)}` : ""}</p>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[13.5px] text-slate-700">The name, email and phone are what the person typed; they are not checked.</p>
    </ModalShell>
  );
}

// ── Making and changing a link ──
export function LinkSettingsDialog({ folderId, link, onClose, onSaved }: { folderId: string; link: LinkInfo | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(link?.title ?? "");
  const [instructions, setInstructions] = useState(link?.instructions ?? "");
  const [types, setTypes] = useState<Set<string>>(new Set(link ? link.allowedTypes.map(t => (t === "jpeg" ? "jpg" : t)) : DEFAULT_TYPES));
  const [maxMb, setMaxMb] = useState(String(link?.maxFileMb ?? 50));
  const [perPerson, setPerPerson] = useState(link?.maxFilesPerPerson ? String(link.maxFilesPerPerson) : "");
  const [expires, setExpires] = useState(toFieldValue(link?.expiresAt ?? null));
  const [requireEmail, setRequireEmail] = useState(link?.requireEmail ?? false);
  const [requirePhone, setRequirePhone] = useState(link?.requirePhone ?? false);
  const [subfolders, setSubfolders] = useState(link?.allowSubfolders ?? false);
  const [lockMode, setLockMode] = useState<"keep" | "set" | "none">(link?.hasLock ? "keep" : "none");
  const [lockKey, setLockKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const inDays = (days: number) => { const d = new Date(Date.now() + days * 86400000); d.setSeconds(0, 0); setExpires(toFieldValue(d.toISOString())); };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const mb = Number(maxMb), each = perPerson.trim() === "" ? null : Number(perPerson);
    if (!Number.isInteger(mb) || mb < 1 || mb > 500) { setError("The biggest file must be a whole number from 1 to 500 MB."); return; }
    if (each !== null && (!Number.isInteger(each) || each < 1 || each > 1000)) { setError("Files per person must be a whole number from 1 to 1000, or empty for no limit."); return; }
    if (types.size === 0) { setError("Choose at least one type of file."); return; }
    if (lockMode === "set" && lockKey.trim().length < 4) { setError("The lock key needs at least 4 characters."); return; }
    let expiresAt: string | null = null;
    if (expires) {
      const d = new Date(expires);
      if (Number.isNaN(d.getTime())) { setError("That end date is not valid."); return; }
      if (d.getTime() <= Date.now()) { setError("The end date must be in the future."); return; }
      expiresAt = d.toISOString();
    }
    const settings: LinkSettings = {
      title: title.trim(), instructions: instructions.trim(), expiresAt, maxFilesPerPerson: each, maxFileMb: mb, allowedTypes: [...types],
      requireEmail, requirePhone, allowSubfolders: subfolders,
      lockKey: lockMode === "keep" ? undefined : lockMode === "none" ? "" : lockKey,
    };
    setBusy(true); setError("");
    const r = link ? await updateLink(link.id, settings) : await createLink(folderId, settings);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    onSaved();
  }

  const toggleType = (k: string) => setTypes(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const field = "mt-1 w-full rounded-lg border border-[#062444]/25 px-3 py-2 text-[14px] font-normal outline-none focus:border-[#062444]";
  const check = "flex items-center gap-2 text-[14px] text-slate-800";

  return (
    <ModalShell title={link ? "Change the upload link" : "Make an upload link"} onClose={busy ? () => undefined : onClose} wide>
      <form onSubmit={e => void save(e)} className="space-y-4">
        <label className="block text-[14px] font-semibold text-[#062444]">Title shown to the people <span className="font-normal text-slate-700">(optional)</span>
          <input value={title} onChange={e => setTitle(e.target.value)} maxLength={120} placeholder="For example: Send your enrollment forms" className={field} />
        </label>
        <label className="block text-[14px] font-semibold text-[#062444]">Instructions <span className="font-normal text-slate-700">(optional)</span>
          <textarea value={instructions} onChange={e => setInstructions(e.target.value)} maxLength={1000} rows={3} placeholder="What to send, how to name the files, who to ask if there is a problem" className={field} />
        </label>

        <fieldset className="rounded-lg border border-[#e6ecf5] p-3">
          <legend className="px-1 text-[14px] font-bold text-[#062444]">Files that are accepted</legend>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-3">
            {TYPE_CHOICES.map(k => <label key={k} className={check}><input type="checkbox" checked={types.has(k)} onChange={() => toggleType(k)} className="h-4 w-4 accent-[#062444]" /> {TYPE_CATALOG[k].label}</label>)}
          </div>
          <p className="mt-2 text-[13.5px] text-slate-700">Programs, scripts and web pages are never accepted, and every file is checked to be what its name says.</p>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-[14px] font-semibold text-[#062444]">Biggest file (MB)
            <input value={maxMb} onChange={e => setMaxMb(e.target.value)} inputMode="numeric" className={field} />
          </label>
          <label className="block text-[14px] font-semibold text-[#062444]">Files per person <span className="font-normal text-slate-700">(empty = no limit)</span>
            <input value={perPerson} onChange={e => setPerPerson(e.target.value)} inputMode="numeric" placeholder="No limit" className={field} />
          </label>
        </div>

        <div>
          <label className="block text-[14px] font-semibold text-[#062444]">The link stops working on <span className="font-normal text-slate-700">(optional)</span>
            <input type="datetime-local" value={expires} onChange={e => setExpires(e.target.value)} className={field} />
          </label>
          <div className="mt-1.5 flex flex-wrap gap-2 text-[13.5px]">
            <button type="button" onClick={() => inDays(1)} className="rounded-lg border border-[#062444]/25 px-2.5 py-1 font-semibold text-[#062444] hover:bg-[#f7f9fc]">In 1 day</button>
            <button type="button" onClick={() => inDays(7)} className="rounded-lg border border-[#062444]/25 px-2.5 py-1 font-semibold text-[#062444] hover:bg-[#f7f9fc]">In 7 days</button>
            <button type="button" onClick={() => inDays(30)} className="rounded-lg border border-[#062444]/25 px-2.5 py-1 font-semibold text-[#062444] hover:bg-[#f7f9fc]">In 30 days</button>
            <button type="button" onClick={() => setExpires("")} className="rounded-lg px-2.5 py-1 font-semibold text-[#00709f] hover:underline">No end date</button>
          </div>
        </div>

        <fieldset className="rounded-lg border border-[#e6ecf5] p-3">
          <legend className="px-1 text-[14px] font-bold text-[#062444]">Lock key</legend>
          {link?.hasLock && <label className={check}><input type="radio" name="lock" checked={lockMode === "keep"} onChange={() => setLockMode("keep")} /> Keep the lock key as it is</label>}
          <label className={check}><input type="radio" name="lock" checked={lockMode === "none"} onChange={() => setLockMode("none")} /> {link?.hasLock ? "Remove the lock key (anybody with the link can send files)" : "No lock key (anybody with the link can send files)"}</label>
          <label className={check}><input type="radio" name="lock" checked={lockMode === "set"} onChange={() => setLockMode("set")} /> {link?.hasLock ? "Change the lock key" : "Ask for a lock key"}</label>
          {lockMode === "set" && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input type={showKey ? "text" : "password"} value={lockKey} onChange={e => setLockKey(e.target.value)} aria-label="The lock key" autoComplete="off" placeholder="At least 4 characters" className="min-w-[12rem] flex-1 rounded-lg border border-[#062444]/25 px-3 py-2 text-[14px] outline-none focus:border-[#062444]" />
              <label className={check}><input type="checkbox" checked={showKey} onChange={e => setShowKey(e.target.checked)} className="h-4 w-4 accent-[#062444]" /> Show it</label>
            </div>
          )}
          <p className="mt-2 text-[13.5px] text-slate-700">People must type the lock key before they can send files. Tell it to them separately from the link. It is stored only in scrambled form, so you cannot read it again; if it is forgotten, set a new one.</p>
        </fieldset>

        <fieldset className="rounded-lg border border-[#e6ecf5] p-3">
          <legend className="px-1 text-[14px] font-bold text-[#062444]">What people are asked</legend>
          <p className="text-[13.5px] text-slate-700">Their name is always asked.</p>
          <label className={check}><input type="checkbox" checked={requireEmail} onChange={e => setRequireEmail(e.target.checked)} className="h-4 w-4 accent-[#062444]" /> Their email address is required</label>
          <label className={check}><input type="checkbox" checked={requirePhone} onChange={e => setRequirePhone(e.target.checked)} className="h-4 w-4 accent-[#062444]" /> Their phone number is required</label>
          <label className={check}><input type="checkbox" checked={subfolders} onChange={e => setSubfolders(e.target.checked)} className="h-4 w-4 accent-[#062444]" /> They may choose or make a folder to put their files in</label>
        </fieldset>

        {error && <p role="alert" className="text-[14px] text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-[#062444]/25 px-4 py-2 text-[14px] font-semibold text-[#062444]">Cancel</button>
          <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-[#062444] px-4 py-2 text-[14px] font-bold text-white disabled:opacity-60">{busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />} {link ? "Save" : "Make the link"}</button>
        </div>
      </form>
    </ModalShell>
  );
}
