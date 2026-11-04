import { useState } from "react";
import { Building2, CheckCircle2, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { SchoolDialog } from "./SchoolDialog";
import { removeSchoolLogo, saveSchoolLogo } from "../logoApi";
import type { SchoolLogoState } from "../useSchoolLogo";
import { LOGO_ACCEPT, logoFileProblem, prepareLogo } from "@/lib/logoImage";
import { focusRing } from "./portalParts";

/** The school's logo as a round picture (its profile picture), or a plain building when it has none. With `onClick` it is a button that opens the logo dialog. */
export function SchoolLogoAvatar({ base64, size = 56, onClick }: { base64: string | null; size?: number; onClick?: () => void }) {
  const inner = base64
    ? <img src={`data:image/png;base64,${base64}`} alt="" className="h-full w-full object-contain" />
    : <Building2 size={Math.round(size * 0.45)} className="text-[#062444]/60" aria-hidden="true" />;
  const cls = "flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#062444]/25 bg-white";
  if (!onClick) return <span className={cls} style={{ width: size, height: size }}>{inner}</span>;
  return (
    <button type="button" onClick={onClick} className={`${cls} relative hover:border-[#0077b6] ${focusRing}`} style={{ width: size, height: size }}
      aria-label={base64 ? "Your school's logo. Press to change it." : "Add your school's logo"} title={base64 ? "Change your school's logo" : "Add your school's logo"}>
      {inner}
    </button>
  );
}

/** Upload, change or remove the school's logo. It is the school's profile picture and the logo printed on the clearances. */
export function SchoolLogoDialog({ logo, onClose, returnFocusTo }: { logo: SchoolLogoState; onClose: () => void; returnFocusTo?: React.RefObject<HTMLElement | null> }) {
  const [busy, setBusy] = useState<"" | "saving" | "removing">("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(""); setDone("");
    const problem = logoFileProblem(file);
    if (problem) { setError(problem); return; }
    setBusy("saving");
    try {
      const prepared = await prepareLogo(file);
      const r = await saveSchoolLogo(prepared.base64);
      if (!r.ok) { setError(r.missing ? "CEDO still has to run a database update before a logo can be saved." : r.error); }
      else { logo.setBase64(prepared.base64); setDone("Your logo is saved. It is now your profile picture and it is printed on the clearances."); }
    } catch (e) {
      setError(`Couldn't use that picture: ${e instanceof Error ? e.message : String(e)}`);
    }
    setBusy("");
  }

  /** The picture picker is made when the button is pressed (not kept on the page), so the dialog's own focus handling is not confused by a hidden field. */
  function choose() {
    const input = document.createElement("input");
    input.type = "file"; input.accept = LOGO_ACCEPT;
    input.onchange = () => void onFile(input.files?.[0]);
    input.click();
  }

  async function remove() {
    setError(""); setDone(""); setBusy("removing");
    const r = await removeSchoolLogo();
    setBusy("");
    if (!r.ok) { setError(r.error); return; }
    logo.setBase64(null);
    setDone("Your logo was removed. The clearances print without a school logo.");
  }

  return (
    <SchoolDialog title="School logo" onClose={onClose} returnFocusTo={returnFocusTo}>
      <div className="mb-4 flex items-center gap-4">
        <SchoolLogoAvatar base64={logo.base64} size={96} />
        <p className="text-[14.5px] text-slate-800">
          This is your school's <strong>profile picture</strong> in the School Portal, and it is printed in the header of the pre-filled <strong>clearances</strong>, next to the CEDO logo.
          A square picture with a plain or transparent background looks best.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={choose} disabled={busy !== "" || logo.missing}
          className={`inline-flex items-center gap-2 rounded-lg bg-[#062444] px-4 py-2.5 text-[14px] font-semibold text-white disabled:opacity-60 ${focusRing}`}>
          {busy === "saving" ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <ImagePlus size={15} aria-hidden="true" />} {logo.base64 ? "Change logo" : "Upload logo"}
        </button>
        {logo.base64 && (
          <button type="button" onClick={() => void remove()} disabled={busy !== ""}
            className={`inline-flex items-center gap-2 rounded-lg border border-red-700/50 bg-white px-4 py-2.5 text-[14px] font-semibold text-red-800 disabled:opacity-60 ${focusRing}`}>
            {busy === "removing" ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Trash2 size={15} aria-hidden="true" />} Remove logo
          </button>
        )}
        <button type="button" onClick={onClose} className={`ml-auto rounded-lg border border-[#062444]/40 px-4 py-2.5 text-[14px] font-semibold text-[#062444] ${focusRing}`}>Close</button>
      </div>
      <p className="mt-2 text-[13.5px] text-slate-700">PNG, JPG or WebP, up to 5 MB. The picture is shrunk before it is saved.</p>
      {logo.missing && <p role="status" className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[14px] text-amber-950">The logo needs a database update from CEDO (supabase_migration_school_logo.sql). Until it is done, a logo cannot be saved.</p>}
      {error && <p role="alert" className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[14px] text-red-800">{error}</p>}
      {done && <p role="status" className="mt-3 flex items-start gap-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-[14px] font-semibold text-green-800"><CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden="true" /> {done}</p>}
    </SchoolDialog>
  );
}
