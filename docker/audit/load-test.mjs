import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

const envInt = (key, fallback) => {
  const value = Number.parseInt(process.env[key] ?? '', 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}
const envString = (key, fallback) => process.env[key]?.trim() || fallback

const config = {
  baseUrl: envString('LOAD_BASE_URL', 'https://localhost:18443').replace(/\/+$/, ''),
  frontendOrigin: envString('LOAD_FRONTEND_ORIGIN', 'https://localhost:18443'),
  users: envInt('LOAD_USERS', 200),
  durationSeconds: envInt('LOAD_DURATION_SECONDS', 600),
  rampSeconds: envInt('LOAD_RAMP_SECONDS', 60),
  thinkMinMs: envInt('LOAD_THINK_MIN_MS', 250),
  thinkMaxMs: envInt('LOAD_THINK_MAX_MS', 1200),
  timeoutMs: envInt('LOAD_REQUEST_TIMEOUT_MS', 15000),
  detailBatchSize: envInt('LOAD_DETAIL_BATCH_SIZE', 20),
  preparationConcurrency: envInt('LOAD_PREPARATION_CONCURRENCY', 10),
  profile: envString('LOAD_PROFILE', 'standard'),
  credentialsFile: envString(
    'LOAD_CREDENTIALS_FILE',
    'docker/audit/evidence/load-credentials.csv',
  ),
  output: envString('LOAD_OUTPUT', 'docker/audit/evidence/load.json'),
  readyFile: process.env.LOAD_READY_FILE?.trim(),
  goFile: process.env.LOAD_GO_FILE?.trim(),
}

class CookieJar {
  cookies = new Map()

  store(headers) {
    const values =
      typeof headers.getSetCookie === 'function'
        ? headers.getSetCookie()
        : [headers.get('set-cookie')].filter(Boolean)
    for (const header of values) {
      for (const cookie of header.split(/,(?=\s*[^;,]+=)/g)) {
        const [pair] = cookie.split(';')
        const separator = pair.indexOf('=')
        if (separator <= 0) continue
        const name = pair.slice(0, separator).trim()
        const value = pair.slice(separator + 1).trim()
        if (value) this.cookies.set(name, value)
        else this.cookies.delete(name)
      }
    }
  }

  header() {
    return [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; ')
  }

  xsrf() {
    const value = this.cookies.get('XSRF-TOKEN')
    return value ? decodeURIComponent(value) : null
  }
}

class Session {
  constructor(credential, index) {
    this.credential = credential
    this.jar = new CookieJar()
    this.reportIds = []
    this.sourceIp = `10.250.${Math.floor(index / 250)}.${(index % 250) + 1}`
  }

  async login() {
    await request(this, 'GET', '/sanctum/csrf-cookie', 'csrf', {}, false)
    await request(
      this,
      'POST',
      '/api/auth/login',
      'login',
      {
        body: {
          identifier: this.credential.identifier,
          password: this.credential.password,
        },
      },
      false,
    )
  }

  async prime() {
    const body = await request(
      this,
      'GET',
      workspacePath(),
      'workspace-prime',
      {},
      false,
    )
    const payload = body ? JSON.parse(body) : null
    this.reportIds = Array.isArray(payload?.state?.reports)
      ? payload.state.reports.map((row) => row?.id).filter(Boolean)
      : []
  }
}

const metrics = {
  byEndpoint: new Map(),
  failures: [],
  timeline: new Map(),
  loadStartedAt: 0,
}

function workspacePath() {
  const query = new URLSearchParams({
    includeProfiles: '0',
    includeAccessRequests: '0',
    includeHistory: '0',
  })
  return `/api/workspace?${query}`
}

async function request(session, method, target, endpoint, options = {}, record = true) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)
  const headers = {
    Accept: 'application/json',
    Origin: config.frontendOrigin,
    Referer: `${config.frontendOrigin}/`,
    'X-Requested-With': 'XMLHttpRequest',
    'X-Forwarded-For': session.sourceIp,
  }
  const cookie = session.jar.header()
  if (cookie) headers.Cookie = cookie
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const token = session.jar.xsrf()
    if (token) headers['X-XSRF-TOKEN'] = token
  }

  let body
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.body)
  }

  const started = performance.now()
  let status = 0
  try {
    const response = await fetch(`${config.baseUrl}${target}`, {
      method,
      headers,
      body,
      redirect: 'manual',
      signal: controller.signal,
    })
    status = response.status
    session.jar.store(response.headers)
    const text = await response.text()
    const elapsed = performance.now() - started
    const ok = response.status >= 200 && response.status < 400
    if (record) recordResult(endpoint, response.status, elapsed, text.length, ok)
    if (!ok) {
      throw new Error(`${method} ${target} returned ${response.status}: ${text.slice(0, 180)}`)
    }
    return text
  } catch (error) {
    const elapsed = performance.now() - started
    if (record && status === 0) recordResult(endpoint, 0, elapsed, 0, false)
    if (record && metrics.failures.length < 30) {
      metrics.failures.push({
        endpoint,
        status,
        message: error instanceof Error ? error.message : String(error),
      })
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function recordResult(endpoint, status, durationMs, bytes, ok) {
  const current = metrics.byEndpoint.get(endpoint) ?? {
    count: 0,
    ok: 0,
    failed: 0,
    bytes: 0,
    durations: [],
    statuses: {},
  }
  current.count += 1
  current.ok += ok ? 1 : 0
  current.failed += ok ? 0 : 1
  current.bytes += bytes
  current.durations.push(durationMs)
  current.statuses[status] = (current.statuses[status] ?? 0) + 1
  metrics.byEndpoint.set(endpoint, current)

  const second = Math.max(0, (Date.now() - metrics.loadStartedAt) / 1000)
  const bucket = Math.floor(second / 10) * 10
  const timeline = metrics.timeline.get(bucket) ?? { requests: 0, ok: 0, failed: 0 }
  timeline.requests += 1
  timeline.ok += ok ? 1 : 0
  timeline.failed += ok ? 0 : 1
  metrics.timeline.set(bucket, timeline)
}

function percentile(values, pct) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((pct / 100) * sorted.length) - 1)]
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const random = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min
const sample = (items) => items[Math.floor(Math.random() * items.length)]

function detailIds(session) {
  const count = Math.min(config.detailBatchSize, session.reportIds.length)
  const ids = []
  for (let index = 0; index < count; index += 1) ids.push(sample(session.reportIds))
  return [...new Set(ids)]
}

async function oneJourneyRequest(session) {
  const roll = Math.random()
  const spike = config.profile === 'spike'
  try {
    if ((!spike && roll < 0.45) || (spike && roll < 0.15)) {
      await request(session, 'GET', '/api/workspace/revision', 'workspace-revision')
    } else if ((!spike && roll < 0.6) || (spike && roll < 0.5)) {
      await request(session, 'GET', workspacePath(), 'workspace')
    } else if ((!spike && roll < 0.82) || (spike && roll < 0.9)) {
      const ids = detailIds(session)
      if (ids.length) {
        await request(
          session,
          'GET',
          `/api/reports/details?ids=${encodeURIComponent(ids.join(','))}`,
          'report-details',
        )
      } else {
        await request(session, 'GET', workspacePath(), 'workspace')
      }
    } else if ((!spike && roll < 0.92) || (spike && roll < 0.95)) {
      await request(session, 'GET', '/api/notifications?limit=20', 'notifications')
    } else {
      await request(session, 'GET', '/api/auth/me', 'auth-me')
    }
  } catch {
    // Failure is recorded once; keep the virtual user alive.
  }
}

async function virtualUser(index, sessions, endAt) {
  const delay = Math.floor((index / Math.max(1, config.users)) * config.rampSeconds * 1000)
  await sleep(delay)
  while (Date.now() < endAt) {
    await oneJourneyRequest(sessions[index])
    await sleep(random(config.thinkMinMs, config.thinkMaxMs))
  }
}

async function loadCredentials() {
  const raw = await readFile(config.credentialsFile, 'utf8')
  const values = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [identifier, ...password] = line.split(',')
      return { identifier, password: password.join(',') }
    })
  if (values.length < config.users) {
    throw new Error(`Need ${config.users} credentials; file contains ${values.length}.`)
  }
  return values.slice(0, config.users)
}

async function prepareSession(session, index) {
  const maximumAttempts = 3
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      await session.login()
      await session.prime()
      return
    } catch (error) {
      if (attempt === maximumAttempts) throw error
      session.jar = new CookieJar()
      session.reportIds = []
      console.log(
        `Retrying session ${index + 1} after setup attempt ${attempt} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      await sleep(500 * attempt)
    }
  }
}

async function coordinateStart() {
  if (config.readyFile) {
    await mkdir(path.dirname(path.resolve(config.readyFile)), { recursive: true })
    await writeFile(config.readyFile, `${new Date().toISOString()}\n`)
  }
  if (config.goFile) {
    while (!existsSync(config.goFile)) await sleep(100)
  }
}

function summarize() {
  const endpoints = Object.fromEntries(
    [...metrics.byEndpoint].map(([name, item]) => [
      name,
      {
        count: item.count,
        ok: item.ok,
        failed: item.failed,
        errorRate: Number((item.failed / Math.max(1, item.count)).toFixed(4)),
        bytes: item.bytes,
        p50Ms: Number(percentile(item.durations, 50).toFixed(1)),
        p95Ms: Number(percentile(item.durations, 95).toFixed(1)),
        p99Ms: Number(percentile(item.durations, 99).toFixed(1)),
        maxMs: Number(Math.max(0, ...item.durations).toFixed(1)),
        statuses: item.statuses,
      },
    ]),
  )
  const totalRequests = Object.values(endpoints).reduce((sum, row) => sum + row.count, 0)
  const totalOk = Object.values(endpoints).reduce((sum, row) => sum + row.ok, 0)
  const totalFailures = Object.values(endpoints).reduce((sum, row) => sum + row.failed, 0)
  return {
    baseUrl: config.baseUrl,
    users: config.users,
    distinctSessions: config.users,
    durationSeconds: config.durationSeconds,
    rampSeconds: config.rampSeconds,
    thinkMinMs: config.thinkMinMs,
    thinkMaxMs: config.thinkMaxMs,
    profile: config.profile,
    totalRequests,
    totalOk,
    totalFailures,
    errorRate: Number((totalFailures / Math.max(1, totalRequests)).toFixed(4)),
    attemptedRps: Number((totalRequests / config.durationSeconds).toFixed(2)),
    successfulRps: Number((totalOk / config.durationSeconds).toFixed(2)),
    endpoints,
    timeline: Object.fromEntries(metrics.timeline),
    failures: metrics.failures,
  }
}

async function main() {
  const credentials = await loadCredentials()
  const sessions = credentials.map((credential, index) => new Session(credential, index))
  console.log(`Preparing ${sessions.length} distinct authenticated sessions...`)
  for (let start = 0; start < sessions.length; start += config.preparationConcurrency) {
    const batch = sessions.slice(start, start + config.preparationConcurrency)
    await Promise.all(
      batch.map((session, offset) => prepareSession(session, start + offset)),
    )
    console.log(`Prepared ${Math.min(start + batch.length, sessions.length)}/${sessions.length}`)
  }
  await sleep(2000)

  await coordinateStart()
  metrics.loadStartedAt = Date.now()
  const endAt = Date.now() + config.durationSeconds * 1000
  console.log(
    `Load started: ${config.users} VUs, ${config.durationSeconds}s, ${config.profile} profile`,
  )
  await Promise.all(
    Array.from({ length: config.users }, (_, index) => virtualUser(index, sessions, endAt)),
  )

  const summary = {
    startedAt: new Date(metrics.loadStartedAt).toISOString(),
    finishedAt: new Date().toISOString(),
    ...summarize(),
  }
  const output = path.resolve(config.output)
  await mkdir(path.dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(summary, null, 2)}\n`)
  console.log(JSON.stringify(summary, null, 2))
  if (summary.errorRate > 0.01) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
