import { useEffect, useState } from "react";
import { X, Download } from "lucide-react";
import QRCode from "qrcode";
import { jsPDF } from "jspdf";
import type { FinancialAssistanceApplicant } from "../financialAssistanceApi";

// Same production domain used for the Scholar Portal login QR — see the
// deployed app's own base URL (cedo-ten.vercel.app), just under the
// financial-assistance-status public route registered in ScholarSiteApp.tsx.
const STATUS_PAGE_BASE_URL = "https://cedo-ten.vercel.app/CEDO/financial-assistance-status";

export function FinancialAssistanceQrModal({ applicant, onClose }: { applicant: FinancialAssistanceApplicant; onClose: () => void }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const statusUrl = `${STATUS_PAGE_BASE_URL}?ref=${encodeURIComponent(applicant.referenceNumber)}`;

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(statusUrl, { errorCorrectionLevel: "M", margin: 1, width: 240 }).then(url => {
      if (!cancelled) setDataUrl(url);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicant.referenceNumber]);

  function handleDownload() {
    if (!dataUrl) return;
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a5" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(13);
    pdf.setTextColor(6, 36, 68);
    pdf.text("Financial Assistance Application", pageWidth / 2, 16, { align: "center" });
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    pdf.text(applicant.name, pageWidth / 2, 23, { align: "center" });
    const qrSize = 70;
    pdf.addImage(dataUrl, "PNG", (pageWidth - qrSize) / 2, 30, qrSize, qrSize);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(12);
    pdf.text(applicant.referenceNumber, pageWidth / 2, 30 + qrSize + 10, { align: "center" });
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8.5);
    pdf.setTextColor(100, 116, 139);
    pdf.text("Scan this code to check your application status.", pageWidth / 2, 30 + qrSize + 17, { align: "center" });
    pdf.save(`financial-assistance-${applicant.referenceNumber}.pdf`);
  }

  return (
    <div className="fixed inset-0 z-[110] bg-black/40 flex items-center justify-center px-4 py-8" onClick={onClose}>
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-gradient-to-br from-[#062444] to-[#0a3a6b] px-6 py-4 rounded-t-2xl">
          <h3 className="text-white font-bold text-[15px]">Applicant QR Code</h3>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X size={18} /></button>
        </div>
        <div className="p-6 text-center">
          <p className="text-[14px] font-semibold text-[#062444] mb-1">{applicant.name}</p>
          <p className="text-[12px] text-slate-400 mb-4">{applicant.referenceNumber}</p>
          {dataUrl ? (
            <img src={dataUrl} alt={`QR code for ${applicant.referenceNumber}`} className="mx-auto mb-4 rounded-lg border border-[#e6ecf5]" />
          ) : (
            <div className="h-[240px] flex items-center justify-center text-slate-400 text-[13px]">Generating…</div>
          )}
          <button onClick={handleDownload} disabled={!dataUrl}
            className="flex items-center gap-1.5 mx-auto bg-gradient-to-br from-[#062444] to-[#0a3a6b] disabled:opacity-50 text-white text-[13px] font-semibold rounded-lg px-5 py-2.5">
            <Download size={14} /> Download
          </button>
        </div>
      </div>
    </div>
  );
}
