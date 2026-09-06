/**
 * Remembers, per browser, whether this device has signed in and not signed out
 * since. The public auth screens (/login, /register, /forgot-password,
 * /reset-password) use it to decide whether probing /api/auth/me is worth a
 * request: without the hint the probe is known to answer 401, which the
 * browser reports in the console on every cold visit (QA-025).
 *
 * The hint is only an optimisation. When storage is unavailable or has been
 * cleared the app falls back to probing, exactly as before, so a live session
 * is never hidden; the worst case is one avoidable 401 in the console.
 */
const STORAGE_KEY = 'imreport.session-hint'

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** True when a probe is warranted: the device signed in, or we cannot tell. */
export function hasSessionHint(): boolean {
  const store = storage()
  if (!store) {
    return true
  }

  try {
    return store.getItem(STORAGE_KEY) === '1'
  } catch {
    return true
  }
}

export function rememberSessionHint(): void {
  try {
    storage()?.setItem(STORAGE_KEY, '1')
  } catch {
    // Storage full or blocked: the next visit simply probes.
  }
}

export function forgetSessionHint(): void {
  try {
    storage()?.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to clear.
  }
}
