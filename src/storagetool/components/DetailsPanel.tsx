import { useEffect, useState } from "react";
import { HardDrive, Loader2, X, Folder } from "lucide-react";
import { fetchDetails, type ItemDetails } from "../storageToolOrganizeApi";
import { countWords, effectiveMime, formatBytes, typeLabel } from "../storageToolLogic";
import { FileTypeIcon } from "./FileTypeIcon";

const dateText = (iso: string) => (iso ? new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

/**
 * The details panel on the right: for the one item that is selected, or for the folder that is open when nothing (or several items) is selected.
 * `target` changes whenever the selection or the open folder changes; `refreshKey` makes it read again after a rename or an upload.
 */
export function DetailsPanel({ target, refreshKey, onClose }: { target: { kind: "file" | "folder" | "root"; id: string | null; mime?: string; name?: string }; refreshKey: number; onClose: () => void }) {
  const [data, setData] = useState<ItemDetails | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setData(null); setError("");
    void fetchDetails(target.kind, target.id).then(r => { if (cancelled) return; if (r.ok) setData(r.value); else setError(r.error); });
    return () => { cancelled = true; };
  }, [target.kind, target.id, refreshKey]);

  const rowCls = "flex justify-between gap-3 py-1.5 text-[14px]";
  const label = "shrink-0 text-slate-700", value = "min-w-0 break-words text-right font-semibold text-[#062444]";
  return (
    <aside aria-label="Details" className="w-full shrink-0 rounded-xl border border-[#e6ecf5] bg-white lg:w-72">
      <header className="flex items-center justify-between gap-2 border-b border-[#e6ecf5] px-4 py-3">
        <h2 className="text-[15px] font-bold text-[#062444]">Details</h2>
        <button onClick={onClose} aria-label="Close the details" className="rounded p-1 text-slate-700 hover:bg-[#f7f9fc]"><X size={17} aria-hidden="true" /></button>
      </header>
      <div className="px-4 py-3">
        {!data && !error && <p className="flex items-center gap-2 text-[14px] text-slate-700"><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Loading…</p>}
        {error && <p role="alert" className="text-[14px] text-red-700">{error}</p>}
        {data && (
          <>
            <div className="mb-2 flex items-center gap-2.5">
              {data.kind === "file" ? <FileTypeIcon mime={data.mimeType} name={data.name} size={28} /> : data.kind === "folder" ? <Folder size={28} className="fill-amber-200 text-amber-700" aria-hidden="true" /> : <HardDrive size={28} className="text-[#062444]" aria-hidden="true" />}
              <p className="break-all text-[15px] font-bold text-[#062444]">{data.name}</p>
            </div>
            <dl className="divide-y divide-[#e6ecf5]">
              <div className={rowCls}><dt className={label}>Kind</dt><dd className={value}>{data.kind === "file" ? typeLabel(data.mimeType, data.name) : data.kind === "folder" ? "Folder" : "Your storage"}</dd></div>
              {data.kind === "file" && <div className={rowCls}><dt className={label}>Format</dt><dd className={value}>{effectiveMime(data.mimeType, data.name)}</dd></div>}
              <div className={rowCls}><dt className={label}>Size</dt><dd className={value}>{formatBytes(data.sizeBytes)}</dd></div>
              {data.kind !== "file" && <div className={rowCls}><dt className={label}>Contains</dt><dd className={value}>{countWords(data.files, "file", "files")}, {countWords(data.folders, "folder", "folders")}</dd></div>}
              {data.kind !== "root" && <div className={rowCls}><dt className={label}>Location</dt><dd className={value}>{data.location}</dd></div>}
              {data.kind === "file" && <div className={rowCls}><dt className={label}>Uploaded by</dt><dd className={value}>{data.uploadedBy}</dd></div>}
              {data.kind !== "root" && <div className={rowCls}><dt className={label}>{data.kind === "file" ? "Uploaded" : "Created"}</dt><dd className={value}>{dateText(data.createdAt)}</dd></div>}
              {data.kind !== "root" && <div className={rowCls}><dt className={label}>Last modified</dt><dd className={value}>{dateText(data.modifiedAt)}</dd></div>}
            </dl>
          </>
        )}
      </div>
    </aside>
  );
}
