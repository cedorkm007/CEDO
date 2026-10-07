import { ALL_BARANGAYS, CLUSTERS, namedBarangaysInCluster } from "@/lib/cdoBarangays";
import { ChecklistDropdown, type ChecklistOption } from "./ChecklistDropdown";

const BARANGAY_OPTIONS: ChecklistOption[] = ALL_BARANGAYS.map(b => ({ value: b, label: b }));

const CLUSTER_OPTIONS: ChecklistOption[] = CLUSTERS.map(c => ({
  value: c.code,
  label: c.label,
  hint: c.code === "G"
    ? `${namedBarangaysInCluster(c.code).join(", ")} + Barangay 1–40`
    : namedBarangaysInCluster(c.code).join(", "),
}));

/**
 * "Who can see this activity, by where they live" -- the barangay and
 * cluster restriction on an SDP activity. Both lists empty = every scholar
 * (the default); otherwise a scholar sees the activity if their barangay is
 * checked OR belongs to a checked cluster. Enforced in the database by the
 * scholar read policy on sdp_activities
 * (supabase_migration_sdp_barangay_cluster_visibility.sql), not just here.
 */
export function BarangayClusterPicker({ barangays, clusters, onBarangaysChange, onClustersChange }: {
  barangays: string[];
  clusters: string[];
  onBarangaysChange: (next: string[]) => void;
  onClustersChange: (next: string[]) => void;
}) {
  return (
    <fieldset className="border-t border-[#f0f3f8] pt-3">
      <legend className="mb-2 text-[12.5px] font-bold text-[#062444]">Activity visible to scholars living in</legend>
      <div className="space-y-2.5">
        <div>
          <label className="mb-1 block text-[11px] font-semibold text-slate-500">Barangays</label>
          <ChecklistDropdown options={BARANGAY_OPTIONS} selected={barangays} onChange={onBarangaysChange}
            emptyLabel="All barangays" itemNoun="barangay" searchable searchPlaceholder="Search barangays…" />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-semibold text-slate-500">Clusters</label>
          <ChecklistDropdown options={CLUSTER_OPTIONS} selected={clusters} onChange={onClustersChange}
            emptyLabel="All clusters" itemNoun="cluster" />
        </div>
        <p className="text-[11px] leading-snug text-slate-400">
          Leave both empty to show the activity to every scholar. If you check any, only scholars living in a checked barangay — or in a barangay of a checked cluster — will see it in their portal. Year level above still applies.
        </p>
      </div>
    </fieldset>
  );
}
