import { Video } from "lucide-react";
import { BatchVideoUpload } from "./BatchVideoUpload";

/**
 * Staff tool gated by the "kauban_content" tag (see src/app/staffToolTags.ts).
 * Manages the content Kauban's public /kauban/ pages read from Supabase —
 * sign words + videos, quick phrases, emergency content. Only the batch
 * video compressor/uploader is built so far (docs/kauban/MILESTONES.md,
 * milestone 8 in progress); Quick Phrases and Emergency Content management
 * (milestones 9-10) will land here as additional sections.
 */
export function KaubanContentManagementPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#062444] text-white"><Video size={18} /></div>
        <div>
          <h2 className="text-base font-bold text-[#062444]">Kauban Content Management</h2>
          <p className="text-[12px] text-slate-500">Compress and upload sign-language videos for the Kauban app.</p>
        </div>
      </div>

      <BatchVideoUpload />
    </div>
  );
}
