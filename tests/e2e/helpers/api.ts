import { request as pwRequest, type APIRequestContext } from '@playwright/test'
import { ACCOUNTS, DEV_PASSWORD, type AccountKey } from './accounts'
import { authFile } from './auth'

/**
 * Origin the suite talks to. The isolated gate serves the SPA from Vite on
 * :5173 (playwright.config.ts starts it). E2E_BASE_URL lets the same specs run
 * against another origin, such as the production preview bundle on :4173 used
 * by the Lighthouse job or the Docker parity stack on https://localhost:8443,
 * via playwright.external.config.ts.
 */
export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173'

/**
 * Build an authenticated API context from a role's saved storageState (written
 * by auth.setup.ts) - reuses the existing Sanctum session cookie, so it does
 * NOT spend a login against the throttle:10,1 limit. Preferred for the many
 * authz assertions in permissions/api specs.
 */
export async function apiContextFromState(role: AccountKey): Promise<APIRequestContext> {
  return pwRequest.newContext({ baseURL: BASE_URL, storageState: authFile(role) })
}

/** Read & decode the XSRF-TOKEN cookie from a request context's cookie jar. */
export async function xsrfToken(ctx: APIRequestContext): Promise<string | null> {
  const state = await ctx.storageState()
  const cookie = state.cookies.find((c) => c.name === 'XSRF-TOKEN')
  return cookie ? decodeURIComponent(cookie.value) : null
}

/** Common headers the SPA sends; mirrors src/lib/api/client.ts. */
export function ajaxHeaders(token?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    // Sanctum only treats the request as "stateful" when Origin/Referer match.
    Origin: BASE_URL,
    Referer: `${BASE_URL}/`,
  }
  if (token) headers['X-XSRF-TOKEN'] = token
  return headers
}

/**
 * Create a brand-new API context and log it in as `role` via the same flow the
 * SPA uses (prime CSRF cookie → POST /api/auth/login). The returned context
 * carries the authenticated Sanctum session cookie.
 */
export async function apiContextAs(role: AccountKey, password = DEV_PASSWORD): Promise<APIRequestContext> {
  const ctx = await pwRequest.newContext({ baseURL: BASE_URL })
  await ctx.get('/sanctum/csrf-cookie', { headers: ajaxHeaders() })
  const token = await xsrfToken(ctx)
  const res = await ctx.post('/api/auth/login', {
    headers: ajaxHeaders(token),
    data: { identifier: ACCOUNTS[role].identifier, password },
  })
  if (!res.ok()) {
    throw new Error(`apiContextAs(${role}) login failed: ${res.status()} ${await res.text()}`)
  }
  return ctx
}

/** Log in a brand-new API context with arbitrary credentials (used for QA-created users). */
export async function apiLoginRaw(identifier: string, password: string): Promise<APIRequestContext> {
  const ctx = await pwRequest.newContext({ baseURL: BASE_URL })
  await ctx.get('/sanctum/csrf-cookie', { headers: ajaxHeaders() })
  const token = await xsrfToken(ctx)
  const res = await ctx.post('/api/auth/login', { headers: ajaxHeaders(token), data: { identifier, password } })
  if (!res.ok()) throw new Error(`apiLoginRaw(${identifier}) failed: ${res.status()}`)
  return ctx
}

/** A fresh, unauthenticated API context (CSRF primed so unsafe methods are testable). */
export async function anonContext(): Promise<APIRequestContext> {
  const ctx = await pwRequest.newContext({ baseURL: BASE_URL })
  await ctx.get('/sanctum/csrf-cookie', { headers: ajaxHeaders() })
  return ctx
}

/**
 * Reset the shared per-IP rate-limit bucket via the local-only testing route, so
 * a spec's own request volume does not trip the public auth/registration
 * throttles (Laravel keys the default limiter on domain+IP, not path, so those
 * endpoints share one bucket across the whole serial run). Self-contained and
 * best-effort: a non-local backend simply 404s and the call is a no-op.
 */
export async function flushRateLimits(): Promise<void> {
  const ctx = await anonContext()
  try {
    const token = await xsrfToken(ctx)
    await ctx.post('/api/testing/flush-rate-limits', { headers: ajaxHeaders(token) })
  } catch {
    // Best-effort: never fail a test because the reset route was unavailable.
  } finally {
    await ctx.dispose()
  }
}
