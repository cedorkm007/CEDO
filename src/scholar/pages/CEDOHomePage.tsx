import HeroBackground from "@/imports/scholar/Hero_Background.jpg";

/**
 * CEDOHomePage — the public landing page (formerly referred to as the
 * "Scholars page" during planning; per the brief this is the general CEDO
 * home page that scholars reach the portal FROM, via the Scholar Log In
 * button in the nav).
 */
export function CEDOHomePage() {
  return (
    <div className="relative min-h-[calc(100vh-64px)] overflow-hidden bg-white">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${HeroBackground})` }}
      />
      <div className="absolute inset-0 bg-gradient-to-r from-white via-white/90 to-white/10" />

      <div className="relative max-w-[1280px] mx-auto px-4 md:px-8 py-16 md:py-24">
        <div className="max-w-[560px]">
          <div className="mb-6">
            <div className="text-[#F3BC00] font-bold tracking-wide text-sm mb-2">CITY EDUCATION AND DEVELOPMENT OFFICE</div>
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold text-[#1F334F] leading-tight mb-6">
            City Education and<br />Development Office
          </h1>
          <button className="bg-[#F3BC00] hover:bg-[#e0ac00] text-[#1F334F] font-bold text-sm tracking-wide px-6 py-3 rounded-md transition-colors">
            ABOUT US
          </button>
        </div>
      </div>
    </div>
  );
}
