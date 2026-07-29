#!/usr/bin/env node
/**
 * scripts/reset-scholar-password.mjs
 *
 * Since scholar accounts use a synthetic, never-shown login email (there's
 * no real inbox to send a reset link to), password resets are staff-run
 * instead of self-service. Look the scholar up by Scholar ID number, get a
 * freshly generated password, hand it to them directly.
 *
 * SETUP: .env.scripts needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * USAGE:  node scripts/reset-scholar-password.mjs 20180000
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
  } catch { /* optional */ }
}
loadEnvScripts()

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const scholarIdNumber = process.argv[2]

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('\nMissing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.scripts.\n')
  process.exit(1)
}
if (!scholarIdNumber) {
  console.error('\nUsage: node scripts/reset-scholar-password.mjs <scholarIdNumber>\n')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function generatePassword(length = 12) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length]
  return out
}

async function main() {
  const { data: scholar, error } = await supabase
    .from('scholars')
    .select('id, first_name, last_name, scholar_id_number')
    .eq('scholar_id_number', scholarIdNumber)
    .maybeSingle()

  if (error || !scholar) {
    console.error(`No scholar found with Scholar ID "${scholarIdNumber}".`)
    process.exit(1)
  }

  const newPassword = generatePassword()
  const { error: updateError } = await supabase.auth.admin.updateUserById(scholar.id, { password: newPassword })
  if (updateError) {
    console.error('Failed to reset password:', updateError.message)
    process.exit(1)
  }

  console.log('\n──────────────────────────────────────────────────────────')
  console.log(`New password for ${scholar.first_name} ${scholar.last_name} (${scholar.scholar_id_number}):`)
  console.log(`  ${newPassword}`)
  console.log('──────────────────────────────────────────────────────────')
  console.log('Hand this to the scholar directly. This is the only time it is shown.\n')
}

main().catch(err => { console.error('Script failed:', err); process.exit(1) })
