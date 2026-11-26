import type { SurveyTriggers } from "../../types";

const CHOICES: { key: keyof SurveyTriggers; label: string; note: string }[] = [
  { key: "qr", label: "QR scan or typed code by the scholar (Time Out or voucher)", note: "The survey pops up. The credit waits until it is finished (or declined, if voluntary)." },
  { key: "scanner", label: "Scanning Tools (a monitor scans the scholar's ID, Time Out or voucher)", note: "The monitor sees the usual success message. The scholar sees a \"Finish the survey\" banner, and the credit waits." },
  { key: "manual", label: "Manual credit by staff (including \"Credit selected\" and \"Credit these scholars\")", note: "The credit is given at once. The scholar is asked afterwards through the banner." },
  { key: "picture", label: "Picture-confirmed attendance approval", note: "The credit is given at once. The scholar is asked afterwards through the banner." },
  { key: "reconsideration", label: "SDP reconsideration", note: "Asked when a scholar sends a reconsideration request. The request does not wait. Only one survey can have this." },
];

export function TriggerChoices({ value, onChange, reconsiderationHolder }: {
  value: SurveyTriggers; onChange: (next: SurveyTriggers) => void; reconsiderationHolder: string | null;
}) {
  return (
    <fieldset className="border-t border-[#f0f3f8] pt-3">
      <legend className="text-[12.5px] font-semibold text-slate-500">When to ask this survey</legend>
      <p className="mb-2 text-[11.5px] text-slate-500">A scholar is asked only once for each activity. Time In and file import never ask. Changes count from now on.</p>
      <div className="space-y-2">
        {CHOICES.map(c => (
          <label key={c.key} className="flex cursor-pointer items-start gap-2.5">
            <input type="checkbox" checked={value[c.key]} onChange={e => onChange({ ...value, [c.key]: e.target.checked })} className="mt-0.5 h-4 w-4 shrink-0 accent-[#062444]" />
            <span>
              <span className="block text-[12.5px] font-semibold text-[#062444]">{c.label}</span>
              <span className="block text-[11.5px] text-slate-500">{c.note}</span>
              {c.key === "reconsideration" && value.reconsideration && reconsiderationHolder && (
                <span className="mt-1 block rounded-lg bg-amber-50 px-2 py-1 text-[11.5px] font-semibold text-amber-900">
                  "{reconsiderationHolder}" is the reconsideration survey now. Saving moves it to this survey.
                </span>
              )}
            </span>
          </label>
        ))}
      </div>
      {value.reconsideration && <p className="mt-2 text-[11.5px] text-slate-500">A survey used only for reconsideration needs no activity.</p>}
    </fieldset>
  );
}
