import { useCallback, useEffect, useState } from "react";
import { fetchSchoolLogo } from "./logoApi";

export interface SchoolLogoState {
  /** The logo as base64 PNG text; null = none (or not read yet). */
  base64: string | null;
  loaded: boolean;
  /** The database update for the logo has not been run yet. */
  missing: boolean;
  setBase64: (b64: string | null) => void;
}

/** Reads the school's own logo once when the portal opens. A failed read just means "no logo yet": the portal works without it. */
export function useSchoolLogo(): SchoolLogoState {
  const [base64, setBase64] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void fetchSchoolLogo().then(r => {
      if (cancelled) return;
      if (r.ok) setBase64(r.base64); else if (r.missing) setMissing(true);
      setLoaded(true);
    }).catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);
  const set = useCallback((b: string | null) => setBase64(b), []);
  return { base64, loaded, missing, setBase64: set };
}
