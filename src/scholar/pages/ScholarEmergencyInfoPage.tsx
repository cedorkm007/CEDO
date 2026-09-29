import { useEffect, useState } from "react";
import { UserCircle2, Phone, SearchX, FileWarning, Building2 } from "lucide-react";
import { fetchPublicScholarEmergencyInfo, type PublicScholarEmergencyInfo } from "../publicEmergencyInfoApi";

// CEDO's own contact info shown alongside a scholar's emergency contact —
// static, unrelated to any scholar row, so it's just hardcoded here rather
// than round-tripped through the (deliberately narrow) public RPC.
const CEDO_OFFICE_NAME = "City Education and Development Office (CEDO)";
const CEDO_OFFICE_PHONE = "(088) 856-1234";
const CEDO_OFFICE_ADDRESS = "Cagayan de Oro City Hall, Cagayan de Oro City";

/**
 * Reached by scanning a scholar's permanent QR — the whole point is that
 * this works for ANY camera, not just someone signed into the portal, so
 * this page runs fully unauthenticated, reading its own `?token=` query
 * param (same convention FinancialAssistanceStatusPage.tsx already
 * established for a QR-reached, account-less public page).
 */
export function ScholarEmergencyInfoPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PublicScholarEmergencyInfo | null>(null);

  useEffect(() => {
    (async () => {
      const token = new URLSearchParams(window.location.search).get("token");
      if (!token) {
        setError("No scholar ID was provided.");
        setLoading(false);
        return;
      }
      const response = await fetchPublicScholarEmergencyInfo(token);
      if (!response.ok) {
        setError(response.error || "Couldn't load this scholar ID.");
      } else {
        setResult(response.result ?? null);
      }
      setLoading(false);
    })();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#062444] px-4 py-10">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-6">
        <h1 className="text-[16px] font-bold text-[#062444] mb-1">CEDO Scholar ID</h1>
        <p className="text-[12.5px] text-slate-500 mb-5">Emergency contact information</p>

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
            <p className="text-[13px] font-semibold text-[#062444] mb-1">Scholar ID not recognized.</p>
            <p className="text-[12.5px] text-slate-400">Double-check the QR code and try again.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-[#e6ecf5] p-4">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1"><UserCircle2 size={13} /> Scholar</p>
              <p className="text-[15px] font-semibold text-[#062444]">{result.name}</p>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-amber-700 mb-2"><Phone size={13} /> Emergency Contact</p>
              {result.emergencyContactName ? (
                <>
                  <p className="text-[14px] font-semibold text-[#062444]">{result.emergencyContactName}{result.emergencyContactRelationship && <span className="font-normal text-slate-500"> — {result.emergencyContactRelationship}</span>}</p>
                  <p className="text-[14px] text-[#062444] mt-0.5">{result.emergencyContactNumber || "No number on file"}</p>
                </>
              ) : (
                <p className="text-[13px] text-amber-700/80">No emergency contact on file for this scholar.</p>
              )}
            </div>

            <div className="rounded-xl border border-[#e6ecf5] p-4">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1"><Building2 size={13} /> CEDO Contact</p>
              <p className="text-[13.5px] font-semibold text-[#062444]">{CEDO_OFFICE_NAME}</p>
              <p className="text-[13px] text-slate-500 mt-0.5">{CEDO_OFFICE_PHONE}</p>
              <p className="text-[12.5px] text-slate-400 mt-0.5">{CEDO_OFFICE_ADDRESS}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
