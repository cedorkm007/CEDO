/**
 * Shared page title for every tool screen — matches the original app's
 * own `.welcome-header h2`/`p` rule (sign-language-tools.blade.php),
 * which coexists with (and is distinct from) the app-wide `.app-header`
 * brand bar. That brand bar, plus Home/Back navigation, now lives in
 * KaubanTopNav.tsx (persistent across every screen) — this component
 * used to also render its own back button before that existed, which
 * would now be a duplicate control.
 */
export function KaubanPageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-5 sm:mb-6">
      <h1 className="text-xl font-semibold text-[#2D3748]" style={{ fontFamily: "'Fredoka', sans-serif" }}>{title}</h1>
      {subtitle && <p className="text-sm text-[#718096]">{subtitle}</p>}
    </div>
  );
}
