import { useCallback, useEffect, useMemo, useState } from "react";
import { School, Lock, Unlock, Clock } from "lucide-react";
import { Modal } from "../components/Modal";
import {
  fetchSchoolsCompletion, fetchProgramsCompletion,
  type GradingPeriod, type SchoolCompletionRow, type ProgramCompletionRow,
} from "../scholarsGradesMonitoringApi";
import { fetchSubmissionOverview, reopenSubmission, type SubmissionOverviewRow } from "../gradesReviewApi";
import { formatDay } from "@/lib/gradeEvidence";

function percentColor(pct: number): string {
  if (pct >= 80) return "text-green-700";
  if (pct >= 50) return "text-amber-700";
  return "text-red-700";
}

/** A school's submission state for the viewed period, shown beside its completion %: Submitted / Reopened / Not submitted. */
function SubmissionBadge({ row }: { row: SubmissionOverviewRow | undefined }) {
  if (row?.status === "submitted") {
    return <span className="inline-flex items-center gap-1 text-[12.5px] font-bold text-green-900 bg-green-50 border border-green-300 rounded-full px-2.5 py-0.5"><Lock size={12} aria-hidden="true" /> Submitted {formatDay(row.submittedAt)}</span>;
  }
  if (row?.status === "reopened") {
    return <span className="inline-flex items-center gap-1 text-[12.5px] font-bold text-amber-900 bg-amber-50 border border-amber-300 rounded-full px-2.5 py-0.5"><Unlock size={12} aria-hidden="true" /> Reopened</span>;
  }
  return <span className="inline-flex items-center gap-1 text-[12.5px] font-bold text-slate-800 bg-slate-100 border border-slate-300 rounded-full px-2.5 py-0.5"><Clock size={12} aria-hidden="true" /> Not submitted</span>;
}

/**
 * Each school's completion % for the viewed period, now with its submission status beside it (and how many correction
 * requests are waiting). Opening a school lists its programs and — if it has submitted — lets staff reopen the submission
 * (with a reason) so the school can add/remove subjects and submit again.
 */
export function ScholarsGradesMonitoringSchoolsTab({ period, periodId }: { period: GradingPeriod; periodId: string | null }) {
  const [schools, setSchools] = useState<SchoolCompletionRow[]>([]);
  const [overview, setOverview] = useState<Map<string, SubmissionOverviewRow>>(new Map());
  const [overviewError, setOverviewError] = useState("");
  const [loading, setLoading] = useState(true);
  const [openSchool, setOpenSchool] = useState<SchoolCompletionRow | null>(null);

  const load = useCallback(async () => {
    const [rows, ov] = await Promise.all([fetchSchoolsCompletion(period), fetchSubmissionOverview(period)]);
    setSchools(rows);
    if (ov.ok) { setOverview(new Map(ov.rows.map(r => [r.schoolId, r]))); setOverviewError(""); }
    else setOverviewError(ov.error);
    setLoading(false);
  }, [period]);

  useEffect(() => { setLoading(true); void load(); }, [load]);

  if (loading) return <p className="text-[13px] text-slate-600 text-center py-10">Loading…</p>;

  if (schools.length === 0) {
    return <p className="text-[13px] text-slate-600 text-center py-10">No schools found. Schools are backfilled from scholars' existing school field — check the schools table.</p>;
  }

  return (
    <div>
      {overviewError && <p role="alert" className="text-[13px] text-red-700 mb-3">Couldn't load submission status: {overviewError} (has the Phase 6 migration been run?)</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {schools.map(s => {
          const sub = overview.get(s.schoolId);
          return (
            <button
              key={s.schoolId}
              onClick={() => setOpenSchool(s)}
              className="text-left bg-white border border-[#e6ecf5] rounded-xl p-4 hover:border-[#0088cc]/40 hover:shadow-sm transition-all"
            >
              <div className="flex items-center gap-2 mb-2">
                <School size={15} className="text-[#0088cc] shrink-0" aria-hidden="true" />
                <span className="font-bold text-[13.5px] text-[#062444] truncate">{s.schoolName}</span>
              </div>
              <p className={`text-2xl font-extrabold ${percentColor(s.percentComplete)}`}>{s.percentComplete}%</p>
              <p className="text-[13px] text-slate-700 mb-2">{s.completeScholars} of {s.totalScholars} scholars complete</p>
              <div className="flex flex-wrap items-center gap-2">
                <SubmissionBadge row={sub} />
                {!!sub?.pendingRequests && (
                  <span className="text-[12.5px] font-bold text-amber-900 bg-amber-50 border border-amber-300 rounded-full px-2.5 py-0.5">
                    {sub.pendingRequests} correction request{sub.pendingRequests === 1 ? "" : "s"}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {openSchool && (
        <ProgramsModal school={openSchool} period={period} periodId={periodId} submission={overview.get(openSchool.schoolId)}
          onClose={() => setOpenSchool(null)} onChanged={() => void load()} />
      )}
    </div>
  );
}

function ReopenForm({ schoolName, onCancel, onConfirm, busy, error }: {
  schoolName: string; onCancel: () => void; onConfirm: (note: string) => void; busy: boolean; error: string;
}) {
  const [note, setNote] = useState("");
  const [localError, setLocalError] = useState("");
  function confirm() {
    if (note.trim().length < 3) { setLocalError("Please give a reason for reopening this submission."); return; }
    setLocalError("");
    onConfirm(note);
  }
  return (
    <div className="border border-amber-300 bg-amber-50 rounded-lg p-3.5 mb-4">
      <p className="text-[13.5px] text-amber-950 mb-2">
        Reopening unlocks <strong>{schoolName}</strong>'s grades for this period so it can add or remove subjects and then submit again.
        Open correction requests for this period are cancelled. The school is shown your reason.
      </p>
      <label htmlFor="reopen-note" className="block text-[13px] font-semibold text-[#062444] mb-1">Reason for reopening</label>
      <textarea id="reopen-note" value={note} onChange={e => setNote(e.target.value)} rows={2}
        className="w-full border border-[#062444]/30 rounded-lg px-2.5 py-2 text-[13.5px] outline-none focus:border-[#0088cc] bg-white" />
      {(localError || error) && <p role="alert" className="text-[13px] text-red-700 mt-1.5">{localError || error}</p>}
      <div className="flex justify-end gap-2 mt-2.5">
        <button onClick={onCancel} className="px-3.5 py-1.5 rounded-lg border border-[#062444]/30 text-[13px] font-semibold text-[#062444] bg-white">Cancel</button>
        <button onClick={confirm} disabled={busy} className="px-3.5 py-1.5 rounded-lg bg-[#062444] text-white text-[13px] font-semibold disabled:opacity-60">
          {busy ? "Reopening…" : "Reopen submission"}
        </button>
      </div>
    </div>
  );
}

function ProgramsModal({ school, period, periodId, submission, onClose, onChanged }: {
  school: SchoolCompletionRow; period: GradingPeriod; periodId: string | null; submission: SubmissionOverviewRow | undefined;
  onClose: () => void; onChanged: () => void;
}) {
  const [programs, setPrograms] = useState<ProgramCompletionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [reopening, setReopening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => {
    fetchProgramsCompletion(school.schoolId, period).then(rows => { setPrograms(rows); setLoading(false); });
  }, [school.schoolId, period]);

  const canReopen = useMemo(() => submission?.status === "submitted" && !!periodId, [submission, periodId]);

  async function confirmReopen(note: string) {
    if (!periodId) return;
    setBusy(true); setError("");
    const result = await reopenSubmission(school.schoolId, periodId, note);
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    setReopening(false);
    setDone(`${school.schoolName}'s submission was reopened.`);
    onChanged();
  }

  return (
    <Modal title={`${school.schoolName} — Programs`} onClose={onClose}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <SubmissionBadge row={submission} />
        {canReopen && !reopening && (
          <button onClick={() => setReopening(true)} className="flex items-center gap-1.5 text-[13px] font-semibold text-[#0077b6] hover:underline">
            <Unlock size={13} aria-hidden="true" /> Reopen submission
          </button>
        )}
      </div>
      {done && <p role="status" className="text-[13.5px] font-semibold text-green-800 mb-3">{done}</p>}
      {reopening && <ReopenForm schoolName={school.schoolName} onCancel={() => { setReopening(false); setError(""); }} onConfirm={n => void confirmReopen(n)} busy={busy} error={error} />}
      {loading ? (
        <p className="text-[13px] text-slate-600 text-center py-8">Loading…</p>
      ) : programs.length === 0 ? (
        <p className="text-[13px] text-slate-600 text-center py-8">No programs found for this school.</p>
      ) : (
        <div className="space-y-2">
          {programs.map(p => (
            <div key={p.program} className="flex items-center justify-between bg-white border border-[#e6ecf5] rounded-lg px-4 py-3">
              <span className="text-[13.5px] font-semibold text-[#062444]">{p.program}</span>
              <div className="flex items-center gap-3">
                <span className="text-[12.5px] text-slate-700">{p.completeScholars} of {p.totalScholars} complete</span>
                <span className={`text-[15px] font-extrabold ${percentColor(p.percentComplete)}`}>{p.percentComplete}%</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
