import { File as FileIcon, FileArchive, FileSpreadsheet, FileText, Image as ImageIcon, Music, Presentation, Video } from "lucide-react";
import { typeLabel } from "../storageToolLogic";

/** A small icon for a file, chosen by its type (the colours are dark enough to read on white). */
export function FileTypeIcon({ mime, name, size = 20, className = "" }: { mime: string; name: string; size?: number; className?: string }) {
  const kind = typeLabel(mime, name);
  const props = { size, "aria-hidden": true as const, className };
  switch (kind) {
    case "Image": return <ImageIcon {...props} className={`${className} text-emerald-700`} />;
    case "PDF": return <FileText {...props} className={`${className} text-red-700`} />;
    case "Video": return <Video {...props} className={`${className} text-purple-700`} />;
    case "Audio": return <Music {...props} className={`${className} text-pink-700`} />;
    case "Word": return <FileText {...props} className={`${className} text-blue-700`} />;
    case "Excel": return <FileSpreadsheet {...props} className={`${className} text-green-700`} />;
    case "PowerPoint": return <Presentation {...props} className={`${className} text-orange-700`} />;
    case "ZIP": return <FileArchive {...props} className={`${className} text-amber-700`} />;
    default: return <FileIcon {...props} className={`${className} text-slate-600`} />;
  }
}
