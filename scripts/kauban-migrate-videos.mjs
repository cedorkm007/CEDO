#!/usr/bin/env node
/**
 * scripts/kauban-migrate-videos.mjs
 *
 * One-time bulk migration of Kauban's existing ~70 FSL sign-language
 * videos (from the original Laravel app's public/fsl/ folder) into
 * Supabase Storage, compressed the same way the admin uploader compresses
 * new ones (docs/kauban/PROGRESS.md, milestone 3/8).
 *
 * WHY A SEPARATE NATIVE SCRIPT INSTEAD OF THE IN-BROWSER COMPRESSOR:
 * The admin uploader's ffmpeg.wasm compressor (src/kauban/admin/
 * videoCompression.ts) is the right tool for an admin adding one or two
 * words later, but it's software-only WASM encoding — far slower than a
 * native ffmpeg binary. Pushing all ~70 existing files through it would
 * take a long time in an open browser tab. This script uses ffmpeg-static
 * (a real ffmpeg binary) instead, purely for this one bulk job.
 *
 * WHY THE SERVICE ROLE KEY, NOT THE UPLOADER'S RLS-GATED path:
 * This uploads directly via the Supabase service role key (bypasses Row
 * Level Security), the same pattern as create-admin-accounts.mjs — this
 * is a trusted, local, one-time operation, not something a browser client
 * should ever be able to do with the anon key.
 *
 * The compression settings (strip audio, cap 720px long edge, H.264
 * CRF 28, yuv420p, faststart) are the same as videoCompression.ts's — if
 * you change one, change both, so a video looks the same regardless of
 * which tool compressed it.
 *
 * SETUP:
 *   1. Extract "Kauban App.zip" (the original Laravel app) somewhere, e.g.
 *      to your Desktop.
 *   2. Create `.env.scripts` in the project root (see .env.scripts.example)
 *      with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 *   3. Run: node scripts/kauban-migrate-videos.mjs --source "C:\path\to\Kauban App\Kauban\public\fsl"
 *      (that folder must contain videos/*.mp4 and tutorial/<category>/*.mp4,
 *      matching the original app's own layout — see docs/kauban/PROGRESS.md
 *      milestone 1.)
 *
 * WHAT IT DOES, per file in both videos/ (-> "clip" variant) and
 * tutorial/** (-> "tutorial" variant):
 *   - Compresses it into a temp file with the native ffmpeg binary.
 *   - Uploads the compressed file to the `kauban-media` bucket at
 *     clips/<filename> or tutorial/<filename> (upsert: true, so re-running
 *     after fixing a problem file is safe).
 *   - Does NOT touch kauban_sign_words rows — supabase_migration_
 *     kauban_seed_content.sql already sets each word's clip_video_path /
 *     tutorial_video_path to these exact same paths, so as long as both
 *     are run, the videos just "show up" without this script needing to
 *     know about words/phrases at all.
 *   - Prints a per-file original-size -> compressed-size line, plus a
 *     summary of failures (if any) at the end. Safe to re-run — failed or
 *     skipped files can just be run again.
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, extname } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import ffmpegPath from 'ffmpeg-static'
import { WebSocket } from 'ws'

// supabase-js always constructs a Realtime client (even though this
// script only ever calls .storage.upload(), never anything realtime),
// which throws immediately on Node < 22 if `WebSocket` isn't a global —
// confirmed by hand while writing this script. `ws` is already a
// devDependency for exactly this.
if (!globalThis.WebSocket) globalThis.WebSocket = WebSocket

const execFileAsync = promisify(execFile)

// ── Load .env.scripts (same helper/convention as create-admin-accounts.mjs) ──
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
    // .env.scripts is optional if these are already set some other way (CI secrets, etc.)
  }
}
loadEnvScripts()

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const MEDIA_BUCKET = 'kauban-media'

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    '\nMissing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n' +
    'Create a file named .env.scripts in the project root (see .env.scripts.example)\n' +
    'with both values, then run this script again.\n'
  )
  process.exit(1)
}

const sourceArgIndex = process.argv.indexOf('--source')
const sourceDir = sourceArgIndex !== -1 ? process.argv[sourceArgIndex + 1] : null
if (!sourceDir) {
  console.error(
    '\nUsage: node scripts/kauban-migrate-videos.mjs --source "<path to the extracted app\'s public/fsl folder>"\n' +
    'That folder must contain a videos/ subfolder and a tutorial/ subfolder — see this file\'s\n' +
    'top comment for the full setup steps.\n'
  )
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Recursively finds every .mp4 under `dir` (tutorial/ nests one level by
 *  category, e.g. tutorial/greetings/hello.mp4 — videos/ doesn't nest). */
function findMp4Files(dir) {
  const results = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) results.push(...findMp4Files(full))
    else if (extname(entry.name).toLowerCase() === '.mp4') results.push(full)
  }
  return results
}

async function compressVideo(inputPath, outputPath) {
  await execFileAsync(ffmpegPath, [
    '-y',
    '-i', inputPath,
    '-an',
    '-vf', "scale=w='min(720,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2",
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '28',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outputPath,
  ])
}

async function migrateVariant(variantDir, folder, tempDir) {
  let files
  try {
    files = findMp4Files(variantDir)
  } catch {
    console.log(`  (no ${folder}/ folder found at ${variantDir} — skipping this variant)`)
    return { succeeded: 0, failed: [] }
  }

  let succeeded = 0
  const failed = []

  for (const inputPath of files) {
    const filename = inputPath.split(/[\\/]/).pop()
    const outputPath = join(tempDir, `${folder}-${filename}`)
    process.stdout.write(`  ${folder}/${filename} — compressing...`)
    try {
      const originalSize = statSync(inputPath).size
      await compressVideo(inputPath, outputPath)
      const compressedBuffer = readFileSync(outputPath)

      const { error } = await supabase.storage
        .from(MEDIA_BUCKET)
        .upload(`${folder}/${filename}`, compressedBuffer, { contentType: 'video/mp4', upsert: true })
      if (error) throw error

      console.log(`\r  ${folder}/${filename} — ${formatBytes(originalSize)} -> ${formatBytes(compressedBuffer.length)}          `)
      succeeded++
    } catch (err) {
      console.log(`\r  ${folder}/${filename} — FAILED: ${err.message}                    `)
      failed.push(filename)
    } finally {
      try { rmSync(outputPath, { force: true }) } catch { /* ignore */ }
    }
  }

  return { succeeded, failed }
}

async function main() {
  console.log(`\nUsing ffmpeg: ${ffmpegPath}`)
  console.log(`Reading from: ${sourceDir}\n`)

  const tempDir = mkdtempSync(join(tmpdir(), 'kauban-migrate-'))
  try {
    console.log('Clips (videos/):')
    const clipResult = await migrateVariant(join(sourceDir, 'videos'), 'clips', tempDir)

    console.log('\nTutorials (tutorial/):')
    const tutorialResult = await migrateVariant(join(sourceDir, 'tutorial'), 'tutorial', tempDir)

    const totalSucceeded = clipResult.succeeded + tutorialResult.succeeded
    const totalFailed = [...clipResult.failed, ...tutorialResult.failed]

    console.log('\n──────────────────────────────────────────────────────────')
    console.log(`Uploaded ${totalSucceeded} video(s) successfully.`)
    if (totalFailed.length) {
      console.log(`Failed (${totalFailed.length}) — safe to fix and re-run just this script:`, totalFailed.join(', '))
    }
    console.log('──────────────────────────────────────────────────────────\n')
    console.log('Next: run supabase_migration_kauban_seed_content.sql (if you haven\'t already)')
    console.log('so kauban_sign_words has rows pointing at these exact paths.\n')
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

main().catch(err => {
  console.error('Script failed:', err)
  process.exit(1)
})
