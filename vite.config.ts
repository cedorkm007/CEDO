import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

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
})
