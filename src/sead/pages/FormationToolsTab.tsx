import { useEffect, useState } from "react";
import { Users2, School, Building2, Shield, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { fetchDistinctSchools } from "../formationApi";
import { PositionSlotsEditor } from "../components/PositionSlotsEditor";
import { MembersListEditor } from "../components/MembersListEditor";
import { CLUSTERS, namedBarangaysInCluster, NUMBERED_BARANGAYS, type ClusterCode } from "@/lib/cdoBarangays";
import { VIP_DEPARTMENTS } from "@/lib/formationLabels";

const ADVOCACY_SUGGESTIONS = [
  "Committee on External Affairs", "Committee on Advocacy Programs", "Advocacy for Education", "Advocacy for Environment",
  "Advocacy for Health", "Advocacy for Sports", "Committee on Budget and Finance", "Committee on Events and Management",
  "Committee on Communication and Management", "Committee on Volunteer Development",
];

type Section = "school" | "community" | "vip";
type CommunityView = { level: "clusters" } | { level: "cluster"; cluster: ClusterCode } | { level: "barangay"; cluster: ClusterCode; barangay: string };
type VipView = { level: "top" } | { level: "department"; key: string; label: string };

function TileGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">{children}</div>;
}
function Tile({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="flex items-center justify-between gap-2 bg-white border border-[#e6ecf5] hover:border-[#0088cc]/40 hover:shadow-[0_2px_10px_rgba(6,36,68,0.06)] rounded-xl px-4 py-3.5 text-left transition-all">
      <span className="text-[13px] font-semibold text-[#062444] truncate">{label}</span>
      <ChevronRight size={14} className="text-[#0088cc] shrink-0" />
    </button>
  );
}
function BackLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 text-[12.5px] font-semibold text-slate-400 hover:text-[#062444] mb-4">
      <ChevronLeft size={14} /> {label}
    </button>
  );
}

function SchoolSection() {
  const [schools, setSchools] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => { (async () => { setLoading(true); setSchools(await fetchDistinctSchools()); setLoading(false); })(); }, []);

  const filtered = schools.filter(s => s.toLowerCase().includes(search.trim().toLowerCase()));

  if (selected) {
    return (
      <div>
        <BackLink label="Back to Schools" onClick={() => setSelected(null)} />
        <h3 className="text-[15px] font-extrabold text-[#062444] mb-4">{selected}</h3>
        <PositionSlotsEditor
          orgType="school" orgKey={selected}
          scholarFilter={{ school: selected }}
          fixedRoles={[
            { roleKey: "president", label: "President" },
            { roleKey: "vice_president", label: "Vice President" },
            { roleKey: "secretary", label: "School-based Secretary" },
          ]}
          expandableGroups={[
            { roleKey: "college_director", groupLabel: "College Directors", addPromptLabel: 'Year level (e.g. "1st Year")' },
            { roleKey: "committee_staff", groupLabel: "Committee Staff", addPromptLabel: "Committee staff name/role" },
          ]}
        />
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm text-slate-500 mb-4">Schools are pulled from scholars' profiles automatically — pick one to manage its officers.</p>
      <div className="flex items-center gap-2 bg-white border border-[#e6ecf5] rounded-lg px-3 py-2 max-w-sm mb-4">
        <Search size={15} className="text-slate-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search schools…" className="w-full text-sm outline-none" />
      </div>
      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-slate-400">No schools found on scholar profiles yet.</p>
      ) : (
        <TileGrid>{filtered.map(s => <Tile key={s} label={s} onClick={() => setSelected(s)} />)}</TileGrid>
      )}
    </div>
  );
}

function CommunitySection() {
  const [view, setView] = useState<CommunityView>({ level: "clusters" });

  if (view.level === "barangay") {
    return (
      <div>
        <BackLink label={`Back to Cluster ${view.cluster}`} onClick={() => setView({ level: "cluster", cluster: view.cluster })} />
        <h3 className="text-[15px] font-extrabold text-[#062444] mb-4">{view.barangay}</h3>
        <PositionSlotsEditor
          orgType="community_barangay" orgKey={view.barangay}
          scholarFilter={{ barangay: view.barangay }}
          fixedRoles={[
            { roleKey: "chairperson", label: "Chairperson" },
            { roleKey: "vice_chairperson", label: "Vice Chairperson" },
            { roleKey: "secretary", label: "Barangay-level Secretary" },
          ]}
          expandableGroups={[
            { roleKey: "advocacy_committee", groupLabel: "Committees / Advocacies", addPromptLabel: "Committee or advocacy name" },
          ]}
        />
        <p className="text-[11px] text-slate-400 mt-4">Suggested: {ADVOCACY_SUGGESTIONS.join(" · ")}</p>
      </div>
    );
  }

  if (view.level === "cluster") {
    const named = namedBarangaysInCluster(view.cluster);
    const barangays = view.cluster === "G" ? [...named, ...NUMBERED_BARANGAYS] : named;
    return (
      <div>
        <BackLink label="Back to Clusters" onClick={() => setView({ level: "clusters" })} />
        <h3 className="text-[15px] font-extrabold text-[#062444] mb-1">Cluster {view.cluster}</h3>
        <p className="text-sm text-slate-500 mb-4">Cluster-level officers</p>
        <PositionSlotsEditor
          orgType="community_cluster" orgKey={view.cluster}
          scholarFilter={{ barangayIn: barangays }}
          fixedRoles={[
            { roleKey: "cluster_head", label: "Cluster Head" },
            { roleKey: "deputy_head", label: "Deputy Head" },
            { roleKey: "secretary", label: "Cluster Secretary" },
          ]}
        />
        <hr className="border-t border-[#e6ecf5] my-6" />
        <h4 className="text-[13px] font-bold text-[#062444] mb-3">Barangays in this cluster</h4>
        <TileGrid>
          {barangays.map(b => <Tile key={b} label={b} onClick={() => setView({ level: "barangay", cluster: view.cluster, barangay: b })} />)}
        </TileGrid>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm text-slate-500 mb-4">Pick a cluster to manage its officers and drill into its barangays.</p>
      <TileGrid>
        {CLUSTERS.map(c => <Tile key={c.code} label={c.label} onClick={() => setView({ level: "cluster", cluster: c.code })} />)}
      </TileGrid>
    </div>
  );
}

function VipSection() {
  const [view, setView] = useState<VipView>({ level: "top" });

  if (view.level === "department") {
    return (
      <div>
        <BackLink label="Back to VIP" onClick={() => setView({ level: "top" })} />
        <h3 className="text-[15px] font-extrabold text-[#062444] mb-4">{view.label}</h3>
        {view.key === "members" ? (
          <MembersListEditor orgKey="members" />
        ) : view.key === "events_communication" ? (
          <PositionSlotsEditor
            orgType="vip_department" orgKey="events_communication"
            fixedRoles={[
              { roleKey: "director", label: "Director" },
              { roleKey: "assoc_isda_ensemble", label: "Associate Director — ISDA Ensemble" },
              { roleKey: "assoc_isda_chorale", label: "Associate Director — ISDA Chorale" },
              { roleKey: "assoc_isda_patrollers", label: "Associate Director — ISDA Patrollers" },
              { roleKey: "assoc_isda_events", label: "Associate Director — ISDA Events" },
            ]}
          />
        ) : (
          <PositionSlotsEditor
            orgType="vip_department" orgKey={view.key}
            fixedRoles={[
              { roleKey: "director", label: "Director" },
              { roleKey: "associate_director", label: "Associate Director" },
            ]}
          />
        )}
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm text-slate-500 mb-4">Top-level VIP officers</p>
      <PositionSlotsEditor
        orgType="vip_top" orgKey=""
        fixedRoles={[
          { roleKey: "director_general", label: "Director General" },
          { roleKey: "secretary_general", label: "Secretary General" },
        ]}
      />
      <hr className="border-t border-[#e6ecf5] my-6" />
      <h4 className="text-[13px] font-bold text-[#062444] mb-3">Departments</h4>
      <TileGrid>
        {VIP_DEPARTMENTS.map(d => <Tile key={d.key} label={d.label} onClick={() => setView({ level: "department", key: d.key, label: d.label })} />)}
      </TileGrid>
    </div>
  );
}

/**
 * Tags scholars with leadership positions across three structures.
 * Gated by the 'scholars_formation' tag, assigned per-account from
 * it.admin1's Staff Accounts page.
 */
export function FormationToolsTab() {
  const [section, setSection] = useState<Section>("school");

  const TABS: { key: Section; label: string; icon: React.ReactNode }[] = [
    { key: "school", label: "School-based Organization", icon: <School size={14} /> },
    { key: "community", label: "Community-based Organization", icon: <Building2 size={14} /> },
    { key: "vip", label: "Volunteer Iskolar-Leaders Program", icon: <Shield size={14} /> },
  ];

  return (
    <div>
      <h1 className="text-xl font-bold text-foreground mb-1 flex items-center gap-2"><Users2 size={20} className="text-[#F3BC00]" /> Scholars' Formation Tools</h1>
      <p className="text-sm text-muted-foreground mb-5">Tag scholars with leadership positions in each organizational structure.</p>

      <div className="flex gap-1 border-b border-border mb-5 flex-wrap">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setSection(t.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-[13px] font-bold border-b-2 transition-colors ${
              section === t.key ? "border-[#062444] text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {section === "school" && <SchoolSection />}
      {section === "community" && <CommunitySection />}
      {section === "vip" && <VipSection />}
    </div>
  );
}
