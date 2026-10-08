import type { SurveyStatus } from "../mySurveysApi";

const STATUS_STYLES: Record<SurveyStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-slate-100 text-slate-600" },
  open: { label: "Open", className: "bg-green-100 text-green-700" },
  closed: { label: "Closed", className: "bg-amber-100 text-amber-700" },
};

export function SurveyStatusBadge({ status }: { status: SurveyStatus }) {
  const style = STATUS_STYLES[status];
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold ${style.className}`}>{style.label}</span>;
}
