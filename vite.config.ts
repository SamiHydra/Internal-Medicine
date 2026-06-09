import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Replace __SW_VERSION__ in the built service worker with a hash of the emitted
// asset filenames. Those names are content-hashed, so any code change yields a
// new SW cache key and the SW's 'activate' step purges the stale shell — closing
// the "offline user keeps an old index.html referencing dead assets" gap.
function stampServiceWorker() {
  return {
    name: 'stamp-service-worker',
    apply: 'build' as const,
    closeBundle() {
      const swPath = path.resolve(__dirname, 'dist/sw.js')
      const assetsDir = path.resolve(__dirname, 'dist/assets')
      if (!fs.existsSync(swPath)) {
        return
      }
      const seed = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir).sort().join('|') : ''
      const version = createHash('sha256').update(seed).digest('hex').slice(0, 12)
      const stamped = fs.readFileSync(swPath, 'utf8').replaceAll('__SW_VERSION__', version)
      fs.writeFileSync(swPath, stamped)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), stampServiceWorker()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // Proxy the Laravel API through the Vite origin so the browser treats the
    // SPA and API as same-origin. This keeps Sanctum's SameSite session/XSRF
    // cookies working (localhost vs 127.0.0.1 would otherwise be cross-site).
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: false },
      '/sanctum': { target: 'http://127.0.0.1:8000', changeOrigin: false },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return
          }

          if (id.includes('recharts')) {
            return 'charts'
          }

          if (id.includes('framer-motion')) {
            return 'motion'
          }

          if (id.includes('@radix-ui')) {
            return 'radix-ui'
          }

          if (
            id.includes('react-router') ||
            id.includes('react-dom') ||
            id.includes('/react/')
          ) {
            return 'react-core'
          }

          return 'vendor'
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
})
