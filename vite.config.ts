import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Replace __SW_VERSION__ in the built service worker with a hash of the emitted
// asset filenames. Those names are content-hashed, so any code change yields a
// new SW cache key and the SW's 'activate' step purges the stale shell. The same
// pass injects the emitted asset list so the first online visit installs a
// complete offline shell rather than caching chunks only after they are used.
function stampServiceWorker() {
  return {
    name: 'stamp-service-worker',
    apply: 'build' as const,
    closeBundle() {
      const swPath = path.resolve(__dirname, 'dist/sw.js')
      const assetsDir = path.resolve(__dirname, 'dist/assets')
      const indexPath = path.resolve(__dirname, 'dist/index.html')
      if (!fs.existsSync(swPath)) {
        return
      }
      const assets = fs.existsSync(assetsDir)
        ? fs
            .readdirSync(assetsDir)
            .sort()
            .map((assetName) => `/assets/${assetName}`)
        : []
      const seed = assets.join('|')
      const version = createHash('sha256').update(seed).digest('hex').slice(0, 12)
      const indexHtml = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : ''
      const entryAssets = [...indexHtml.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)/g)].map(
        (match) => match[1],
      )
      const staticAssets = assets.filter((asset) => !/\.(?:css|js)$/i.test(asset))
      const precacheEntries = [...new Set([...entryAssets, ...staticAssets])]
        .map((asset) => JSON.stringify(asset))
        .join(', ')
      const stamped = fs
        .readFileSync(swPath, 'utf8')
        .replaceAll('__SW_VERSION__', version)
        .replace('/* __SW_PRECACHE__ */', precacheEntries)
      fs.writeFileSync(swPath, stamped)
    },
  }
}

function deferLoginRouteStyles() {
  return {
    name: 'defer-login-route-styles',
    apply: 'build' as const,
    closeBundle() {
      const indexPath = path.resolve(__dirname, 'dist/index.html')
      if (!fs.existsSync(indexPath)) {
        return
      }

      const html = fs.readFileSync(indexPath, 'utf8')
      const transformed = html.replace(
        /<link rel="stylesheet"([^>]*href=["'][^"']+\.css["'][^>]*)>/g,
        (stylesheet) => {
          const preload = stylesheet
            .replace('rel="stylesheet"', 'rel="preload" as="style"')
            .replace('<link ', '<link data-deferred-app-styles ')

          return `${preload}<noscript>${stylesheet}</noscript>`
        },
      )

      fs.writeFileSync(indexPath, transformed)
    },
  }
}

// https://vite.dev/config/
// The Laravel API the dev/preview proxy forwards to. Overridable so a second,
// throwaway stack (another `php artisan serve` port for an ad-hoc QA run) can
// sit next to the default one without editing this file.
const apiProxyTarget = process.env.VITE_DEV_API_TARGET ?? 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react(), tailwindcss(), deferLoginRouteStyles(), stampServiceWorker()],
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
      '/api': { target: apiProxyTarget, changeOrigin: false },
      '/sanctum': { target: apiProxyTarget, changeOrigin: false },
    },
  },
  // `vite preview` serves the production build; mirror the dev proxy so the
  // minified bundle can be exercised locally against the same Laravel API.
  preview: {
    proxy: {
      '/api': { target: apiProxyTarget, changeOrigin: false },
      '/sanctum': { target: apiProxyTarget, changeOrigin: false },
    },
  },
  build: {
    // Preserve route-level dependency boundaries. The previous broad manual
    // chunks pulled charting and UI libraries into the login preload graph.
    modulePreload: {
      resolveDependencies: (_filename, dependencies, context) =>
        context.hostType === 'html'
          ? dependencies.filter(
              (dependency) =>
                !dependency.includes('charts') &&
                !dependency.includes('recharts'),
            )
          : dependencies,
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Vitest runs the frontend unit tests under src/ only. The Playwright e2e
    // specs live in tests/e2e and use
    // @playwright/test's runner — they must not be collected by Vitest.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
