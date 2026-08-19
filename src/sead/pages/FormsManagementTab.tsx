import { FileText } from "lucide-react";

/**
 * Placeholder for the Forms Management tab — routing and tag-gated
 * visibility only for this milestone. The upload UI, condition editor,
 * and material list (backed by src/sead/formsManagementApi.ts and the
 * form_materials / form_material_conditions tables) come in a later
 * milestone.
 */
export function FormsManagementTab() {
  return (
    <div className="flex flex-col items-center justify-center text-center py-20 px-6 border border-dashed border-border rounded-2xl bg-muted/30">
      <FileText size={28} className="text-muted-foreground mb-3" />
      <h2 className="text-[15px] font-bold text-foreground mb-1">Forms Management</h2>
      <p className="text-sm text-muted-foreground max-w-sm">
        Uploading and managing the PDFs/flipbooks scholars see under Forms and Services, including unlock conditions, is coming soon.
      </p>
    </div>
  );
}
