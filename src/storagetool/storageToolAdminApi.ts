// ─────────────────────────────────────────────────────────────
// src/storagetool/storageToolAdminApi.ts
// Phase 4 calls: the activity list, and (IT admin only) the overview, the three limits and handing a person's files over
// (supabase_migration_storage_tool_p4.sql). Every rule is decided by the database.
// ─────────────────────────────────────────────────────────────
import { supabase } from "@/lib/supabase";
import type { Loaded } from "./storageToolApi";
import type { ActivityItem, ItemKind } from "./storageToolLogic";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));

/** What happened in my storage (folderId = only that folder), newest first, one page; `before` continues after the oldest line shown. */
export async function fetchActivity(folderId: string | null, before: string | null = null, limit = 50): Promise<Loaded<{ items: ActivityItem[]; hasMore: boolean }>> {
  const { data, error } = await supabase.rpc("storage_tool_activity_list", { p_folder_id: folderId, p_limit: limit, p_before: before });
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't read the activity." };
  const d = data as { items?: Row[]; has_more?: boolean };
  return {
    ok: true,
    value: {
      hasMore: !!d.has_more,
      items: (d.items ?? []).map(r => ({ id: str(r.id), at: str(r.at), actor: str(r.actor), action: str(r.action), kind: r.kind as ItemKind, name: str(r.name), location: str(r.location), detail: (r.detail ?? {}) as Record<string, unknown> })),
    },
  };
}

export interface AdminPerson { id: string; name: string; username: string; hasAccess: boolean; files: number; folders: number; bytes: number; trashBytes: number; shares: number; links: number; lastActivity: string | null; hasAnything: boolean }
export interface AdminOverview { maxFileMb: number; trashDays: number; quotaGb: number; totalBytes: number; quotaBytes: number; people: AdminPerson[] }

export async function fetchAdminOverview(): Promise<Loaded<AdminOverview>> {
  const { data, error } = await supabase.rpc("storage_tool_admin_overview");
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't read the overview." };
  const d = data as { settings?: Row; total_bytes?: unknown; quota_bytes?: unknown; people?: Row[] };
  return {
    ok: true,
    value: {
      maxFileMb: Number(d.settings?.max_file_mb ?? 500), trashDays: Number(d.settings?.trash_days ?? 30), quotaGb: Number(d.settings?.total_quota_gb ?? 200),
      totalBytes: Number(d.total_bytes ?? 0), quotaBytes: Number(d.quota_bytes ?? 0),
      people: (d.people ?? []).map(r => ({
        id: str(r.id), name: str(r.name), username: str(r.username), hasAccess: !!r.has_access, files: Number(r.files ?? 0), folders: Number(r.folders ?? 0), bytes: Number(r.bytes ?? 0), trashBytes: Number(r.trash_bytes ?? 0),
        shares: Number(r.shares ?? 0), links: Number(r.links ?? 0), lastActivity: r.last_activity == null ? null : str(r.last_activity), hasAnything: !!r.has_anything,
      })),
    },
  };
}

export async function saveLimits(maxFileMb: number, trashDays: number, quotaGb: number): Promise<Loaded<true>> {
  const { error } = await supabase.rpc("storage_tool_settings_save", { p_max_file_mb: maxFileMb, p_trash_days: trashDays, p_total_quota_gb: quotaGb });
  return error ? { ok: false, error: error.message } : { ok: true, value: true };
}

export interface HandOverResult { folderName: string; folders: number; files: number; shares: number; links: number }
export async function handOver(fromId: string, toId: string): Promise<Loaded<HandOverResult>> {
  const { data, error } = await supabase.rpc("storage_tool_admin_transfer", { p_from: fromId, p_to: toId });
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't hand the files over." };
  const d = data as Row;
  return { ok: true, value: { folderName: str(d.folder_name), folders: Number(d.folders ?? 0), files: Number(d.files ?? 0), shares: Number(d.shares ?? 0), links: Number(d.links ?? 0) } };
}
