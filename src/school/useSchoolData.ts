// ─────────────────────────────────────────────────────────────
// src/school/useSchoolData.ts
// Everything the School Portal's screens share, loaded once for the signed-in school: its scholars, the academic
// periods and which one is selected, its grading scale + letters, and the subjects/grades saved for the selected
// period (read back from the database). The period bar, the summary row, the cards, the table and the grade-entry
// window all read from this one object, so they can never disagree.
// ─────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchMySubmission, fetchMyCorrections } from "./submissionApi";
import { buildLockInfo, type CorrectionRequest, type GradeLockInfo, type Submission } from "./submissionLogic";
import { fetchOwnScholars, fetchCurrentGradingPeriod, fetchGradingConfig, fetchLetterGrades, fetchGradesForScholars } from "./schoolApi";
import { fetchAcademicPeriods } from "@/lib/academicPeriodsApi";
import { groupByScholar, summarizeScholarGrades } from "./gradeSaveLogic";
import { portalCounts, scholarStatus, type PortalCounts, type ScholarRowData } from "./portalLogic";
import { findPeriod, periodKey, periodOptions, periodRefOf, canSchoolEdit, type AcademicPeriod, type PeriodOption } from "@/lib/academicPeriods";
import { needsUnits, type LetterGrade } from "@/lib/gwa";
import { scholarStanding } from "@/lib/standing";
import type { GradingConfig, SchoolScholarRow, SchoolSubjectGrade } from "./types";
import type { GradingPeriod } from "@/sead/scholarsGradesMonitoringApi";

export interface SchoolData {
  schoolId: string;
  scholars: SchoolScholarRow[];
  /** True until the first load of the school's scholars finishes. */
  loading: boolean;

  periods: AcademicPeriod[];
  periodsError: string;
  options: PeriodOption[];
  selectedKey: string;
  currentKey: string;
  /** Pass null to go back to the Current Grading Period. */
  selectPeriod: (key: string | null) => void;
  /** The selected period as year + semester (memoized: safe as an effect dependency). */
  period: GradingPeriod;
  periodRecord: AcademicPeriod | null;
  /** True only when the selected period is Open — the only time a school may enter or change grades. */
  editable: boolean;

  config: GradingConfig | null;
  /** False until the first read of the grading scale finishes (so "not set up" is not flashed while loading). */
  configLoaded: boolean;
  /** The grading scale has been saved — required before any grade can be entered. */
  gradingReady: boolean;
  letters: LetterGrade[];

  rows: ScholarRowData[];
  counts: PortalCounts;
  /** Subjects that count toward the GWA but have no units yet (counted as 1 unit). */
  subjectsNeedingUnits: number;
  gradesError: string;
  gradesLoading: boolean;

  /** This school's submission for the selected period (null = not submitted). A submitted period is locked. */
  submission: Submission | null;
  submissionError: string;
  locked: boolean;
  /** Every correction request this school has made. */
  corrections: CorrectionRequest[];
  correctionsError: string;
  /** Which saved subject rows are locked, approved for one change, or waiting for CEDO (for the selected period). */
  lock: GradeLockInfo;

  reloadScholars: () => void;
  reloadGrades: () => void;
  reloadConfig: () => void;
  reloadSubmission: () => void;
}

export function useSchoolData(schoolId: string): SchoolData {
  const [scholars, setScholars] = useState<SchoolScholarRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPeriod, setCurrentPeriod] = useState<GradingPeriod>({ schoolYear: "", semester: "" });
  const [periods, setPeriods] = useState<AcademicPeriod[]>([]);
  const [periodsError, setPeriodsError] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [config, setConfig] = useState<GradingConfig | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [letters, setLetters] = useState<LetterGrade[]>([]);
  const [gradeRows, setGradeRows] = useState<SchoolSubjectGrade[]>([]);
  const [gradesError, setGradesError] = useState("");
  const [gradesLoading, setGradesLoading] = useState(false);
  const [gradesVersion, setGradesVersion] = useState(0);
  const [configVersion, setConfigVersion] = useState(0);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [submissionError, setSubmissionError] = useState("");
  const [corrections, setCorrections] = useState<CorrectionRequest[]>([]);
  const [correctionsError, setCorrectionsError] = useState("");
  const [submissionVersion, setSubmissionVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchOwnScholars(schoolId).then(rows => { if (!cancelled) { setScholars(rows); setLoading(false); } });
    return () => { cancelled = true; };
  }, [schoolId]);

  useEffect(() => {
    (async () => {
      const [cur, result] = await Promise.all([fetchCurrentGradingPeriod(), fetchAcademicPeriods()]);
      setCurrentPeriod(cur);
      if (result.ok) { setPeriods(result.periods); setPeriodsError(""); }
      else setPeriodsError(result.error);
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const c = await fetchGradingConfig();
      const l = c?.usesLetterGrades ? await fetchLetterGrades(schoolId) : [];
      if (cancelled) return;
      setConfig(c);
      setLetters(l);
      setConfigLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [schoolId, configVersion]);

  const currentKey = currentPeriod.schoolYear ? periodKey(currentPeriod.schoolYear, currentPeriod.semester) : "";
  const options = useMemo(() => periodOptions(periods, currentPeriod, { withStatus: true }), [periods, currentPeriod]);
  const selectedKeyEffective = selectedKey && options.some(o => o.key === selectedKey) ? selectedKey : currentKey;
  const selectedRecord = useMemo(() => periods.find(p => periodKey(p.schoolYear, p.term) === selectedKeyEffective) ?? null, [periods, selectedKeyEffective]);
  // Memoized: the grades effect below refetches whenever this object changes identity.
  const period: GradingPeriod = useMemo(
    () => (selectedRecord ? periodRefOf(selectedRecord) : { schoolYear: currentPeriod.schoolYear, semester: currentPeriod.semester }),
    [selectedRecord, currentPeriod.schoolYear, currentPeriod.semester],
  );
  const periodRecord = useMemo(() => findPeriod(periods, period), [periods, period]);
  const editable = canSchoolEdit(periodRecord?.status);

  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    (async () => {
      setGradesLoading(true);
      const result = period.schoolYear && period.semester
        ? await fetchGradesForScholars(scholars.map(s => s.scholarIdNumber), period)
        : { ok: true as const, rows: [] as SchoolSubjectGrade[] };
      if (cancelled) return;
      if (result.ok) { setGradeRows(result.rows); setGradesError(""); }
      else setGradesError(result.error);
      setGradesLoading(false);
    })();
    return () => { cancelled = true; };
  }, [loading, scholars, gradesVersion, period]);

  // The school's submission for the selected period, and its correction requests (re-read after any submit / request / review).
  const periodId = periodRecord?.id ?? null;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [sub, corr] = await Promise.all([periodId ? fetchMySubmission(periodId) : Promise.resolve({ ok: true as const, submission: null }), fetchMyCorrections()]);
      if (cancelled) return;
      if (sub.ok) { setSubmission(sub.submission); setSubmissionError(""); } else setSubmissionError(sub.error);
      if (corr.ok) { setCorrections(corr.rows); setCorrectionsError(""); } else setCorrectionsError(corr.error);
    })();
    return () => { cancelled = true; };
  }, [periodId, submissionVersion]);
  const locked = submission?.status === "submitted";
  const lock = useMemo(() => buildLockInfo(submission, corrections, periodId), [submission, corrections, periodId]);

  const rows = useMemo<ScholarRowData[]>(() => {
    const byScholar = groupByScholar(gradeRows);
    return scholars.map(scholar => {
      const summary = summarizeScholarGrades(byScholar.get(scholar.scholarIdNumber) ?? [], letters);
      return { scholar, summary, status: scholarStatus(summary, locked), standing: scholarStanding(summary.gwa, config) };
    });
  }, [scholars, gradeRows, letters, locked, config]);
  const counts = useMemo(() => portalCounts(rows), [rows]);
  const subjectsNeedingUnits = useMemo(() => gradeRows.filter(r => needsUnits(r)).length, [gradeRows]);

  const selectPeriod = useCallback((key: string | null) => setSelectedKey(key), []);
  const reloadScholars = useCallback(() => { fetchOwnScholars(schoolId).then(setScholars); }, [schoolId]);
  const reloadGrades = useCallback(() => setGradesVersion(v => v + 1), []);
  const reloadConfig = useCallback(() => setConfigVersion(v => v + 1), []);
  const reloadSubmission = useCallback(() => setSubmissionVersion(v => v + 1), []);

  return {
    schoolId, scholars, loading,
    periods, periodsError, options, selectedKey: selectedKeyEffective, currentKey, selectPeriod, period, periodRecord, editable,
    config, configLoaded, gradingReady: configLoaded && config !== null, letters,
    rows, counts, subjectsNeedingUnits, gradesError, gradesLoading,
    submission, submissionError, locked, corrections, correctionsError, lock,
    reloadScholars, reloadGrades, reloadConfig, reloadSubmission,
  };
}
