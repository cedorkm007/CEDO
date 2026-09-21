import { useEffect, useState } from "react";
import { AlertTriangle, Check, RotateCcw, Printer } from "lucide-react";
import { printApprovedReferral } from "../referralPrint";
import type { ScholarInformationRow } from "../seadApi";
import { SubjectMatrix } from "./SubjectMatrix";
import { SignatureUploadPanel } from "./SignatureUploadPanel";
import {
  PREVIOUS_SEMESTER_STATUSES, ENDORSED_FOR_OPTIONS, type PreviousSemesterStatus, type EndorsedFor,
  type SubjectMatrixRow, type StaffOption, type QueuedReferral,
  fetchCounselingStaffOptions, fetchMyStaffName, createReferral, fetchReferralById,
  forwardReferralToDivisionHead, approveReferral, requestReferralReconsideration, fetchSignatureUrl,
} from "../referralApi";

export type ReferralFormMode = "create" | "counsel" | "approve" | "view";

/** Probationary -> "On Probation", Reconsidered -> "Special Recon", anything else -> "Retained" — a sensible starting point the referring staff can still correct. */
function defaultPreviousSemesterStatus(status: ScholarInformationRow["status"]): PreviousSemesterStatus {
  if (status === "Probationary") return "On Probation";
  if (status === "Reconsidered") return "Special Recon";
  return "Retained";
}

function fieldLabel(children: React.ReactNode) {
  return <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-0.5">{children}</p>;
}
function readOnlyField(label: string, value: string) {
  return <div>{fieldLabel(label)}<p className="text-sm text-[#062444] font-medium">{value || "—"}</p></div>;
}

/**
 * The shared Referral Form (Form R5) content, for all 4 stages of the
 * workflow. Used both inside ReferralFormModal's own overlay (create /
 * counsel / view) and embedded directly inside the existing Notifications
 * detail modal (approve) — see App.tsx's AdminNotificationsPage.
 */
export function ReferralFormPanel({
  mode, scholar, referralId, onDone, onCancel,
}: {
  mode: ReferralFormMode;
  scholar?: ScholarInformationRow;
  referralId?: string;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const [loading, setLoading] = useState(mode !== "create");
  const [referral, setReferral] = useState<QueuedReferral | null>(null);

  // "create" mode fields
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
  const [myName, setMyName] = useState("");
  const [previousSemesterStatus, setPreviousSemesterStatus] = useState<PreviousSemesterStatus>("Retained");
  const [failedSubjects, setFailedSubjects] = useState<SubjectMatrixRow[]>([]);
  const [lackingGrades, setLackingGrades] = useState<SubjectMatrixRow[]>([]);
  const [referredTo, setReferredTo] = useState("");
  const [endorsedFor, setEndorsedFor] = useState<EndorsedFor>("On Probation Status");
  const [showConfirm, setShowConfirm] = useState(false);

  // "counsel" mode fields (also reused for endorsedFor editing there)
  const [remarks, setRemarks] = useState("");

  // "approve" mode fields
  const [signaturePath, setSignaturePath] = useState<string | null>(null);
  const [showReconsiderInput, setShowReconsiderInput] = useState(false);
  const [reconsiderReason, setReconsiderReason] = useState("");

  // The APPROVED signature, shown read-only once a referral has been
  // decided (mode "view" reached after approval) — distinct from the
  // "approve" mode's own SignatureUploadPanel, which is for attaching a
  // NEW signature before a decision is made.
  const [approvedSignatureUrl, setApprovedSignatureUrl] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);

  async function handlePrint() {
    if (!referral || printing) return;
    setPrinting(true);
    try { await printApprovedReferral(referral); } finally { setPrinting(false); }
  }

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (mode === "create" && scholar) {
      setPreviousSemesterStatus(defaultPreviousSemesterStatus(scholar.status));
      fetchCounselingStaffOptions().then(setStaffOptions);
      fetchMyStaffName().then(setMyName);
    } else if (referralId) {
      setLoading(true);
      fetchReferralById(referralId).then(r => {
        setReferral(r);
        if (r) {
          setRemarks(r.remarks);
          setEndorsedFor(r.endorsedFor);
          if (r.status === "approved" && r.signaturePath) fetchSignatureUrl(r.signaturePath).then(setApprovedSignatureUrl);
        }
        setLoading(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, referralId]);

  async function handleCreate() {
    if (!scholar || !referredTo) { setError("Choose who to refer this scholar to."); return; }
    setBusy(true);
    setError("");
    const result = await createReferral({
      scholarIdNumber: scholar.scholarIdNumber, referredTo, previousSemesterStatus,
      failedSubjects: failedSubjects.filter(r => r.subjectCode || r.semesterAcademicYear || r.yearLevel),
      lackingGrades: lackingGrades.filter(r => r.subjectCode || r.semesterAcademicYear || r.yearLevel),
      endorsedFor,
    });
    setBusy(false);
    if (!result.ok) { setError(result.error || "Failed to create the referral."); return; }
    setShowConfirm(false);
    onDone();
  }

  async function handleForward() {
    if (!referral) return;
    setBusy(true);
    setError("");
    const result = await forwardReferralToDivisionHead(referral.id, remarks.trim(), endorsedFor);
    setBusy(false);
    if (!result.ok) { setError(result.error || "Failed to forward this referral."); return; }
    onDone();
  }

  async function handleApprove() {
    if (!referral || !signaturePath) { setError("Attach a signature first."); return; }
    setBusy(true);
    setError("");
    const result = await approveReferral(referral.id, signaturePath);
    setBusy(false);
    if (!result.ok) { setError(result.error || "Failed to approve this referral."); return; }
    onDone();
  }

  async function handleReconsider() {
    if (!referral || !reconsiderReason.trim()) return;
    setBusy(true);
    setError("");
    const result = await requestReferralReconsideration(referral.id, reconsiderReason.trim());
    setBusy(false);
    if (!result.ok) { setError(result.error || "Failed to send this back for reconsideration."); return; }
    onDone();
  }

  if (loading) return <p className="text-center text-slate-400 py-10">Loading…</p>;

  const name = mode === "create" && scholar ? [scholar.firstName, scholar.middleName, scholar.lastName].filter(Boolean).join(" ") : referral?.name ?? "";
  const courseYear = mode === "create" && scholar ? `${scholar.course || "—"} / ${scholar.yearLevel || "—"}` : `${referral?.course || "—"} / ${referral?.yearLevel || "—"}`;
  const school = mode === "create" && scholar ? scholar.school : referral?.school ?? "";
  const barangay = mode === "create" && scholar ? scholar.barangay : referral?.barangay ?? "";
  const contactNo = mode === "create" && scholar ? scholar.contactNo : referral?.contactNo ?? "";
  const referralDate = mode === "create" ? new Date().toLocaleDateString() : referral?.referralDate ? new Date(`${referral.referralDate}T00:00:00`).toLocaleDateString() : "";
  const referredByName = mode === "create" ? myName : referral?.referredByName ?? "";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 bg-white border border-[#e6ecf5] rounded-xl p-4">
        {readOnlyField("Name", name)}
        {readOnlyField("Course & Yr. Level", courseYear)}
        {readOnlyField("School", school)}
        {readOnlyField("Barangay", barangay)}
        {readOnlyField("Contact Number", contactNo)}
        {readOnlyField("Refer By", referredByName)}
        {readOnlyField("Date", referralDate)}
      </div>

      {referral?.reconsiderationReason && mode === "counsel" && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3.5 py-3">
          <AlertTriangle size={15} className="text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-[12.5px] font-bold text-amber-700">Sent back for reconsideration</p>
            <p className="text-[12.5px] text-amber-700">{referral.reconsiderationReason}</p>
          </div>
        </div>
      )}

      <div>
        {fieldLabel("Previous Semester Status")}
        {mode === "create" ? (
          <select value={previousSemesterStatus} onChange={e => setPreviousSemesterStatus(e.target.value as PreviousSemesterStatus)}
            className="w-full border border-[#062444]/15 rounded-lg px-3 py-2 text-sm outline-none bg-white">
            {PREVIOUS_SEMESTER_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        ) : (
          <p className="text-sm text-[#062444] font-medium">{referral?.previousSemesterStatus}</p>
        )}
      </div>

      <SubjectMatrix label="Failed Subjects (since admission)"
        rows={mode === "create" ? failedSubjects : referral?.failedSubjects ?? []}
        onChange={setFailedSubjects} readOnly={mode !== "create"} />

      <SubjectMatrix label="Lacking Grades"
        rows={mode === "create" ? lackingGrades : referral?.lackingGrades ?? []}
        onChange={setLackingGrades} readOnly={mode !== "create"} />

      <div>
        {fieldLabel("Refer To")}
        {mode === "create" ? (
          <select value={referredTo} onChange={e => setReferredTo(e.target.value)}
            className="w-full border border-[#062444]/15 rounded-lg px-3 py-2 text-sm outline-none bg-white">
            <option value="">Select a counseling staff member…</option>
            {staffOptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        ) : (
          <p className="text-sm text-[#062444] font-medium">—</p>
        )}
      </div>

      <div>
        {fieldLabel("Endorsed For")}
        {mode === "create" || mode === "counsel" ? (
          <div className="flex gap-4">
            {ENDORSED_FOR_OPTIONS.map(opt => (
              <label key={opt} className="flex items-center gap-1.5 text-[13px] text-[#062444]">
                <input type="radio" name="endorsedFor" checked={endorsedFor === opt} onChange={() => setEndorsedFor(opt)} /> {opt}
              </label>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[#062444] font-medium">{referral?.endorsedFor}</p>
        )}
      </div>

      <div>
        {fieldLabel("Remarks")}
        {mode === "counsel" ? (
          <textarea value={remarks} onChange={e => setRemarks(e.target.value)} rows={4}
            placeholder="Add your counseling remarks before forwarding…"
            className="w-full border border-[#062444]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-[#0088cc] resize-none" />
        ) : (
          <p className="text-sm text-[#062444] whitespace-pre-wrap">{referral?.remarks || "—"}</p>
        )}
      </div>

      {referral?.status === "approved" && (
        <div>
          {fieldLabel("Noted By")}
          <div className="flex items-center gap-4 bg-white border border-[#e6ecf5] rounded-lg p-3">
            <div className="w-40 h-20 shrink-0 border border-dashed border-[#e6ecf5] rounded-lg flex items-center justify-center bg-[#f8fafd]">
              {approvedSignatureUrl ? (
                <img src={approvedSignatureUrl} alt="Approver's signature" className="max-w-full max-h-full object-contain" />
              ) : (
                <p className="text-[11px] text-slate-400">No signature on file</p>
              )}
            </div>
            <div>
              <p className="text-sm font-semibold text-[#062444]">{referral.approvedByName || "—"}</p>
              <p className="text-[11.5px] text-slate-500">SEAD Division Head</p>
              {referral.approvedAt && (
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Approved {new Date(referral.approvedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                </p>
              )}
            </div>
          </div>
          {mode === "view" && (
            <button type="button" onClick={handlePrint} disabled={printing}
              className="mt-3 flex items-center gap-1.5 rounded-lg border border-[#062444]/15 text-[#062444] text-[12.5px] font-semibold px-3.5 py-2 hover:bg-[#f8fafd] disabled:opacity-60">
              <Printer size={13} className="text-[#0088cc]" /> {printing ? "Preparing…" : "Print Signed Referral"}
            </button>
          )}
        </div>
      )}

      {mode === "approve" && <SignatureUploadPanel onReady={setSignaturePath} />}

      {error && <p className="text-[13px] text-red-600">{error}</p>}

      {mode === "create" && (
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onCancel} className="px-4 py-2.5 rounded-lg border border-[#062444]/15 text-[#062444] text-[13px] font-semibold hover:bg-[#f8fafd]">Cancel</button>
          <button type="button" onClick={() => setShowConfirm(true)} disabled={!referredTo}
            className="px-5 py-2.5 rounded-lg bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-50 text-white text-[13px] font-semibold">Done</button>
        </div>
      )}

      {mode === "counsel" && (
        <div className="flex justify-end pt-2">
          <button type="button" onClick={handleForward} disabled={busy}
            className="px-5 py-2.5 rounded-lg bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-60 text-white text-[13px] font-semibold">
            {busy ? "Forwarding…" : "Forward to Division Head"}
          </button>
        </div>
      )}

      {mode === "approve" && (
        <div className="space-y-3 border-t border-[#e6ecf5] pt-3">
          {showReconsiderInput ? (
            <div className="space-y-2">
              <textarea value={reconsiderReason} onChange={e => setReconsiderReason(e.target.value)} rows={3}
                placeholder="Reason for reconsideration (required)…"
                className="w-full border border-[#062444]/15 rounded-lg px-3 py-2 text-sm outline-none focus:border-red-400 resize-none" />
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowReconsiderInput(false)} className="flex-1 py-2.5 rounded-lg border border-[#062444]/15 text-[13px] font-semibold text-[#062444] hover:bg-[#f8fafd]">Cancel</button>
                <button type="button" onClick={handleReconsider} disabled={!reconsiderReason.trim() || busy}
                  className="flex-1 py-2.5 rounded-lg bg-red-500 disabled:opacity-50 text-white text-[13px] font-semibold hover:bg-red-600">Confirm Reconsideration</button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => setShowReconsiderInput(true)}
                className="py-2.5 rounded-lg border-2 border-red-200 text-red-600 text-[13px] font-semibold hover:bg-red-50 flex items-center justify-center gap-2">
                <RotateCcw size={14} /> Reconsider
              </button>
              <button type="button" onClick={handleApprove} disabled={!signaturePath || busy}
                className="py-2.5 rounded-lg bg-green-500 disabled:opacity-50 text-white text-[13px] font-semibold hover:bg-green-600 flex items-center justify-center gap-2">
                <Check size={14} /> Approve
              </button>
            </div>
          )}
        </div>
      )}

      {showConfirm && (
        <div className="fixed inset-0 z-[110] bg-black/40 flex items-center justify-center px-4" onClick={() => setShowConfirm(false)}>
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-5" onClick={e => e.stopPropagation()}>
            <p className="text-[14px] font-bold text-[#062444] mb-1.5">Refer {name}?</p>
            <p className="text-[13px] text-slate-500 mb-4">This will notify {staffOptions.find(s => s.id === referredTo)?.name ?? "the selected staff member"} to begin counseling.</p>
            {error && <p className="text-[12.5px] text-red-600 mb-3">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowConfirm(false)} className="px-4 py-2 rounded-lg border border-[#062444]/15 text-[13px] font-semibold text-[#062444] hover:bg-[#f8fafd]">Cancel</button>
              <button type="button" onClick={handleCreate} disabled={busy}
                className="px-4 py-2 rounded-lg bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-60 text-white text-[13px] font-semibold">
                {busy ? "Referring…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
