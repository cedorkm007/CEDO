/**
 * supabase.ts
 * Supabase client + typed data-access helpers.
 * Replaces sheets.ts (Google Sheets) and drive.ts (Google Drive).
 * No per-user OAuth needed — all access goes through the shared
 * publishable key, same as the previous "anon" key model.
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ── Realtime subscription helper ────────────────────────────
// Triggers `callback` whenever any row in `table` is inserted or updated.
// Returns an unsubscribe function — call it on component unmount.
// `filter` (Postgres changes filter syntax, e.g. "session_id=eq.<uuid>")
// scopes the subscription server-side to just the rows the caller cares
// about -- without it, every subscriber to a table gets woken up by every
// OTHER caller's unrelated rows too (e.g. a presenter watching their own
// session's responses otherwise also reacts to every other presenter's
// concurrent session), which only costs a wasted refetch at small scale
// but adds up once a table sees real concurrent traffic.
export function subscribeToTable(
  table: string,
  callback: () => void,
  filter?: string,
): () => void {
  const channel = supabase
    .channel(`realtime:${table}:${filter ?? "*"}`)
    .on('postgres_changes', { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) }, callback)
    .subscribe()
  return () => { supabase.removeChannel(channel) }
}

// ── Generic table helpers ───────────────────────────────────

export async function getAll<T>(table: string): Promise<T[]> {
  const { data, error } = await supabase.from(table).select('*')
  if (error) throw new Error(`Supabase getAll(${table}) failed: ${error.message}`)
  return (data ?? []) as T[]
}

export async function insertRecord<T extends Record<string, unknown>>(
  table: string,
  record: T,
): Promise<void> {
  const { error } = await supabase.from(table).insert(record)
  if (error) throw new Error(`Supabase insert(${table}) failed: ${error.message}`)
}

export async function updateRecord<T extends Record<string, unknown> & { id: string }>(
  table: string,
  record: T,
): Promise<void> {
  const { id, ...rest } = record
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await supabase.from(table).update(rest as any).eq('id', id)
  if (error) throw new Error(`Supabase update(${table}) failed: ${error.message}`)
}

export async function deleteRecord(table: string, id: string): Promise<void> {
  const { error } = await supabase.from(table).delete().eq('id', id)
  if (error) throw new Error(`Supabase delete(${table}) failed: ${error.message}`)
}

// ── Table name constants (mirrors old SHEETS export) ────────

export const TABLES = {
  USERS: 'users',
  MONTHLY_TASKS: 'monthly_tasks',
  MONTHLY_DELIVERABLES: 'monthly_deliverables',
  WEEKLY_TASKS: 'weekly_tasks',
  WEEKLY_DELIVERABLES: 'weekly_deliverables',
  DAILY_TASKS: 'daily_tasks',
  SUBMISSIONS: 'submissions',
  LEAVE_REQUESTS: 'leave_requests',
  NOTIFICATIONS: 'notifications',
  ACCOMPLISHMENT_LOGS: 'accomplishment_logs',
  CHAT_MESSAGES: 'chat_messages',
} as const

// ── Storage helpers (replaces drive.ts) ─────────────────────

const EVIDENCE_BUCKET = 'evidence'

export interface UploadedFile {
  path: string
  publicUrl: string
}

/** Uploads a base64 data URL image to Supabase Storage and returns its public URL. */
export async function uploadImageToStorage(
  base64DataUrl: string,
  filename: string,
): Promise<UploadedFile> {
  const blob = dataUrlToBlob(base64DataUrl)
  const path = `${Date.now()}-${filename}`

  const { error } = await supabase.storage
    .from(EVIDENCE_BUCKET)
    .upload(path, blob, { contentType: blob.type, upsert: false })

  if (error) throw new Error(`Storage upload failed: ${error.message}`)

  const { data } = supabase.storage.from(EVIDENCE_BUCKET).getPublicUrl(path)
  return { path, publicUrl: data.publicUrl }
}

export async function uploadFileToStorage(file: File, filename?: string): Promise<UploadedFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        resolve(await uploadImageToStorage(e.target?.result as string, filename ?? file.name))
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(new Error('FileReader failed'))
    reader.readAsDataURL(file)
  })
}

export async function deleteFromStorage(path: string): Promise<void> {
  const { error } = await supabase.storage.from(EVIDENCE_BUCKET).remove([path])
  if (error) throw new Error(`Storage delete failed: ${error.message}`)
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, data] = dataUrl.split(',')
  const mime = header.match(/:(.*?);/)?.[1] ?? 'application/octet-stream'
  const bytes = atob(data)
  const buffer = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) buffer[i] = bytes.charCodeAt(i)
  return new Blob([buffer], { type: mime })
}
