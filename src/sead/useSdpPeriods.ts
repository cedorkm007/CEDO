import { useEffect, useMemo, useState } from "react";
import { fetchAcademicPeriods } from "@/lib/academicPeriodsApi";
import { fetchCurrentGradingPeriod, type GradingPeriod } from "./scholarsGradesMonitoringApi";
import { normalizeTerm, periodKey, periodOptions, type AcademicPeriod } from "@/lib/academicPeriods";
import type { CreditPeriod } from "./sdpMonitorApi";

/**
 * The semesters an SDP credit can count in: the options for the dropdown, the key of the current grading period, and the way from a chosen key back to a school year and semester.
 * Shared by SDP Monitoring (the Checklist and the Credited Scholars tab of an activity).
 */
export function useSdpPeriods() {
  const [periods, setPeriods] = useState<AcademicPeriod[]>([]);
  const [current, setCurrent] = useState<GradingPeriod>({ schoolYear: "", semester: "" });
  useEffect(() => {
    void Promise.all([fetchAcademicPeriods(), fetchCurrentGradingPeriod()]).then(([p, cur]) => {
      if (p.ok) setPeriods(p.periods);
      setCurrent(cur);
    });
  }, []);
  const all = useMemo(() => {
    const list = [...periods];
    const term = normalizeTerm(current.semester);
    if (current.schoolYear && term && !list.some(x => periodKey(x.schoolYear, x.term) === periodKey(current.schoolYear, term))) {
      list.push({ id: periodKey(current.schoolYear, term), schoolYear: current.schoolYear, term, status: "open", deadline: null });
    }
    return list;
  }, [periods, current]);
  const options = useMemo(() => periodOptions(all, current), [all, current]);
  const currentKey = current.schoolYear ? periodKey(current.schoolYear, current.semester) : "";
  const toPeriod = (key: string): CreditPeriod | null => { const p = all.find(x => periodKey(x.schoolYear, x.term) === key); return p ? { schoolYear: p.schoolYear, semester: p.term } : null; };
  return { options, currentKey, toPeriod };
}
