import { defineConfig } from 'vite'
import path from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

// Both the visible build marker (KaubanTopNav.tsx) and kauban-sw.js's own
// cache version (see stampServiceWorkerCacheVersion below) are keyed off
// this same commit — Vercel sets its own commit env var at build time;
// `git` is the fallback for local builds.
function getShortSha(): string {
  const sha =
    process.env.VERCEL_GIT_COMMIT_SHA ??
    (() => {
      try {
        return execSync('git rev-parse HEAD').toString().trim();
      } catch {
        return 'unknown';
      }
    })();
  return sha.slice(0, 7);
}

// A visible build marker is the only way to tell, from the device itself,
// whether it's actually running the code just deployed — TWAs share
// Chrome's own site storage, so "clear app data" on Android doesn't touch
// it, and a stuck old service worker can make a phone look unfixed for
// reasons that have nothing to do with the code shipped.
function getBuildVersion(shortSha: string): string {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  return `${shortSha} · ${stamp} UTC`;
}

// public/kauban-sw.js's CACHE_VERSION was a hardcoded literal, unchanged
// across deploys — its own activate handler only deletes cache *names*
// other than the current one, so with the name never changing, nothing
// was ever actually purged between deploys. Every deploy's JS/CSS is
// content-hashed by Vite, and __KAUBAN_BUILD__ above embeds a timestamp
// that changes every file's hash on every single build, so the shell
// cache just accumulated a full, never-reused copy of every past deploy's
// bundle forever. Across many deploys in a short span that's real growth
// (the main bundle alone is a couple MB), and eventually risks hitting a
// storage quota and failing silently — which looks exactly like a stuck,
// blank app shell on a phone with no error to point at. Stamping a
// unique CACHE_VERSION per deploy makes that cleanup actually run.
function stampServiceWorkerCacheVersion(shortSha: string) {
  return {
    name: 'stamp-service-worker-cache-version',
    writeBundle(options: { dir?: string }) {
      const outDir = options.dir ?? 'dist';
      const swPath = path.join(outDir, 'kauban-sw.js');
      if (!existsSync(swPath)) return;
      const contents = readFileSync(swPath, 'utf-8');
      const patched = contents.replace(
        /const CACHE_VERSION = "kauban-v\d+";/,
        `const CACHE_VERSION = "kauban-${shortSha}";`
      );
      if (patched === contents) {
        console.warn('[stamp-service-worker-cache-version] CACHE_VERSION pattern not found in kauban-sw.js — version not stamped');
        return;
      }
      writeFileSync(swPath, patched);
    },
  };
}

function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id: string) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

const shortSha = getShortSha();

export default defineConfig({
  plugins: [
    figmaAssetResolver(),
    react(),
    tailwindcss(),
    stampServiceWorkerCacheVersion(shortSha),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // @ffmpeg/ffmpeg spawns its own worker via `new Worker(new URL(...))`
  // internally (src/kauban/admin/videoCompression.ts) — Vite's dev-server
  // dependency pre-bundler rewrites that in a way that leaves the worker
  // request stuck pending forever in dev mode (production `vite build`
  // isn't affected, since Rollup handles it differently). Excluding both
  // packages from pre-bundling is the documented fix.
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  assetsInclude: ['**/*.svg', '**/*.csv'],
  // Expose env variables prefixed with VITE_ to the client
  envPrefix: 'VITE_',
  define: {
    __KAUBAN_BUILD__: JSON.stringify(getBuildVersion(shortSha)),
  },
})
