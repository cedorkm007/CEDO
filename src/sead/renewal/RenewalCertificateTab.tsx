import { useCallback, useEffect, useRef, useState } from "react";
import { FileCheck2, ImagePlus, Loader2, RotateCcw } from "lucide-react";
import { removeWhiteBackground } from "@/lib/imageBackgroundRemoval";
import { csrPictureUrl, fetchCsrSettings, removeCsrPictures, saveCsrSettings, uploadCsrPicture, type CsrSettings, type SignaturePictureKey } from "@/lib/csrApi";
import { formatDateTime } from "@/lib/renewal";

type PictureState = { path: string | null | undefined; url: string | null };   // path: undefined = unchanged, null = removed (sample used), string = new upload

const PICTURES: { key: SignaturePictureKey; label: string; help: string }[] = [
  { key: "officer", label: "Signature of the City Education and Development Officer", help: "Printed above the officer's name." },
  { key: "mayor", label: "Signature of the City Mayor", help: "Printed above the Mayor's name." },
  { key: "mayorMark", label: "Mayor's initials / stamp (optional)", help: "The small mark printed beside the Mayor's signature." },
];

/**
 * "Certificate" tab: switch the Certificate of Scholarship Renewal on or off and keep the two signatories (names, titles, signature pictures).
 * Open to the Scholar Renewal Evaluator and the IT admin. Until a picture is uploaded the certificate uses the office's sample picture.
 */
export function RenewalCertificateTab() {
  const [saved, setSaved] = useState<CsrSettings | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [officerName, setOfficerName] = useState(""), [officerTitle, setOfficerTitle] = useState("");
  const [mayorName, setMayorName] = useState(""), [mayorTitle, setMayorTitle] = useState("");
  const [place, setPlace] = useState("");
  const [pics, setPics] = useState<Record<SignaturePictureKey, PictureState>>({ officer: { path: undefined, url: null }, mayor: { path: undefined, url: null }, mayorMark: { path: undefined, url: null } });
  const [processing, setProcessing] = useState<SignaturePictureKey | null>(null);
  const fresh = useRef<string[]>([]);   // pictures uploaded in this visit; removed again when replaced before saving

  const load = useCallback(async () => {
    const r = await fetchCsrSettings();
    if (!r.ok) { setError(r.error); return; }
    const s = r.settings;
    setSaved(s); setError("");
    setEnabled(s.enabled); setOfficerName(s.officerName); setOfficerTitle(s.officerTitle); setMayorName(s.mayorName); setMayorTitle(s.mayorTitle); setPlace(s.place);
    const url = async (p: string | null) => (p ? await csrPictureUrl(p) : null);
    setPics({
      officer: { path: undefined, url: await url(s.officerSignaturePath) }, mayor: { path: undefined, url: await url(s.mayorSignaturePath) }, mayorMark: { path: undefined, url: await url(s.mayorMarkPath) },
    });
    fresh.current = [];
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function pick(key: SignaturePictureKey, file: File | undefined) {
    if (!file) return;
    setError(""); setMessage(""); setProcessing(key);
    try {
      const transparent = await removeWhiteBackground(file);
      const up = await uploadCsrPicture(key, transparent);
      if (!up.ok) { setError(up.error); return; }
      const old = pics[key].path;
      if (old && fresh.current.includes(old)) { void removeCsrPictures([old]); fresh.current = fresh.current.filter(p => p !== old); }
      fresh.current.push(up.path);
      setPics(p => ({ ...p, [key]: { path: up.path, url: URL.createObjectURL(transparent) } }));
    } catch { setError("Couldn't process that picture — try a different file (JPG or PNG)."); }
    finally { setProcessing(null); }
  }

  async function save() {
    setBusy(true); setError(""); setMessage("");
    const r = await saveCsrSettings({
      enabled, officerName, officerTitle, mayorName, mayorTitle, place,
      officerSignaturePath: pics.officer.path, mayorSignaturePath: pics.mayor.path, mayorMarkPath: pics.mayorMark.path,
    });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    // Pictures that were replaced or removed are no longer needed.
    if (saved) {
      const old = [pics.officer.path !== undefined ? saved.officerSignaturePath : null, pics.mayor.path !== undefined ? saved.mayorSignaturePath : null, pics.mayorMark.path !== undefined ? saved.mayorMarkPath : null].filter((p): p is string => !!p);
      void removeCsrPictures(old);
    }
    setMessage(enabled && !saved?.enabled ? "Saved. Certificates are now ON — scholars whose renewal is confirmed have been told they can download theirs." : "Saved.");
    await load();
  }

  if (!saved && !error) return <p className="text-[14px] text-slate-700 flex items-center gap-2"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…</p>;
  if (!saved) return <p role="alert" className="text-[14px] text-red-700">{error}</p>;

  const field = "w-full rounded-lg border border-[#062444]/25 px-3 py-2 text-[14px] outline-none focus:border-[#062444] bg-white font-normal";
  const label = "block text-[14px] font-semibold text-[#062444]";
  return (
    <div className="space-y-5 max-w-3xl">
      <div className="rounded-xl border border-[#e6ecf5] bg-[#f7f9fc] px-4 py-3 text-[14px] text-slate-800">
        <p className="flex items-center gap-2 font-bold text-[#062444]"><FileCheck2 size={16} aria-hidden="true" /> Certificate of Scholarship Renewal</p>
        <p className="mt-1">A scholar can download a certificate once the evaluator has confirmed the renewal. Each certificate has its own number and a QR that anyone can scan to check it. Corrected copies are issued from the scholar's case page.</p>
        {saved.updatedAt && <p className="mt-1 text-slate-600">Last saved {formatDateTime(saved.updatedAt)}{saved.updatedBy ? ` by ${saved.updatedBy}` : ""}.</p>}
      </div>

      <label className="flex items-start gap-3 rounded-xl border border-[#e6ecf5] bg-white px-4 py-3 text-[14px]">
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="mt-1 h-4 w-4" />
        <span><strong className="text-[#062444]">Certificates are {enabled ? "ON" : "OFF"}</strong><br /><span className="text-slate-700">{enabled ? "Scholars with a confirmed renewal can download their certificate." : "Nobody can download a certificate yet. Switching on tells every scholar with a confirmed renewal."}</span></span>
      </label>

      <fieldset className="grid gap-4 sm:grid-cols-2 rounded-xl border border-[#e6ecf5] bg-white px-4 py-4">
        <legend className="px-1 text-[15px] font-bold text-[#062444]">Signatories</legend>
        <label className={label}>Officer — name<input value={officerName} onChange={e => setOfficerName(e.target.value)} maxLength={200} className={`${field} mt-1`} /></label>
        <label className={label}>Officer — title<input value={officerTitle} onChange={e => setOfficerTitle(e.target.value)} maxLength={200} className={`${field} mt-1`} /></label>
        <label className={label}>Mayor — name<input value={mayorName} onChange={e => setMayorName(e.target.value)} maxLength={200} className={`${field} mt-1`} /></label>
        <label className={label}>Mayor — title<input value={mayorTitle} onChange={e => setMayorTitle(e.target.value)} maxLength={200} className={`${field} mt-1`} /></label>
        <label className={`${label} sm:col-span-2`}>Place printed in “Issued this … day of … at …”<input value={place} onChange={e => setPlace(e.target.value)} maxLength={200} className={`${field} mt-1`} /></label>
      </fieldset>

      <fieldset className="rounded-xl border border-[#e6ecf5] bg-white px-4 py-4">
        <legend className="px-1 text-[15px] font-bold text-[#062444]">Signature pictures</legend>
        <p className="text-[14px] text-slate-700 mb-3">Until a picture is uploaded, the certificate uses the office's sample picture. A JPG or PNG is fine — the white background is made transparent automatically.</p>
        <div className="space-y-4">
          {PICTURES.map(p => {
            const state = pics[p.key];
            const own = state.path !== null && (state.path !== undefined || state.url !== null);
            return (
              <div key={p.key} className="flex flex-wrap items-center gap-4">
                <div className="flex h-20 w-44 shrink-0 items-center justify-center rounded-lg border border-dashed border-[#062444]/25 bg-[#f7f9fc]">
                  {state.url && state.path !== null ? <img src={state.url} alt={`${p.label} (current picture)`} className="max-h-full max-w-full object-contain" /> : <span className="px-2 text-center text-[13px] text-slate-700">Sample picture in use</span>}
                </div>
                <div className="min-w-[220px] flex-1">
                  <p className="text-[14px] font-semibold text-[#062444]">{p.label}</p>
                  <p className="text-[13.5px] text-slate-700">{p.help}</p>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#062444]/25 px-3 py-1.5 text-[14px] font-semibold text-[#062444] hover:bg-[#f7f9fc]">
                      {processing === p.key ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <ImagePlus size={14} aria-hidden="true" />} {own ? "Replace picture" : "Upload picture"}
                      <input type="file" accept="image/jpeg,image/png" className="sr-only" aria-label={`Upload: ${p.label}`} disabled={processing !== null} onChange={e => { void pick(p.key, e.target.files?.[0]); e.target.value = ""; }} />
                    </label>
                    {own && <button type="button" onClick={() => setPics(s => ({ ...s, [p.key]: { path: null, url: null } }))} className="inline-flex items-center gap-1.5 rounded-lg border border-[#062444]/25 px-3 py-1.5 text-[14px] font-semibold text-[#062444] hover:bg-[#f7f9fc]"><RotateCcw size={14} aria-hidden="true" /> Use the sample picture</button>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </fieldset>

      {error && <p role="alert" className="text-[14px] text-red-700">{error}</p>}
      {message && <p role="status" className="text-[14px] text-green-800">{message}</p>}
      <button onClick={() => void save()} disabled={busy || processing !== null} className="inline-flex items-center gap-2 rounded-lg bg-[#062444] px-5 py-2.5 text-[14px] font-bold text-white hover:bg-[#0a3a6e] disabled:opacity-60">
        {busy && <Loader2 size={15} className="animate-spin" aria-hidden="true" />} Save certificate settings
      </button>
    </div>
  );
}
