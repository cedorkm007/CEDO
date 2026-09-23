import { PenLine } from "lucide-react";
import type { QueuedReferral, SubjectMatrixRow } from "../referralApi";

function checkbox(checked: boolean) {
  return <span className="inline-block w-3.5 h-3.5 border border-[#062444]/40 rounded-[2px] mr-1 align-middle relative top-[-1px]">{checked && <span className="absolute inset-0 flex items-center justify-center text-[10px] leading-none text-[#062444]">✓</span>}</span>;
}

function subjectTable(label: string, rows: SubjectMatrixRow[]) {
  const filled = rows.filter(r => r.subjectCode || r.semesterAcademicYear || r.yearLevel);
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">{label}</p>
      {filled.length === 0 ? (
        <p className="text-[12.5px] text-slate-400 italic">None</p>
      ) : (
        <table className="w-full text-[12px] border-collapse">
          <thead>
            <tr className="text-left text-slate-400">
              <th className="font-semibold pb-1 pr-2">Subject Code</th>
              <th className="font-semibold pb-1 pr-2">Semester &amp; Academic Year</th>
              <th className="font-semibold pb-1">Yr. Lvl</th>
            </tr>
          </thead>
          <tbody>
            {filled.map((r, i) => (
              <tr key={i} className="border-t border-[#e6ecf5]">
                <td className="py-1 pr-2 text-[#062444]">{r.subjectCode || "—"}</td>
                <td className="py-1 pr-2 text-[#062444]">{r.semesterAcademicYear || "—"}</td>
                <td className="py-1 text-[#062444]">{r.yearLevel || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * A purpose-built preview of the Referral Form for the Division Head's
 * approval step — not a render of the actual printed .docx (see
 * referralFormTemplate.ts for that), but a document-shaped summary that
 * updates live as a signature is attached, so approval isn't just abstract
 * form fields. The real signed .docx is generated separately after
 * approval via "Print Signed Referral".
 */
export function ReferralFormPreview({
  referral, signatureUrl, approverName,
}: {
  referral: QueuedReferral;
  signatureUrl: string | null;
  approverName: string;
}) {
  const courseYear = `${referral.course || "—"} / ${referral.yearLevel || "—"}`;
  const referralDate = referral.referralDate ? new Date(`${referral.referralDate}T00:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "—";

  return (
    <div className="bg-white border border-[#062444]/15 rounded-xl overflow-hidden">
      <div className="bg-[#062444] text-white px-4 py-2.5">
        <p className="text-[12.5px] font-bold tracking-wide">REFERRAL FORM — PREVIEW</p>
      </div>

      <div className="p-4 space-y-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px]">
          <div><span className="text-slate-400">Name: </span><span className="font-semibold text-[#062444]">{referral.name}</span></div>
          <div><span className="text-slate-400">Course &amp; Yr. Level: </span><span className="font-semibold text-[#062444]">{courseYear}</span></div>
          <div><span className="text-slate-400">School: </span><span className="font-semibold text-[#062444]">{referral.school || "—"}</span></div>
          <div><span className="text-slate-400">Barangay: </span><span className="font-semibold text-[#062444]">{referral.barangay || "—"}</span></div>
          <div><span className="text-slate-400">Contact No.: </span><span className="font-semibold text-[#062444]">{referral.contactNo || "—"}</span></div>
        </div>

        <div className="text-[12.5px] text-[#062444]">
          <span className="text-slate-400 mr-1">Previous Semester Status:</span>
          {checkbox(referral.previousSemesterStatus === "Retained")} Retained &nbsp;
          {checkbox(referral.previousSemesterStatus === "On Probation")} On Probation &nbsp;
          {checkbox(referral.previousSemesterStatus === "Special Recon")} Special Reconsideration
        </div>

        {subjectTable("Failed Subjects (since admission)", referral.failedSubjects)}
        {subjectTable("Lacking Grades", referral.lackingGrades)}

        {referral.remarks && (
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Remarks</p>
            <p className="text-[12.5px] text-[#062444] whitespace-pre-wrap">{referral.remarks}</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px] border-t border-[#e6ecf5] pt-3">
          <div><span className="text-slate-400">Referred by: </span><span className="font-semibold text-[#062444]">{referral.referredByName || "—"}</span></div>
          <div><span className="text-slate-400">Date: </span><span className="font-semibold text-[#062444]">{referralDate}</span></div>
        </div>

        <div className="text-[12.5px] text-[#062444]">
          <span className="text-slate-400 mr-1">Endorsed for:</span>
          {checkbox(referral.endorsedFor === "On Probation Status")} On Probation Status &nbsp;
          {checkbox(referral.endorsedFor === "Removal")} Removal &nbsp;
          {checkbox(referral.endorsedFor === "Renewal")} Renewal
        </div>

        <div className="flex items-center gap-4 border-t border-[#e6ecf5] pt-3">
          <div className="w-40 h-20 shrink-0 border border-dashed border-[#e6ecf5] rounded-lg flex items-center justify-center bg-[#f8fafd]">
            {signatureUrl ? (
              <img src={signatureUrl} alt="Attached signature" className="max-w-full max-h-full object-contain" />
            ) : (
              <PenLine size={20} className="text-slate-300" />
            )}
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Noted by</p>
            <p className="text-[13px] font-semibold text-[#062444]">{approverName || "—"}</p>
            <p className="text-[11.5px] text-slate-500">SEAD Division Head</p>
          </div>
        </div>
      </div>
    </div>
  );
}
