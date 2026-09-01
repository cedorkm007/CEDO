import { useState } from "react";
import { Video, UploadCloud, LibraryBig, MessageSquareText, Siren } from "lucide-react";
import { BatchVideoUpload } from "./BatchVideoUpload";
import { VideoLibrary } from "./VideoLibrary";
import { QuickPhrasesManager } from "./QuickPhrasesManager";
import { EmergencyContentManager } from "./EmergencyContentManager";

type Tab = "upload" | "library" | "phrases" | "emergency";

/**
 * Staff tool gated by the "kauban_content" tag (see src/app/staffToolTags.ts).
 * Manages every piece of content Kauban's public /kauban/ pages read from
 * Supabase — sign words + videos, quick phrases, emergency content. This
 * covers all of docs/kauban/MILESTONES.md's Admin CMS milestones (7-10).
 */
export function KaubanContentManagementPage() {
  const [tab, setTab] = useState<Tab>("upload");

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#062444] text-white"><Video size={18} /></div>
        <div>
          <h2 className="text-base font-bold text-[#062444]">Kauban Content Management</h2>
          <p className="text-[12px] text-slate-500">Videos, sign words, quick phrases, and emergency content for the Kauban app.</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
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
        <button
          onClick={() => setTab("phrases")}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold ${tab === "phrases" ? "border-[#062444] bg-[#062444] text-white" : "border-[#e6ecf5] text-slate-500"}`}
        >
          <MessageSquareText size={13} /> Quick Phrases
        </button>
        <button
          onClick={() => setTab("emergency")}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold ${tab === "emergency" ? "border-[#062444] bg-[#062444] text-white" : "border-[#e6ecf5] text-slate-500"}`}
        >
          <Siren size={13} /> Emergency Content
        </button>
      </div>

      {tab === "upload" && <BatchVideoUpload />}
      {tab === "library" && <VideoLibrary />}
      {tab === "phrases" && <QuickPhrasesManager />}
      {tab === "emergency" && <EmergencyContentManager />}
    </div>
  );
}
