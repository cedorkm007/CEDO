import { FileSpreadsheet, FileText, FileType2 } from "lucide-react";

/**
 * One color per export format, used everywhere a CSV/PDF/Word export
 * button appears across the site (Scholarship Program Info, Scholars
 * Information, Submission Monitoring, SDP Activities, the Task Tracker's
 * Accomplishment Report/History, bulk-upload templates, etc.) — until
 * now every one of those was its own hand-rolled button with its own
 * (usually identical, uncolored) styling. Colors are fixed, absolute
 * Tailwind classes rather than the app's theme tokens, deliberately: a
 * CSV button should look the same shade of green whether it's on a
 * page using the SEAD app's hardcoded-hex palette or the Task Tracker's
 * shadcn theme variables — the color is identifying the FILE TYPE, not
 * following whichever design system happens to surround it.
 *
 * Green/red/blue matches the everyday association with
 * Excel/Sheets, Acrobat/PDF, and Word respectively — the goal is for a
 * scholar or staff member to recognize "the blue one is Word" at a
 * glance without reading the label, the same way those apps' own icons
 * already read that way.
 */
export type ExportFormat = "csv" | "pdf" | "word";

const EXPORT_FORMAT_META: Record<ExportFormat, { label: string; Icon: typeof FileSpreadsheet; textClass: string; buttonClasses: string }> = {
  csv: {
    label: "CSV",
    Icon: FileSpreadsheet,
    textClass: "text-green-700",
    buttonClasses: "text-green-700 bg-green-50 border-green-200 hover:bg-green-100 disabled:hover:bg-green-50",
  },
  pdf: {
    label: "PDF",
    Icon: FileText,
    textClass: "text-red-700",
    buttonClasses: "text-red-700 bg-red-50 border-red-200 hover:bg-red-100 disabled:hover:bg-red-50",
  },
  word: {
    label: "Word",
    Icon: FileType2,
    textClass: "text-blue-700",
    buttonClasses: "text-blue-700 bg-blue-50 border-blue-200 hover:bg-blue-100 disabled:hover:bg-blue-50",
  },
};

const SIZE_CLASSES = {
  sm: { button: "text-[11.5px] px-2.5 py-1.5 gap-1.5", icon: 12 },
  md: { button: "text-[13px] px-4 py-2.5 gap-2", icon: 14 },
} as const;

/**
 * One export button, color-coded by format. `label` overrides the
 * default "CSV"/"PDF"/"Word" text (e.g. "Export CSV", "Download Word
 * (.docx)") without changing the color/icon convention. `busyLabel`
 * replaces the label while `busy` is true (defaults to "…").
 */
export function ExportButton({
  format, onClick, disabled, busy, label, busyLabel, size = "sm", className,
}: {
  format: ExportFormat;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  label?: string;
  busyLabel?: string;
  size?: keyof typeof SIZE_CLASSES;
  className?: string;
}) {
  const meta = EXPORT_FORMAT_META[format];
  const Icon = meta.Icon;
  const sizeClasses = SIZE_CLASSES[size];
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`inline-flex items-center rounded-lg border font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed ${sizeClasses.button} ${meta.buttonClasses} ${className ?? ""}`}>
      <Icon size={sizeClasses.icon} /> {busy ? (busyLabel ?? "…") : (label ?? meta.label)}
    </button>
  );
}

/**
 * Same color/icon convention as ExportButton, styled as a full-width
 * dropdown-menu row instead of a standalone pill button — for the
 * "click a name, choose a download format" menus rather than a
 * page/panel-level export toolbar.
 */
export function ExportMenuItem({ format, onClick, label }: { format: ExportFormat; onClick: () => void; label?: string }) {
  const meta = EXPORT_FORMAT_META[format];
  const Icon = meta.Icon;
  return (
    <button type="button" onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-2 text-[12px] font-normal text-left hover:bg-[#f8fafd] text-slate-700">
      <Icon size={13} className={meta.textClass} /> {label ?? `Download as ${meta.label}`}
    </button>
  );
}

/**
 * The common "Export CSV / Export PDF / Export Word" trio in one call —
 * used wherever all three formats are offered side by side. Pass
 * `busyFormat` (which one, if any, is currently exporting) rather than
 * three separate booleans; every button disables while any one of them
 * is busy, matching this app's existing "only one export at a time"
 * convention.
 */
export function ExportButtonGroup({
  onExportCsv, onExportPdf, onExportWord, busyFormat, disabled, labelPrefix = "", size = "sm",
}: {
  onExportCsv: () => void;
  onExportPdf: () => void;
  onExportWord: () => void;
  busyFormat?: ExportFormat | null;
  disabled?: boolean;
  /** e.g. "Export " to render "Export CSV" / "Export PDF" / "Export Word" instead of the bare format name. */
  labelPrefix?: string;
  size?: keyof typeof SIZE_CLASSES;
}) {
  const anyBusy = Boolean(busyFormat);
  return (
    <div className="flex items-center gap-2">
      <ExportButton format="csv" size={size} onClick={onExportCsv} disabled={disabled || anyBusy} busy={busyFormat === "csv"}
        label={`${labelPrefix}CSV`} busyLabel="Exporting…" />
      <ExportButton format="pdf" size={size} onClick={onExportPdf} disabled={disabled || anyBusy} busy={busyFormat === "pdf"}
        label={`${labelPrefix}PDF`} busyLabel="Exporting…" />
      <ExportButton format="word" size={size} onClick={onExportWord} disabled={disabled || anyBusy} busy={busyFormat === "word"}
        label={`${labelPrefix}Word`} busyLabel="Exporting…" />
    </div>
  );
}
