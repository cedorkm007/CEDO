#!/usr/bin/env node
/**
 * scripts/import-scholars-from-csv.mjs
 *
 * Bulk version of create-scholar-accounts.mjs — reads scholars from a CSV
 * instead of a hand-typed list. Built for a CSV with just these columns
 * (any order, header spelling is matched loosely — see COLUMN_ALIASES):
 *
 *   Scholar ID Number, First Name, Last Name, Middle Name, Birthday, Address
 *
 * No email column needed. Scholars log in with (Scholar ID + password) or
 * (First/Last/M.I. + Birthday + password) — never an email — so this script
 * auto-generates a synthetic, never-shown login email like
 * "20180000@scholars.cedo.local" purely to satisfy Supabase Auth's
 * email-uniqueness requirement under the hood.
 *
 * BECAUSE THERE'S NO REAL EMAIL: self-service "forgot password" can't work
 * (there's nowhere to send the link). Use scripts/reset-scholar-password.mjs
 * when a scholar needs a new password — that's the supported flow now.
 *
 * SETUP:
 *   1. Run supabase_migration_scholar_portal.sql first.
 *   2. .env.scripts needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 *   3. Run:  node scripts/import-scholars-from-csv.mjs path/to/scholars.csv
 *
 * OUTPUT:
 *   Prints a summary, and writes scholar-credentials-<timestamp>.csv next
 *   to your input file with columns: scholar_id_number,name,password — the
 *   ONLY copy of these plaintext passwords. Distribute it to staff securely
 *   (hand-deliver / encrypted drive), then delete it. Each scholar should be
 *   told to note their password; there's no "check your email" fallback.
 */

import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, basename } from 'node:path'

function loadEnvScripts() {
  const dir = dirname(fileURLToPath(import.meta.url))
  const path = join(dir, '..', '.env.scripts')
  try {
    const text = readFileSync(path, 'utf8')
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      const value = trimmed.slice(eq + 1).trim()
      if (!(key in process.env)) process.env[key] = value
    }
  } catch { /* optional */ }
}
loadEnvScripts()

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const EMAIL_DOMAIN = process.env.SCHOLAR_EMAIL_DOMAIN || 'scholars.cedo.local'

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('\nMissing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.scripts.\n')
  process.exit(1)
}

const csvPath = process.argv[2]
if (!csvPath) {
  console.error('\nUsage: node scripts/import-scholars-from-csv.mjs path/to/scholars.csv\n')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ── Minimal CSV parser (handles quoted fields with commas/newlines) ───────
// No external dependency needed for a straightforward staff-provided export.
function parseCsv(text) {
  const rows = []
  let row = [], field = '', inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1]
    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++ }
      else if (c === '"') { inQuotes = false }
      else { field += c }
    } else {
      if (c === '"') inQuotes = true
      else if (c === ',') { row.push(field); field = '' }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
      else field += c
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows.filter(r => r.some(cell => cell.trim() !== ''))
}

// Loosely matches header variants so small differences in your export don't break the import.
const COLUMN_ALIASES = {
  scholarIdNumber: ['scholar id number', 'scholar id', 'scholarid', 'id number', 'id'],
  firstName: ['first name', 'firstname'],
  lastName: ['last name', 'lastname'],
  middleName: ['middle name', 'middlename', 'm.i.', 'mi'],
  birthday: ['birthday', 'birthdate', 'birth date', 'date of birth', 'dob'],
  address: ['address'],
}

function normalizeHeader(h) { return h.trim().toLowerCase().replace(/\s+/g, ' ') }

function buildColumnMap(headerRow) {
  const normalized = headerRow.map(normalizeHeader)
  const map = {}
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const idx = normalized.findIndex(h => aliases.includes(h))
    if (idx === -1) {
      throw new Error(`Couldn't find a "${field}" column. Looked for headers: ${aliases.join(', ')}. Found: ${headerRow.join(', ')}`)
    }
    map[field] = idx
  }
  return map
}

// Accepts common date formats (MM/DD/YYYY, M/D/YYYY, YYYY-MM-DD) and normalizes to YYYY-MM-DD.
function normalizeBirthday(raw) {
  const s = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) {
    const [, mm, dd, yyyy] = m
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
  }
  return null
}

function generatePassword(length = 12) {
  // Shorter, still-strong, easier for a scholar to copy correctly by hand than the 16-char admin one.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length]
  return out
}

function syntheticEmail(scholarIdNumber) {
  return `${scholarIdNumber.trim().toLowerCase()}@${EMAIL_DOMAIN}`
}

async function loadAllAuthUsersByEmail() {
  const map = new Map()
  let page = 1
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    for (const u of data.users) if (u.email) map.set(u.email.toLowerCase(), u.id)
    if (data.users.length < 1000) break
    page++
  }
  return map
}

async function loadAllScholarIds() {
  const ids = new Set()
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from('scholars').select('scholar_id_number').range(from, from + pageSize - 1)
    if (error) throw error
    for (const row of data) ids.add(row.scholar_id_number)
    if (data.length < pageSize) break
  }
  return ids
}

async function main() {
  const text = readFileSync(csvPath, 'utf8')
  const rows = parseCsv(text)
  if (rows.length < 2) { console.error('CSV has no data rows.'); process.exit(1) }

  const colMap = buildColumnMap(rows[0])
  const dataRows = rows.slice(1)

  console.log(`Loading existing accounts (one-time, so this doesn't get slower per row)…`)
  const authUsersByEmail = await loadAllAuthUsersByEmail()
  const existingScholarIds = await loadAllScholarIds()
  console.log(`Found ${authUsersByEmail.size} existing Auth users, ${existingScholarIds.size} existing scholar profiles.`)
  console.log(`Processing ${dataRows.length} rows…\n`)

  const created = [], skipped = [], failed = []
  const seenInThisFile = new Set()

  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i]
    if ((i + 1) % 250 === 0) console.log(`  … ${i + 1} / ${dataRows.length}`)

    const scholarIdNumber = (r[colMap.scholarIdNumber] || '').trim()
    const firstName = (r[colMap.firstName] || '').trim()
    const lastName = (r[colMap.lastName] || '').trim()
    const middleName = (r[colMap.middleName] || '').trim()
    const address = (r[colMap.address] || '').trim()
    const birthdayRaw = (r[colMap.birthday] || '').trim()
    const birthday = normalizeBirthday(birthdayRaw)

    if (!scholarIdNumber || !firstName || !lastName) {
      failed.push({ row: r, reason: 'Missing Scholar ID / First Name / Last Name' })
      continue
    }
    if (!birthday) {
      failed.push({ row: r, reason: `Unrecognized birthday format: "${birthdayRaw}"` })
      continue
    }
    if (seenInThisFile.has(scholarIdNumber)) {
      failed.push({ row: r, reason: `Duplicate Scholar ID within this CSV: ${scholarIdNumber}` })
      continue
    }
    seenInThisFile.add(scholarIdNumber)

    if (existingScholarIds.has(scholarIdNumber)) {
      skipped.push(scholarIdNumber)
      continue
    }

    const email = syntheticEmail(scholarIdNumber)
    const existingAuthUserId = authUsersByEmail.get(email)
    let authUserId = existingAuthUserId
    const password = generatePassword()

    if (existingAuthUserId) {
      // Auth user exists (from a partial previous run) but no scholars row yet — reuse it, refresh its password.
      const { error: resetError } = await supabase.auth.admin.updateUserById(existingAuthUserId, { password })
      if (resetError) { failed.push({ row: r, reason: resetError.message }); continue }
    } else {
      const { data: authUser, error: createError } = await supabase.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { scholarIdNumber, kind: 'scholar' },
      })
      if (createError || !authUser?.user) {
        failed.push({ row: r, reason: createError?.message || 'Auth user creation failed' })
        continue
      }
      authUserId = authUser.user.id
      authUsersByEmail.set(email, authUserId)
    }

    const { error: profileError } = await supabase.from('scholars').insert({
      id: authUserId,
      scholar_id_number: scholarIdNumber,
      first_name: firstName,
      last_name: lastName,
      middle_name: middleName,
      birthday,
      email,
      address,
    })
    if (profileError) {
      failed.push({ row: r, reason: `Profile insert failed: ${profileError.message}` })
      continue
    }

    created.push({ scholarIdNumber, name: `${firstName} ${lastName}`, password })
  }

  console.log('\n──────────────────────────────────────────────────────────')
  console.log(`Imported ${created.length}. Skipped ${skipped.length} (already existed). Failed ${failed.length}.`)
  console.log('──────────────────────────────────────────────────────────\n')

  if (failed.length) {
    console.log('FAILED ROWS:')
    for (const f of failed) console.log(' -', f.reason, '|', f.row.join(', '))
    console.log('')
  }

  if (created.length) {
    const outPath = join(dirname(csvPath), `scholar-credentials-${Date.now()}.csv`)
    const outLines = ['scholar_id_number,name,password', ...created.map(c => `${c.scholarIdNumber},"${c.name}",${c.password}`)]
    writeFileSync(outPath, outLines.join('\n'), 'utf8')
    console.log(`Credentials written to: ${outPath}`)
    console.log('This is the ONLY copy of these passwords. Distribute securely, then delete the file.\n')
  }
}

main().catch(err => {
  console.error('Import failed:', err)
  process.exit(1)
})
