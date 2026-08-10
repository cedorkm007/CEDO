/**
 * Cagayan de Oro's 80 barangays (40 named + the 40 numbered "Barangay 1"–
 * "Barangay 40" urban barangays) and the 8-cluster grouping used by both
 * the scholar portal's address field and the staff "Scholars' Formation
 * Tools" (Community-based Organization subsection).
 *
 * NOTE ON THE SOURCE DATA: the barangay list and the cluster-to-barangay
 * mapping provided didn't quite line up — "Calaanan" was in the barangay
 * list but missing from every cluster, while "Puntod" was in Cluster G's
 * list but missing from the barangay list. Both are real CDO barangays, so
 * I've included both and put them together in Cluster G (which already
 * absorbs the "leftover" named barangays alongside the unified numbered
 * ones). Adjust CLUSTER_OF below if that assumption is wrong.
 */

export type ClusterCode = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";

export const CLUSTERS: { code: ClusterCode; label: string }[] = [
  { code: "A", label: "Cluster A" },
  { code: "B", label: "Cluster B" },
  { code: "C", label: "Cluster C" },
  { code: "D", label: "Cluster D" },
  { code: "E", label: "Cluster E" },
  { code: "F", label: "Cluster F" },
  { code: "G", label: "Cluster G" },
  { code: "H", label: "Cluster H" },
];

const NAMED_CLUSTER_OF: Record<string, ClusterCode> = {
  "Bugo": "A", "Puerto": "A", "Agusan": "A", "Balubal": "A", "Tablon": "A",
  "Lumbia": "B", "Canito-an": "B", "Pagatpat": "B", "San Simon": "B", "Baikingon": "B",
  "Dansolihon": "C", "Tignapoloan": "C", "Besigan": "C", "Mambuaya": "C", "Bayanga": "C",
  "Indahag": "D", "Balulang": "D", "Macasandig": "D", "Nazareth": "D", "Camaman-an": "D",
  "Bonbon": "E", "Bayabas": "E", "Kauswagan": "E", "Bulua": "E", "Iponan": "E",
  "F. S. Catanico": "F", "Gusa": "F", "Lapasan": "F", "Cugman": "F", "Macabalan": "F",
  "Carmen": "G", "Patag": "G", "Puntod": "G", "Consolacion": "G", "Calaanan": "G",
  "Taglimao": "H", "Tuburan": "H", "Pigsag-an": "H", "Tumpagon": "H", "Pagalungan": "H", "Tagpangi": "H",
};

export const NUMBERED_BARANGAYS: string[] = Array.from({ length: 40 }, (_, i) => `Barangay ${i + 1}`);
export const NAMED_BARANGAYS: string[] = Object.keys(NAMED_CLUSTER_OF).sort((a, b) => a.localeCompare(b));
export const ALL_BARANGAYS: string[] = [...NAMED_BARANGAYS, ...NUMBERED_BARANGAYS];

const CLUSTER_OF: Record<string, ClusterCode> = { ...NAMED_CLUSTER_OF };
for (const b of NUMBERED_BARANGAYS) CLUSTER_OF[b] = "G"; // "Unified Barangay" — Barangay 1–40 are all Cluster G

export function clusterForBarangay(barangay: string): ClusterCode | null {
  return CLUSTER_OF[barangay] ?? null;
}

export function clusterLabel(code: ClusterCode | string | null): string {
  return code ? `Cluster ${code}` : "—";
}

/** Every named barangay that belongs to a given cluster (excludes the unified 1–40 for G). */
export function namedBarangaysInCluster(code: ClusterCode): string[] {
  return NAMED_BARANGAYS.filter(b => CLUSTER_OF[b] === code);
}
