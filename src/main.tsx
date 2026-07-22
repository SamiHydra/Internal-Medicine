import { createRoot } from 'react-dom/client'

import { AppProviders } from '@/app/providers'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <AppProviders>
    <App />
  </AppProviders>,
)

// Register the offline-first service worker in production only (the Vite dev
// server serves modules that must not be cached). Enables cold-start offline.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Service worker is a progressive enhancement; ignore registration errors.
    })
  })
}
