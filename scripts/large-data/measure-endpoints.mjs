/**
 * Times a list of authenticated endpoints with ONE sign-in (the login limiter
 * is 10 per minute per address, so a sign-in per request would throttle the
 * measurement itself). Used by scripts/large-data/measure.sh.
 *
 *   node scripts/large-data/measure-endpoints.mjs <attempts> <path> [path...]
 *
 * Prints one TSV line per path: path, then <attempts> durations in ms (the
 * first is the cold request after the caller cleared the cache), then the
 * last HTTP status. Environment: CHAOS_BASE_URL, CHAOS_ADMIN, CHAOS_PASSWORD.
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

const BASE = (process.env.CHAOS_BASE_URL ?? 'https://localhost:8443').replace(/\/+$/, '')
const IDENTIFIER = process.env.CHAOS_ADMIN ?? 'admin@stpaulos.local'
const PASSWORD = process.env.CHAOS_PASSWORD ?? 'StPaul2026!'

const cookies = new Map()

function storeCookies(response) {
  const values =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean)
  for (const header of values) {
    for (const cookie of header.split(/,(?=\s*[^;,]+=)/g)) {
      const [pair] = cookie.split(';')
      const index = pair.indexOf('=')
      if (index <= 0) continue
      const name = pair.slice(0, index).trim()
      const value = pair.slice(index + 1).trim()
      if (value === '') cookies.delete(name)
      else cookies.set(name, value)
    }
  }
}

async function call(method, path, body) {
  const headers = {
    Accept: 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    Origin: BASE,
    Referer: `${BASE}/`,
    Cookie: [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; '),
  }
  const token = cookies.get('XSRF-TOKEN')
  if (token && method !== 'GET') headers['X-XSRF-TOKEN'] = decodeURIComponent(token)
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const started = performance.now()
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
    signal: AbortSignal.timeout(120_000),
  })
  storeCookies(response)
  const text = await response.text()
  return { status: response.status, ms: Math.round(performance.now() - started), bytes: text.length }
}

const [attemptsArgument, ...paths] = process.argv.slice(2)
const attempts = Math.max(1, Number.parseInt(attemptsArgument ?? '4', 10) || 4)

await call('GET', '/sanctum/csrf-cookie')
const login = await call('POST', '/api/auth/login', { identifier: IDENTIFIER, password: PASSWORD })
if (login.status !== 200) {
  console.error(`login failed: ${login.status}`)
  process.exit(1)
}

for (const path of paths) {
  const durations = []
  let status = 0
  let bytes = 0
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const result = await call('GET', path)
      durations.push(result.ms)
      status = result.status
      bytes = result.bytes
    } catch (error) {
      durations.push(-1)
      status = 0
      void error
    }
  }
  console.log([path, ...durations, status, bytes].join('\t'))
}
