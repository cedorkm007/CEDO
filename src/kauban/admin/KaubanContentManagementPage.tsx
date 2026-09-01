import { useState } from "react";
import { Video, UploadCloud, LibraryBig } from "lucide-react";
import { BatchVideoUpload } from "./BatchVideoUpload";
import { VideoLibrary } from "./VideoLibrary";

type Tab = "upload" | "library";

/**
 * Staff tool gated by the "kauban_content" tag (see src/app/staffToolTags.ts).
 * Manages the content Kauban's public /kauban/ pages read from Supabase —
 * sign words + videos, quick phrases, emergency content. Quick Phrases and
 * Emergency Content management (docs/kauban/MILESTONES.md, milestones 9-10)
 * will land here as additional tabs.
 */
export function KaubanContentManagementPage() {
  const [tab, setTab] = useState<Tab>("upload");

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#062444] text-white"><Video size={18} /></div>
        <div>
          <h2 className="text-base font-bold text-[#062444]">Kauban Content Management</h2>
          <p className="text-[12px] text-slate-500">Compress, upload, and monitor sign-language videos for the Kauban app.</p>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setTab("upload")}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold ${tab === "upload" ? "border-[#062444] bg-[#062444] text-white" : "border-[#e6ecf5] text-slate-500"}`}
        >
          <UploadCloud size={13} /> Upload Videos
        </button>
        <button
          onClick={() => setTab("library")}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold ${tab === "library" ? "border-[#062444] bg-[#062444] text-white" : "border-[#e6ecf5] text-slate-500"}`}
        >
          <LibraryBig size={13} /> Video Library
        </button>
      </div>

      {tab === "upload" ? <BatchVideoUpload /> : <VideoLibrary />}
    </div>
  );
}
