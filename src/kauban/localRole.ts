import type { KaubanRole } from "./types";

/**
 * Kauban has no accounts (see docs/kauban/PROGRESS.md milestone 1 — the
 * original Laravel app stored this same choice in a single local JSON
 * file per device, "there's one install per device, so there's no need
 * for multi-user storage"). The direct equivalent here is one browser's
 * localStorage: the role a visitor picked on first use, remembered for
 * next time, with no server round-trip.
 */
const ROLE_KEY = "kauban_role";

export function getKaubanRole(): KaubanRole | null {
  try {
    const value = localStorage.getItem(ROLE_KEY);
    return value === "deaf" || value === "hard-of-hearing" || value === "hearing" ? value : null;
  } catch {
    return null;
  }
}

export function setKaubanRole(role: KaubanRole): void {
  try { localStorage.setItem(ROLE_KEY, role); } catch { /* ignore */ }
}

/** Used by "Switch role" — matches the original app's "Switch User"
 *  reset flow (AppSetup::reset(), wiping the device back to first-run). */
export function clearKaubanRole(): void {
  try { localStorage.removeItem(ROLE_KEY); } catch { /* ignore */ }
}
