import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

const defaultCredentials = [
  { identifier: 'admin@stpaulos.local', password: 'StPaul2026!' },
  { identifier: 'abel.gemechu@stpaulhospital.demo', password: 'StPaul2026!' },
  { identifier: 'hana.abera@stpaulhospital.demo', password: 'StPaul2026!' },
]

const config = {
  baseUrl: envString('LOAD_BASE_URL', 'http://127.0.0.1:8000').replace(/\/+$/, ''),
  frontendOrigin: envString('LOAD_FRONTEND_ORIGIN', 'http://localhost:5173').replace(/\/+$/, ''),
  users: envInt('LOAD_USERS', 8),
  durationSeconds: envInt('LOAD_DURATION_SECONDS', 60),
  rampSeconds: envInt('LOAD_RAMP_SECONDS', 20),
  thinkMinMs: envInt('LOAD_THINK_MIN_MS', 250),
  thinkMaxMs: envInt('LOAD_THINK_MAX_MS', 1200),
  requestTimeoutMs: envInt('LOAD_REQUEST_TIMEOUT_MS', 15000),
  detailBatchSize: envInt('LOAD_DETAIL_BATCH_SIZE', 20),
  progressSeconds: envInt('LOAD_PROGRESS_SECONDS', 5),
  output:
    envString(
      'LOAD_OUTPUT',
      `artifacts/load-tests/${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    ),
}

class CookieJar {
  cookies = new Map()

  store(response) {
    for (const cookie of setCookieHeaders(response.headers)) {
      const [pair] = cookie.split(';')
      const separatorIndex = pair.indexOf('=')

      if (separatorIndex <= 0) {
        continue
      }

      const name = pair.slice(0, separatorIndex).trim()
      const value = pair.slice(separatorIndex + 1).trim()

      if (value === '') {
        this.cookies.delete(name)
      } else {
        this.cookies.set(name, value)
      }
    }
  }

  header() {
    return [...this.cookies.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join('; ')
  }

  xsrfToken() {
    const value = this.cookies.get('XSRF-TOKEN')

    return value ? decodeURIComponent(value) : null
  }
}

class Session {
  constructor(credential) {
    this.credential = credential
    this.jar = new CookieJar()
    this.reportIds = []
    this.role = 'unknown'
  }

  async login() {
    await request(this, 'GET', '/sanctum/csrf-cookie', 'csrf')

    const payload = await request(this, 'POST', '/api/auth/login', 'login', {
      body: {
        identifier: this.credential.identifier,
        password: this.credential.password,
      },
      expectJson: true,
    })

    this.role = payload?.user?.role ?? 'unknown'
  }

  async primeWorkspace() {
    const payload = await request(this, 'GET', workspacePath(), 'workspace-prime', {
      expectJson: true,
    })

    this.reportIds = Array.isArray(payload?.state?.reports)
      ? payload.state.reports
          .map((report) => report?.id)
          .filter((id) => typeof id === 'string' && id.length > 0)
      : []
  }
}

const metrics = {
  startedAt: new Date().toISOString(),
  config: {
    ...config,
    credentials: undefined,
  },
  byEndpoint: new Map(),
  failures: [],
}

function envString(key, fallback) {
  const value = process.env[key]?.trim()

  return value || fallback
}

function envInt(key, fallback) {
  const value = Number.parseInt(process.env[key] ?? '', 10)

  return Number.isFinite(value) && value > 0 ? value : fallback
}

function setCookieHeaders(headers) {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie()
  }

  const header = headers.get('set-cookie')
  if (!header) {
    return []
  }

  return header.split(/,(?=\s*[^;,]+=)/g).map((value) => value.trim())
}

function workspacePath() {
  const params = new URLSearchParams({
    includeProfiles: '0',
    includeAccessRequests: '0',
    includeHistory: '0',
  })

  return `/api/workspace?${params.toString()}`
}

async function loadCredentials() {
  const file = process.env.LOAD_CREDENTIALS_FILE?.trim()

  if (file) {
    const raw = await readFile(file, 'utf8')
    if (file.endsWith('.json')) {
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) {
        throw new Error('LOAD_CREDENTIALS_FILE JSON must be an array.')
      }

      return parsed.map(validateCredential)
    }

    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const [identifier, ...passwordParts] = line.split(',')

        return validateCredential({
          identifier: identifier?.trim(),
          password: passwordParts.join(',').trim(),
        })
      })
  }

  const inline = process.env.LOAD_CREDENTIALS?.trim()
  if (inline) {
    return inline.split(';').map((pair) => {
      const separatorIndex = pair.indexOf('=')
      if (separatorIndex < 0) {
        throw new Error('LOAD_CREDENTIALS entries must look like identifier=password.')
      }

      return validateCredential({
        identifier: pair.slice(0, separatorIndex).trim(),
        password: pair.slice(separatorIndex + 1).trim(),
      })
    })
  }

  return defaultCredentials
}

function validateCredential(value) {
  if (
    !value ||
    typeof value.identifier !== 'string' ||
    !value.identifier ||
    typeof value.password !== 'string' ||
    !value.password
  ) {
    throw new Error('Each load-test credential needs identifier and password.')
  }

  return {
    identifier: value.identifier,
    password: value.password,
  }
}

async function request(session, method, targetPath, endpoint, options = {}) {
  const url = `${config.baseUrl}${targetPath}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs)
  const headers = {
    Accept: 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    Origin: config.frontendOrigin,
    Referer: `${config.frontendOrigin}/`,
    ...(options.headers ?? {}),
  }
  const cookieHeader = session.jar.header()

  if (cookieHeader) {
    headers.Cookie = cookieHeader
  }

  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const token = session.jar.xsrfToken()
    if (token) {
      headers['X-XSRF-TOKEN'] = token
    }
  }

  let body
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.body)
  }

  const started = performance.now()

  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal,
      redirect: 'manual',
    })
    session.jar.store(response)

    const text = await response.text()
    const durationMs = performance.now() - started
    const ok = response.status >= 200 && response.status < 400

    record(endpoint, response.status, durationMs, text.length, ok)

    if (!ok) {
      const message = text.slice(0, 240).replace(/\s+/g, ' ')
      throw new Error(`${method} ${targetPath} returned ${response.status}: ${message}`)
    }

    if (options.expectJson) {
      return text ? JSON.parse(text) : null
    }

    return text
  } catch (error) {
    const durationMs = performance.now() - started
    const message = error instanceof Error ? error.message : String(error)

    record(endpoint, 0, durationMs, 0, false)
    if (metrics.failures.length < 20) {
      metrics.failures.push({ endpoint, message })
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function record(endpoint, status, durationMs, bytes, ok) {
  const current =
    metrics.byEndpoint.get(endpoint) ??
    {
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
}

function percentile(values, pct) {
  if (!values.length) {
    return 0
  }

  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.ceil((pct / 100) * sorted.length) - 1)

  return sorted[index]
}

function endpointSummary() {
  return Object.fromEntries(
    [...metrics.byEndpoint.entries()].map(([endpoint, data]) => [
      endpoint,
      {
        count: data.count,
        ok: data.ok,
        failed: data.failed,
        errorRate: Number((data.failed / Math.max(1, data.count)).toFixed(4)),
        bytes: data.bytes,
        rps: Number((data.count / config.durationSeconds).toFixed(2)),
        p50Ms: Number(percentile(data.durations, 50).toFixed(1)),
        p95Ms: Number(percentile(data.durations, 95).toFixed(1)),
        p99Ms: Number(percentile(data.durations, 99).toFixed(1)),
        maxMs: Number(Math.max(0, ...data.durations).toFixed(1)),
        statuses: data.statuses,
      },
    ]),
  )
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function sample(array) {
  return array[Math.floor(Math.random() * array.length)]
}

function sampleReportIds(session) {
  if (!session.reportIds.length) {
    return []
  }

  const ids = []
  const count = Math.min(config.detailBatchSize, session.reportIds.length)

  for (let index = 0; index < count; index += 1) {
    ids.push(sample(session.reportIds))
  }

  return [...new Set(ids)]
}

async function runVirtualUser(index, sessions, endAt) {
  const startDelay = Math.floor((index / Math.max(1, config.users)) * config.rampSeconds * 1000)
  await sleep(startDelay)

  while (Date.now() < endAt) {
    const session = sessions[index % sessions.length]
    const roll = Math.random()

    try {
      if (roll < 0.45) {
        await request(session, 'GET', '/api/workspace/revision', 'workspace-revision')
      } else if (roll < 0.6) {
        await request(session, 'GET', workspacePath(), 'workspace')
      } else if (roll < 0.82) {
        const ids = sampleReportIds(session)
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
      } else if (roll < 0.92) {
        await request(session, 'GET', '/api/notifications?limit=20', 'notifications')
      } else {
        await request(session, 'GET', '/api/auth/me', 'auth-me')
      }
    } catch {
      // Per-request failure is recorded; keep the virtual user alive.
    }

    await sleep(randomInt(config.thinkMinMs, config.thinkMaxMs))
  }
}

async function writeReport(summary) {
  const outputPath = path.resolve(config.output)
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')

  return outputPath
}

function printSummary(summary) {
  const rows = Object.entries(summary.endpoints).map(([endpoint, item]) => ({
    endpoint,
    count: item.count,
    ok: item.ok,
    failed: item.failed,
    errorRate: `${(item.errorRate * 100).toFixed(2)}%`,
    rps: item.rps,
    p50Ms: item.p50Ms,
    p95Ms: item.p95Ms,
    p99Ms: item.p99Ms,
    maxMs: item.maxMs,
  }))

  console.table(rows)
  console.log(`Total requests: ${summary.totalRequests}`)
  console.log(`Total failures: ${summary.totalFailures}`)
  console.log(`Overall RPS: ${summary.rps}`)
  console.log(`Report: ${summary.output}`)
}

async function main() {
  const targetHostname = new URL(config.baseUrl).hostname
  const isLoopback = ['127.0.0.1', 'localhost', '::1'].includes(targetHostname)
  if (
    !isLoopback &&
    config.users > 25 &&
    process.env.LOAD_ALLOW_HIGH_CONCURRENCY !== 'I_UNDERSTAND'
  ) {
    throw new Error(
      'Refusing more than 25 virtual users against a non-local target. ' +
        'Set LOAD_ALLOW_HIGH_CONCURRENCY=I_UNDERSTAND only after confirming a safe test environment.',
    )
  }

  const credentials = await loadCredentials()
  if (!credentials.length) {
    throw new Error('No credentials configured.')
  }

  console.log(`Base URL: ${config.baseUrl}`)
  console.log(`Virtual users: ${config.users}`)
  console.log(`Duration: ${config.durationSeconds}s; ramp: ${config.rampSeconds}s`)
  console.log(`Credential sessions: ${credentials.length}`)

  const sessions = credentials.map((credential) => new Session(credential))

  for (const session of sessions) {
    await session.login()
    await session.primeWorkspace()
    console.log(
      `Authenticated ${session.credential.identifier} (${session.role}), reports visible: ${session.reportIds.length}`,
    )
  }

  const endAt = Date.now() + config.durationSeconds * 1000
  const progressTimer = setInterval(() => {
    const total = [...metrics.byEndpoint.values()].reduce((sum, item) => sum + item.count, 0)
    const failed = [...metrics.byEndpoint.values()].reduce((sum, item) => sum + item.failed, 0)
    console.log(`progress: ${total} requests, ${failed} failures`)
  }, config.progressSeconds * 1000)

  await Promise.all(
    Array.from({ length: config.users }, (_, index) => runVirtualUser(index, sessions, endAt)),
  )
  clearInterval(progressTimer)

  const endpoints = endpointSummary()
  const totalRequests = Object.values(endpoints).reduce((sum, item) => sum + item.count, 0)
  const totalFailures = Object.values(endpoints).reduce((sum, item) => sum + item.failed, 0)
  const summary = {
    startedAt: metrics.startedAt,
    finishedAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    users: config.users,
    durationSeconds: config.durationSeconds,
    rampSeconds: config.rampSeconds,
    sessionCount: sessions.length,
    totalRequests,
    totalFailures,
    errorRate: Number((totalFailures / Math.max(1, totalRequests)).toFixed(4)),
    rps: Number((totalRequests / config.durationSeconds).toFixed(2)),
    endpoints,
    failures: metrics.failures,
  }
  summary.output = await writeReport(summary)

  printSummary(summary)

  if (summary.errorRate > 0.01) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
