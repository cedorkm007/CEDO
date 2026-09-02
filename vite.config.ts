import { defineConfig } from 'vite'
import path from 'path'
import { execSync } from 'child_process'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

// A visible build marker (KaubanTopNav.tsx) is the only way to tell, from
// the device itself, whether it's actually running the code just deployed
// — TWAs share Chrome's own site storage, so "clear app data" on Android
// doesn't touch it, and a stuck old service worker can make a phone look
// unfixed for reasons that have nothing to do with the code shipped.
// Vercel sets its own commit env var at build time; `git` is the fallback
// for local builds.
function getBuildVersion(): string {
  const sha =
    process.env.VERCEL_GIT_COMMIT_SHA ??
    (() => {
      try {
        return execSync('git rev-parse HEAD').toString().trim();
      } catch {
        return 'unknown';
      }
    })();
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  return `${sha.slice(0, 7)} · ${stamp} UTC`;
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

export default defineConfig({
  plugins: [
    figmaAssetResolver(),
    react(),
    tailwindcss(),
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
    __KAUBAN_BUILD__: JSON.stringify(getBuildVersion()),
  },
})
