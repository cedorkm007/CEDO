// Who can open the Storage Tool: the IT admin (it.admin1) and every staff account that has the "storage_tool" tag (given in Staff Accounts).
// Mirrors can_use_storage_tool() in supabase_migration_storage_tool_p1.sql, which is the rule that is actually enforced.
export interface StorageToolUser { tags: string[]; username?: string }
export const STORAGE_TOOL_TAG = "storage_tool";
export const canUseStorageTool = (u: StorageToolUser): boolean => u.tags.includes(STORAGE_TOOL_TAG) || (u.username ?? "").toLowerCase() === "it.admin1";
