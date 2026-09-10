/**
 * HTTP probe for the failure drills (docs/FAILURE_RECOVERY_TEST_REPORT.md).
 *
 * The drills orchestrate Docker from bash, but their HTTP checks need a cookie
 * jar, the CSRF dance and a stateful Origin, which curl under Git Bash handles
 * badly (path conversion, jar rewrites). This does exactly that and prints one
 * machine-readable line, so the shell stays simple and the results stay honest.
 *
 *   node scripts/chaos/probe.mjs <command> [args]
 *
 * Commands:
 *   up                       liveness only, no session
 *   anon <path>              one unauthenticated request
 *   read <path> [path...]    sign in, then GET each path
 *   ready [timeoutSeconds]   poll until an authenticated read succeeds
 *   export                   request an analytics export, print its id
 *   export-status <id>       print that export's status
 *   export-wait [sec] [fmt]  request an export and poll it in one session
 *   upload <itemId> <file>   upload evidence to an action item
 *   timed <path>             one authenticated GET, with milliseconds
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

function cookieHeader() {
  return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ')
}

function xsrf() {
  const value = cookies.get('XSRF-TOKEN')
  return value ? decodeURIComponent(value) : null
}

async function call(method, path, { body, form, timeoutMs = 20_000 } = {}) {
  const headers = {
    Accept: 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    Origin: BASE,
    Referer: `${BASE}/`,
  }
  const jar = cookieHeader()
  if (jar) headers.Cookie = jar
  if (!['GET', 'HEAD'].includes(method)) {
    const token = xsrf()
    if (token) headers['X-XSRF-TOKEN'] = token
  }

  let payload
  if (form) {
    payload = form
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }

  const started = performance.now()
  try {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: payload,
      signal: AbortSignal.timeout(timeoutMs),
    })
    storeCookies(response)
    const text = await response.text()
    return { status: response.status, ms: Math.round(performance.now() - started), text }
  } catch (error) {
    return {
      status: 0,
      ms: Math.round(performance.now() - started),
      text: error instanceof Error ? error.message : String(error),
    }
  }
}

async function signIn() {
  await call('GET', '/sanctum/csrf-cookie')
  const response = await call('POST', '/api/auth/login', {
    body: { identifier: IDENTIFIER, password: PASSWORD },
  })
  return response.status
}

function json(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const [command, ...args] = process.argv.slice(2)

switch (command) {
  case 'up': {
    const response = await call('GET', '/up')
    console.log(`up=${response.status} ms=${response.ms}`)
    break
  }

  case 'anon': {
    const response = await call('GET', args[0])
    console.log(`status=${response.status} ms=${response.ms}`)
    break
  }

  case 'read': {
    const login = await signIn()
    const parts = [`login=${login}`]
    for (const path of args) {
      const response = await call('GET', path)
      parts.push(`${path}=${response.status}`)
    }
    console.log(parts.join(' '))
    break
  }

  case 'timed': {
    const login = await signIn()
    const response = await call('GET', args[0])
    console.log(`login=${login} status=${response.status} ms=${response.ms}`)
    break
  }

  case 'ready': {
    const deadline = Date.now() + Number(args[0] ?? 240) * 1000
    const started = Date.now()
    let lastStatus = 0
    let lastLogin = 0

    while (Date.now() < deadline) {
      // Re-authenticate at most every 30 s: the login limiter is 10/min per IP.
      if (Date.now() - lastLogin > 30_000) {
        lastLogin = Date.now()
        await signIn()
      }
      const response = await call('GET', '/api/workspace', { timeoutMs: 10_000 })
      lastStatus = response.status
      if (response.status === 200) {
        console.log(`ready=yes seconds=${Math.round((Date.now() - started) / 1000)} status=200`)
        process.exit(0)
      }
      await new Promise((resolve) => setTimeout(resolve, 3000))
    }

    console.log(`ready=no seconds=${Math.round((Date.now() - started) / 1000)} status=${lastStatus}`)
    process.exit(1)
  }

  case 'export': {
    const login = await signIn()
    const response = await call('POST', '/api/analytics/exports', { body: { format: 'csv' } })
    const id = json(response.text)?.id ?? ''
    console.log(`login=${login} status=${response.status} id=${id}`)
    break
  }

  // Request an export and poll it inside ONE session: a sign-in per poll
  // (the old shell loop) spent the 10/min login limiter on itself.
  case 'export-wait': {
    const maxSeconds = Number.parseInt(args[0] ?? '600', 10) || 600
    const format = args[1] ?? 'xlsx'
    const login = await signIn()
    const requested = await call('POST', '/api/analytics/exports', { body: { format } })
    const id = json(requested.text)?.id ?? ''
    if (!id) {
      console.log(`login=${login} status=${requested.status} export=refused seconds=0 detail=${requested.text.slice(0, 160).replace(/\s+/g, ' ')}`)
      break
    }
    const started = Date.now()
    let state = 'pending'
    while ((Date.now() - started) / 1000 < maxSeconds) {
      const listed = await call('GET', '/api/analytics/exports')
      const row = (json(listed.text)?.data ?? []).find((entry) => entry.id === id)
      state = row?.status ?? 'missing'
      if (state === 'ready' || state === 'failed' || state === 'missing') break
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
    console.log(`login=${login} status=${requested.status} id=${id} export=${state} seconds=${Math.round((Date.now() - started) / 1000)}`)
    break
  }

  case 'export-status': {
    await signIn()
    const response = await call('GET', '/api/analytics/exports')
    const row = (json(response.text)?.data ?? []).find((entry) => entry.id === args[0])
    console.log(`status=${response.status} export=${row?.status ?? 'missing'}`)
    break
  }

  case 'action-item': {
    await signIn()
    const response = await call('GET', '/api/admin/action-items')
    const id = (json(response.text)?.data ?? [])[0]?.id ?? ''
    console.log(`status=${response.status} id=${id}`)
    break
  }

  case 'upload': {
    const [itemId, filePath] = args
    const login = await signIn()
    const { readFile } = await import('node:fs/promises')
    const form = new FormData()
    form.append('file', new Blob([await readFile(filePath)]), 'chaos-evidence.txt')
    const response = await call('POST', `/api/admin/action-items/${itemId}/evidence`, { form })
    const message = (json(response.text)?.message ?? response.text).slice(0, 160).replace(/\s+/g, ' ')
    console.log(`login=${login} status=${response.status} message=${message}`)
    break
  }

  default:
    console.error(`unknown command: ${command}`)
    process.exit(2)
}
