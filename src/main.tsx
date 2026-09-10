import { createRoot } from 'react-dom/client'

import './index.css'
import type { SessionPayload } from '@/lib/api/types'
import { installGlobalErrorReporting } from '@/lib/observability/error-reporter'
import { landingPathForRole } from '@/routes/landing'

// Uncaught exceptions, rejected promises and API 5xx answers are reported to
// the maintenance log (sanitised, capped, best-effort). See docs/OBSERVABILITY.md.
installGlobalErrorReporting()

function activateDeferredAppStyles() {
  const stylesheet = document.querySelector<HTMLLinkElement>(
    'link[data-deferred-app-styles]',
  )

  if (!stylesheet) {
    return
  }

  // The document preloads this stylesheet without making it render-blocking.
  // By the time the JavaScript route entry is ready, the CSS bytes are local;
  // applying them before React renders avoids a later reflow.
  stylesheet.rel = 'stylesheet'
  stylesheet.removeAttribute('as')
}

activateDeferredAppStyles()

const root = createRoot(document.getElementById('root')!)

async function renderFullApplication() {
  const [{ AppProviders }, { default: App }] = await Promise.all([
    import('@/app/providers'),
    import('./App.tsx'),
  ])

  root.render(
    <AppProviders>
      <App />
    </AppProviders>,
  )
}

async function renderPublicLogin() {
  const { PublicLoginApp } = await import('@/app/public-login-app')

  root.render(
    <PublicLoginApp
      onAuthenticated={async (user: SessionPayload['user']) => {
        const destination = user.passwordChangeRequired
          ? '/change-password'
          : landingPathForRole(user.role)
        window.history.replaceState(window.history.state, '', destination)
        await renderFullApplication()
      }}
    />,
  )
}

if (window.location.pathname.replace(/\/+$/, '') === '/login') {
  void renderPublicLogin()
} else {
  void renderFullApplication()
}

// Register the offline-first service worker in production only (the Vite dev
// server serves modules that must not be cached). Enables cold-start offline.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {
    // Service worker is a progressive enhancement; ignore registration errors.
  })
}
