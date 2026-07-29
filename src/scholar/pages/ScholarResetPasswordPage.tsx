import { Phone, Mail as EnvelopeIcon, ArrowLeft, MapPin } from "lucide-react";

interface ScholarResetPasswordPageProps {
  onBack: () => void;
}

/**
 * Scholar accounts don't have a real, checkable email (see
 * scripts/import-scholars-from-csv.mjs) — login is by Scholar ID or
 * name+birthday only. So "forgot password" can't be a self-service email
 * link; it's staff-mediated instead, same as a scholar walking up to the
 * office window. Staff runs scripts/reset-scholar-password.mjs and gives
 * the scholar their new password directly.
 *
 * Edit OFFICE_CONTACT below with your office's real details.
 */
const OFFICE_CONTACT = {
  phone: "(088) 000-0000",
  email: "cedo@cagayandeoro.gov.ph",
  address: "City Education and Development Office, Cagayan de Oro City",
};

export function ScholarResetPasswordPage({ onBack }: ScholarResetPasswordPageProps) {
  return (
    <div className="min-h-[calc(100vh-64px)] bg-white flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-[#1B3372] mb-6">
          <ArrowLeft size={15} /> Back to log in
        </button>

        <h2 className="text-2xl font-extrabold text-[#1F334F] mb-2">Need a password reset?</h2>
        <p className="text-sm text-slate-500 mb-6">
          For your account's security, password resets are handled directly by CEDO staff — please
          get in touch using any of the options below with your Scholar ID number ready.
        </p>

        <div className="space-y-4">
          <ContactRow icon={<Phone size={16} />} label="Call the office" value={OFFICE_CONTACT.phone} />
          <ContactRow icon={<EnvelopeIcon size={16} />} label="Email" value={OFFICE_CONTACT.email} />
          <ContactRow icon={<MapPin size={16} />} label="Visit in person" value={OFFICE_CONTACT.address} />
        </div>
      </div>
    </div>
  );
}

function ContactRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 border border-[#1B3372]/15 rounded-lg px-4 py-3">
      <span className="text-[#F3BC00] mt-0.5">{icon}</span>
      <div>
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{label}</p>
        <p className="text-sm font-medium text-slate-700">{value}</p>
      </div>
    </div>
  );
}
