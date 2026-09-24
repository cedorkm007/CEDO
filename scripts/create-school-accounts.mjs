#!/usr/bin/env node
/**
 * scripts/create-school-accounts.mjs
 *
 * Staff-run provisioning script for SCHOOL accounts — structural mirror of
 * scripts/create-scholar-accounts.mjs, but writes to public.school_accounts
 * instead of public.scholars. Schools do not self-register: CEDO staff
 * creates each school's login here.
 *
 * SETUP:
 *   1. Make sure supabase_migration_scholars_grades_monitoring.sql has been
 *      run (this creates public.schools, backfilled from scholars.school).
 *   2. .env.scripts must have SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 *   3. Fill in SCHOOL_ACCOUNTS below. schoolName must exactly match an
 *      existing row in public.schools — check with:
 *        select name from public.schools order by name;
 *      If the school you want isn't listed (or is listed under a slightly
 *      different spelling than you expected), fix that in the schools
 *      table first rather than creating a duplicate here.
 *   4. Run:  node scripts/create-school-accounts.mjs
 *
 * WHAT IT DOES, per entry:
 *   - Creates a Supabase Auth user (email + generated password, pre-confirmed).
 *   - Inserts the matching row into public.school_accounts, keyed to that
 *     Auth user's id and the matched school_id.
 *   - Skips anyone whose email already has a full account.
 *   - Prints every newly created school's name / email / password ONCE at
 *     the end — save it into a password manager immediately, this is not
 *     recoverable afterwards (Supabase only stores the hash).
 */

import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// @supabase/supabase-js's realtime client requires a native WebSocket
// global, only built into Node 22+. On older Node (this script doesn't
// otherwise need realtime at all — it's a one-shot admin script), polyfill
// it from the `ws` package so createClient() doesn't throw.
if (typeof globalThis.WebSocket === 'undefined') {
  const { default: WebSocket } = await import('ws')
  globalThis.WebSocket = WebSocket
}

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

// ── Edit this list before running. schoolName must exactly match an
// existing public.schools.name row (case-insensitive). ──────────────────
const SCHOOL_ACCOUNTS = [
  { schoolName: 'Capitol University', email: 'grades.capitoluniversity@example.com' },
  // { schoolName: '...', email: '...' },
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

async function findSchoolByName(name) {
  const { data, error } = await supabase.from('schools').select('id, name').ilike('name', name.trim())
  if (error) throw error
  return data?.[0] ?? null
}

async function schoolAccountExists(id) {
  const { data, error } = await supabase.from('school_accounts').select('id').eq('id', id).maybeSingle()
  if (error) throw error
  return !!data
}

async function main() {
  const created = []
  const skipped = []

  for (const entry of SCHOOL_ACCOUNTS) {
    const school = await findSchoolByName(entry.schoolName)
    if (!school) {
      console.error(`✗ No school named "${entry.schoolName}" found in public.schools. Check spelling with: select name from public.schools order by name;`)
      continue
    }

    const existingAuthUser = await findUserByEmail(entry.email)
    let authUserId = existingAuthUser?.id
    let password = generatePassword()

    if (existingAuthUser) {
      const hasAccount = await schoolAccountExists(existingAuthUser.id)
      if (hasAccount) {
        skipped.push(entry.email)
        continue
      }
      const { error: resetError } = await supabase.auth.admin.updateUserById(existingAuthUser.id, { password })
      if (resetError) {
        console.error(`✗ Found existing Auth user for ${entry.email} but couldn't reset its password:`, resetError.message)
        continue
      }
      console.log(`↻ ${entry.email} already existed in Auth with no school account — password reset, account will be created now.`)
    } else {
      const { data: authUser, error: createError } = await supabase.auth.admin.createUser({
        email: entry.email,
        password,
        email_confirm: true,
        user_metadata: { schoolId: school.id, kind: 'school' },
      })
      if (createError || !authUser?.user) {
        console.error(`✗ Failed to create Auth user for ${entry.email}:`, createError?.message)
        continue
      }
      authUserId = authUser.user.id
    }

    const { error: accountError } = await supabase.from('school_accounts').insert({
      id: authUserId,
      school_id: school.id,
      email: entry.email,
    })
    if (accountError) {
      console.error(`✗ Auth user ready for ${entry.email}, but school_accounts row insert failed:`, accountError.message)
      console.error('  Auth user id (for manual insert in Supabase Studio if needed):', authUserId)
      continue
    }

    created.push({ schoolName: school.name, email: entry.email, password })
  }

  console.log('\n──────────────────────────────────────────────────────────')
  console.log(`Set up ${created.length} school account(s). Skipped ${skipped.length} (already fully set up).`)
  if (skipped.length) console.log('Already existed:', skipped.join(', '))
  console.log('──────────────────────────────────────────────────────────\n')

  if (created.length) {
    console.log('SAVE THESE NOW — this is the only time the passwords are shown.\n')
    console.log('school'.padEnd(32), 'email'.padEnd(32), 'password')
    for (const a of created) {
      console.log(a.schoolName.padEnd(32), a.email.padEnd(32), a.password)
    }
    console.log('\nCopy these into a password manager, then clear your terminal (e.g. `clear`).')
    console.log('Share each school\'s login (school name + password) with them directly (not over an open channel).\n')
  }
}

main().catch(err => {
  console.error('Script failed:', err)
  process.exit(1)
})
