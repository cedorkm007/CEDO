import { useEffect, useState } from "react";
import { CheckCircle2, Clock, SearchX, FileWarning } from "lucide-react";
import { fetchFinancialAssistanceStatus, type FinancialAssistanceStatusResult } from "../financialAssistanceStatusApi";

/**
 * Reached by scanning a Financial Assistance applicant's QR code — this
 * applicant has NO portal account at all (they're pure monitoring data on
 * the staff side), so this page runs fully unauthenticated, reading its
 * own `?ref=` query param (no shared routing helper does this — see
 * ScholarSiteApp.tsx's own header comment on this).
 */
export function FinancialAssistanceStatusPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [result, setResult] = useState<FinancialAssistanceStatusResult | null>(null);

  useEffect(() => {
    (async () => {
      const ref = new URLSearchParams(window.location.search).get("ref");
      if (!ref) {
        setError("No reference number was provided.");
        setLoading(false);
        return;
      }
      const response = await fetchFinancialAssistanceStatus(ref);
      if (!response.ok) {
        setError(response.error || "Couldn't load your application status.");
      } else {
        setResult(response.result ?? null);
      }
      setLoading(false);
    })();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#062444] px-4 py-10">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-6">
        <h1 className="text-[16px] font-bold text-[#062444] mb-1">Financial Assistance Application</h1>
        <p className="text-[12.5px] text-slate-500 mb-5">Application status</p>

        {loading ? (
          <p className="text-[13px] text-slate-400 text-center py-8">Loading…</p>
        ) : error ? (
          <div className="text-center py-6">
            <FileWarning size={32} className="mx-auto text-red-400 mb-3" />
            <p className="text-[13px] text-red-600">{error}</p>
          </div>
        ) : !result?.found ? (
          <div className="text-center py-6">
            <SearchX size={32} className="mx-auto text-slate-300 mb-3" />
            <p className="text-[13px] font-semibold text-[#062444] mb-1">Reference number not found.</p>
            <p className="text-[12.5px] text-slate-400">Double-check the QR code or reference number and try again.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-[#e6ecf5] p-4">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Applicant Name</p>
              <p className="text-[15px] font-semibold text-[#062444]">{result.name}</p>
            </div>
            <div className="rounded-xl border border-[#e6ecf5] p-4">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Date of Application</p>
              <p className="text-[14px] text-[#062444]">{result.appliedAt ? new Date(result.appliedAt).toLocaleDateString() : "—"}</p>
            </div>

            {result.status === "approved" ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <p className="flex items-center gap-1.5 text-[13px] font-bold text-emerald-700 mb-2"><CheckCircle2 size={15} /> Approved</p>
                <p className="text-[13px] text-emerald-800 leading-relaxed mb-4">{result.approvedInstructions}</p>
                <button disabled
                  className="w-full bg-emerald-200 text-emerald-700 text-[13px] font-semibold rounded-lg px-4 py-2.5 cursor-not-allowed opacity-70">
                  Generate Guarantee Letter — coming soon
                </button>
              </div>
            ) : (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="flex items-center gap-1.5 text-[13px] font-bold text-amber-700"><Clock size={15} /> Still Processing</p>
                <p className="text-[12.5px] text-amber-700/80 mt-1">Please check back later, or contact the CEDO office for updates.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
