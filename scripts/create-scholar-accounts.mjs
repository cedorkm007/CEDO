#!/usr/bin/env node
/**
 * scripts/create-scholar-accounts.mjs
 *
 * Staff-run provisioning script for SCHOLAR accounts — mirrors
 * scripts/create-admin-accounts.mjs, but writes to public.scholars instead
 * of public.users. Scholars do not self-register: CEDO staff creates each
 * scholar's login here (or via a future in-app "Add Scholar" admin screen
 * that calls the same Supabase Admin API from a secure server context).
 *
 * SETUP (same as create-admin-accounts.mjs):
 *   1. Make sure supabase_migration_scholar_portal.sql has been run.
 *   2. .env.scripts must have SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 *   3. Fill in SCHOLAR_ACCOUNTS below (or adapt this to read from a CSV).
 *   4. Run:  node scripts/create-scholar-accounts.mjs
 *
 * WHAT IT DOES, per entry:
 *   - Creates a Supabase Auth user (email + generated password, pre-confirmed).
 *   - Inserts the matching row into public.scholars, keyed to that Auth user's id.
 *   - Skips anyone whose email already has a full account + profile.
 *   - Prints every newly created scholar's ID number / email / password ONCE
 *     at the end — save it into a password manager immediately, this is not
 *     recoverable afterwards (Supabase only stores the hash).
 */

import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

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
  } catch {
    // optional
  }
}
loadEnvScripts()

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    '\nMissing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n' +
    'Create/edit .env.scripts in the project root with both values, then re-run.\n'
  )
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ── Edit this list with real scholar records before running. ──────────────
// scholarIdNumber must be unique. birthday is required (used by the
// name+birthday login path). All other fields map straight to public.scholars.
const SCHOLAR_ACCOUNTS = [
  {
    scholarIdNumber: '20180000',
    firstName: 'Sittie Aliah', lastName: 'Paki', middleName: 'S',
    birthday: '2003-05-14', // YYYY-MM-DD
    email: 'sittiealiah.paki@example.com',
    contactNo: '09171234567',
    school: 'Xavier University', course: 'BS Nursing',
    civilStatus: 'Single', address: 'Cagayan de Oro City',
  },
  // { scholarIdNumber: '20180001', firstName: '...', lastName: '...', middleName: '...', birthday: 'YYYY-MM-DD', email: '...', contactNo: '', school: '', course: '', civilStatus: '', address: '' },
]

function generatePassword(length = 14) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*-_='
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length]
  return out
}

async function findUserByEmail(email) {
  let page = 1
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const match = data.users.find(u => u.email?.toLowerCase() === email.toLowerCase())
    if (match) return match
    if (data.users.length < 200) return null
    page++
  }
}

async function scholarProfileExists(id) {
  const { data, error } = await supabase.from('scholars').select('id').eq('id', id).maybeSingle()
  if (error) throw error
  return !!data
}

async function main() {
  const created = []
  const skipped = []

  for (const s of SCHOLAR_ACCOUNTS) {
    const existingAuthUser = await findUserByEmail(s.email)
    let authUserId = existingAuthUser?.id
    let password = generatePassword()

    if (existingAuthUser) {
      const hasProfile = await scholarProfileExists(existingAuthUser.id)
      if (hasProfile) {
        skipped.push(s.email)
        continue
      }
      const { error: resetError } = await supabase.auth.admin.updateUserById(existingAuthUser.id, { password })
      if (resetError) {
        console.error(`✗ Found existing Auth user for ${s.email} but couldn't reset its password:`, resetError.message)
        continue
      }
      console.log(`↻ ${s.email} already existed in Auth with no scholar profile — password reset, profile will be created now.`)
    } else {
      const { data: authUser, error: createError } = await supabase.auth.admin.createUser({
        email: s.email,
        password,
        email_confirm: true,
        user_metadata: { scholarIdNumber: s.scholarIdNumber, kind: 'scholar' },
      })
      if (createError || !authUser?.user) {
        console.error(`✗ Failed to create Auth user for ${s.email}:`, createError?.message)
        continue
      }
      authUserId = authUser.user.id
    }

    const { error: profileError } = await supabase.from('scholars').insert({
      id: authUserId,
      scholar_id_number: s.scholarIdNumber,
      first_name: s.firstName,
      last_name: s.lastName,
      middle_name: s.middleName ?? '',
      birthday: s.birthday,
      email: s.email,
      contact_no: s.contactNo ?? '',
      school: s.school ?? '',
      course: s.course ?? '',
      civil_status: s.civilStatus ?? '',
      address: s.address ?? '',
    })
    if (profileError) {
      console.error(`✗ Auth user ready for ${s.email}, but scholars row insert failed:`, profileError.message)
      console.error('  Auth user id (for manual insert in Supabase Studio if needed):', authUserId)
      console.error('  Make sure supabase_migration_scholar_portal.sql ran successfully first.')
      continue
    }

    created.push({ ...s, password })
  }

  console.log('\n──────────────────────────────────────────────────────────')
  console.log(`Set up ${created.length} scholar account(s). Skipped ${skipped.length} (already fully set up).`)
  if (skipped.length) console.log('Already existed:', skipped.join(', '))
  console.log('──────────────────────────────────────────────────────────\n')

  if (created.length) {
    console.log('SAVE THESE NOW — this is the only time the passwords are shown.\n')
    console.log('scholarID'.padEnd(12), 'name'.padEnd(28), 'email'.padEnd(32), 'password')
    for (const a of created) {
      console.log(a.scholarIdNumber.padEnd(12), `${a.firstName} ${a.lastName}`.padEnd(28), a.email.padEnd(32), a.password)
    }
    console.log('\nCopy these into a password manager, then clear your terminal (e.g. `clear`).')
    console.log('Share each scholar\'s ID number + password with them directly (not over an open channel).\n')
  }
}

main().catch(err => {
  console.error('Script failed:', err)
  process.exit(1)
})
