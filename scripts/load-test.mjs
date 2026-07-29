import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'

const defaultCredentials = [
  { identifier: 'admin@stpaulos.local', password: 'StPaul2026!' },
  { identifier: 'abel.gemechu@stpaulhospital.demo', password: 'StPaul2026!' },
  { identifier: 'hana.abera@stpaulhospital.demo', password: 'StPaul2026!' },
]

const mixes = {
  standard: [
    ['workspace-revision', 0.45],
    ['workspace', 0.15],
    ['report-details', 0.22],
    ['notifications', 0.1],
    ['auth-me', 0.08],
  ],
  spike: [
    ['workspace-revision', 0.15],
    ['workspace', 0.35],
    ['report-details', 0.4],
    ['notifications', 0.05],
    ['auth-me', 0.05],
  ],
}

export function loadConfig(environment = process.env) {
  const profile = envString(environment, 'LOAD_PROFILE', 'standard')
  if (!(profile in mixes)) {
    throw new Error(`LOAD_PROFILE must be one of: ${Object.keys(mixes).join(', ')}.`)
  }

  return {
    baseUrl: envString(environment, 'LOAD_BASE_URL', 'http://127.0.0.1:8000').replace(
      /\/+$/,
      '',
    ),
    frontendOrigin: envString(
      environment,
      'LOAD_FRONTEND_ORIGIN',
      'http://localhost:5173',
    ).replace(/\/+$/, ''),
    users: envInt(environment, 'LOAD_USERS', 200),
    durationSeconds: envInt(environment, 'LOAD_DURATION_SECONDS', 60),
    rampSeconds: envInt(environment, 'LOAD_RAMP_SECONDS', 20),
    thinkMinMs: envInt(environment, 'LOAD_THINK_MIN_MS', 250),
    thinkMaxMs: envInt(environment, 'LOAD_THINK_MAX_MS', 1200),
    requestTimeoutMs: envInt(environment, 'LOAD_REQUEST_TIMEOUT_MS', 15000),
    detailBatchSize: envInt(environment, 'LOAD_DETAIL_BATCH_SIZE', 20),
    preparationConcurrency: envInt(environment, 'LOAD_PREPARATION_CONCURRENCY', 10),
    progressSeconds: envInt(environment, 'LOAD_PROGRESS_SECONDS', 5),
    profile,
    output: envString(
      environment,
      'LOAD_OUTPUT',
      `artifacts/load-tests/${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    ),
    credentialsFile: environment.LOAD_CREDENTIALS_FILE?.trim(),
    inlineCredentials: environment.LOAD_CREDENTIALS?.trim(),
    allowHighConcurrency: environment.LOAD_ALLOW_HIGH_CONCURRENCY === 'I_UNDERSTAND',
    syntheticSourceIps: environment.LOAD_SYNTHETIC_SOURCE_IPS === '1',
  }
}

export class CookieJar {
  cookies = new Map()

  store(headers) {
    const values =
      typeof headers.getSetCookie === 'function'
        ? headers.getSetCookie()
        : [headers.get('set-cookie')].filter(Boolean)

    for (const header of values) {
      for (const cookie of header.split(/,(?=\s*[^;,]+=)/g)) {
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

export class Session {
  constructor(credential, index, config) {
    this.credential = credential
    this.index = index
    this.config = config
    this.jar = new CookieJar()
    this.reportIds = []
    this.role = 'unknown'
    this.sourceIp = `10.250.${Math.floor(index / 250)}.${(index % 250) + 1}`
  }

  async login(metrics) {
    await request(this, metrics, 'GET', '/sanctum/csrf-cookie', 'csrf', {}, false)

    const payload = await request(
      this,
      metrics,
      'POST',
      '/api/auth/login',
      'login',
      {
        body: {
          identifier: this.credential.identifier,
          password: this.credential.password,
        },
        expectJson: true,
      },
      false,
    )

    this.role = payload?.user?.role ?? 'unknown'
  }

  async primeWorkspace(metrics) {
    const [, reportPage] = await Promise.all([
      request(
        this,
        metrics,
        'GET',
        workspacePath(),
        'workspace-prime',
        { expectJson: true },
        false,
      ),
      request(
        this,
        metrics,
        'GET',
        '/api/reports?per_page=20',
        'reports-prime',
        { expectJson: true },
        false,
      ),
    ])

    this.reportIds = reportIdsFromPage(reportPage)
  }
}

export function reportIdsFromPage(payload) {
  return Array.isArray(payload?.data)
    ? payload.data
        .map((report) => report?.id)
        .filter((id) => typeof id === 'string' && id.length > 0)
    : []
}

export function buildSessions(credentials, config) {
  if (credentials.length < config.users) {
    throw new Error(
      `LOAD_USERS=${config.users} requires at least ${config.users} distinct credentials; ` +
        `only ${credentials.length} were provided. Sessions are never shared between VUs.`,
    )
  }

  return credentials
    .slice(0, config.users)
    .map((credential, index) => new Session(credential, index, config))
}

export function createMetrics() {
  return {
    byEndpoint: new Map(),
    failures: [],
    loadStartedAt: 0,
  }
}

function envString(environment, key, fallback) {
  return environment[key]?.trim() || fallback
}

function envInt(environment, key, fallback) {
  const value = Number.parseInt(environment[key] ?? '', 10)

  return Number.isFinite(value) && value > 0 ? value : fallback
}

function workspacePath() {
  const params = new URLSearchParams({
    includeProfiles: '0',
    includeAccessRequests: '0',
    includeHistory: '0',
  })

  return `/api/workspace?${params.toString()}`
}

async function loadCredentials(config) {
  if (config.credentialsFile) {
    const raw = await readFile(config.credentialsFile, 'utf8')
    if (config.credentialsFile.endsWith('.json')) {
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

  if (config.inlineCredentials) {
    return config.inlineCredentials.split(';').map((pair) => {
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

async function request(session, metrics, method, targetPath, endpoint, options = {}, record = true) {
  const url = `${session.config.baseUrl}${targetPath}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), session.config.requestTimeoutMs)
  const headers = {
    Accept: 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    Origin: session.config.frontendOrigin,
    Referer: `${session.config.frontendOrigin}/`,
    ...(options.headers ?? {}),
  }
  const cookieHeader = session.jar.header()

  if (cookieHeader) {
    headers.Cookie = cookieHeader
  }

  if (session.config.syntheticSourceIps) {
    headers['X-Forwarded-For'] = session.sourceIp
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
  let status = 0

  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal,
      redirect: 'manual',
    })
    status = response.status
    session.jar.store(response.headers)

    const text = await response.text()
    const durationMs = performance.now() - started
    const ok = response.status >= 200 && response.status < 400

    if (record) {
      recordResult(metrics, endpoint, response.status, durationMs, text.length, ok, false)
    }

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
    const timedOut = error instanceof Error && error.name === 'AbortError'

    if (record && status === 0) {
      recordResult(metrics, endpoint, 0, durationMs, 0, false, timedOut)
    }

    if (record && metrics.failures.length < 20) {
      metrics.failures.push({
        endpoint,
        status,
        timedOut,
        message: error instanceof Error ? error.message : String(error),
      })
    }

    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function recordResult(metrics, endpoint, status, durationMs, bytes, ok, timedOut) {
  const current =
    metrics.byEndpoint.get(endpoint) ??
    {
      count: 0,
      ok: 0,
      failed: 0,
      timeouts: 0,
      bytes: 0,
      durations: [],
      statuses: {},
    }

  current.count += 1
  current.ok += ok ? 1 : 0
  current.failed += ok ? 0 : 1
  current.timeouts += timedOut ? 1 : 0
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

export function summarize(metrics, config, startedAt, finishedAt) {
  const endpoints = Object.fromEntries(
    [...metrics.byEndpoint.entries()].map(([endpoint, data]) => [
      endpoint,
      {
        count: data.count,
        ok: data.ok,
        failed: data.failed,
        timeouts: data.timeouts,
        errorRate: Number((data.failed / Math.max(1, data.count)).toFixed(4)),
        bytes: data.bytes,
        attemptedRps: Number((data.count / config.durationSeconds).toFixed(2)),
        successfulRps: Number((data.ok / config.durationSeconds).toFixed(2)),
        p50Ms: Number(percentile(data.durations, 50).toFixed(1)),
        p95Ms: Number(percentile(data.durations, 95).toFixed(1)),
        p99Ms: Number(percentile(data.durations, 99).toFixed(1)),
        maxMs: Number(Math.max(0, ...data.durations).toFixed(1)),
        statuses: data.statuses,
      },
    ]),
  )
  const totalRequests = Object.values(endpoints).reduce((sum, item) => sum + item.count, 0)
  const totalOk = Object.values(endpoints).reduce((sum, item) => sum + item.ok, 0)
  const totalFailures = Object.values(endpoints).reduce((sum, item) => sum + item.failed, 0)
  const totalTimeouts = Object.values(endpoints).reduce((sum, item) => sum + item.timeouts, 0)

  return {
    startedAt,
    finishedAt,
    baseUrl: config.baseUrl,
    users: config.users,
    distinctSessions: config.users,
    durationSeconds: config.durationSeconds,
    rampSeconds: config.rampSeconds,
    thinkMinMs: config.thinkMinMs,
    thinkMaxMs: config.thinkMaxMs,
    profile: config.profile,
    mix: Object.fromEntries(mixes[config.profile]),
    totalRequests,
    totalOk,
    totalFailures,
    totalTimeouts,
    errorRate: Number((totalFailures / Math.max(1, totalRequests)).toFixed(4)),
    attemptedRps: Number((totalRequests / config.durationSeconds).toFixed(2)),
    successfulRps: Number((totalOk / config.durationSeconds).toFixed(2)),
    timeoutRps: Number((totalTimeouts / config.durationSeconds).toFixed(2)),
    endpoints,
    failures: metrics.failures,
  }
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
  const count = Math.min(session.config.detailBatchSize, session.reportIds.length)

  for (let index = 0; index < count; index += 1) {
    ids.push(sample(session.reportIds))
  }

  return [...new Set(ids)]
}

async function runMeasuredRequest(session, metrics) {
  const roll = Math.random()
  const mix = mixes[session.config.profile]
  let cumulative = 0
  const endpoint =
    mix.find(([, weight]) => {
      cumulative += weight

      return roll < cumulative
    })?.[0] ?? 'auth-me'

  try {
    if (endpoint === 'workspace-revision') {
      await request(session, metrics, 'GET', '/api/workspace/revision', endpoint)
    } else if (endpoint === 'workspace') {
      await request(session, metrics, 'GET', workspacePath(), endpoint)
    } else if (endpoint === 'report-details') {
      const ids = sampleReportIds(session)
      if (ids.length) {
        await request(
          session,
          metrics,
          'GET',
          `/api/reports/details?ids=${encodeURIComponent(ids.join(','))}`,
          endpoint,
        )
      } else {
        await request(session, metrics, 'GET', workspacePath(), 'workspace')
      }
    } else if (endpoint === 'notifications') {
      await request(session, metrics, 'GET', '/api/notifications?limit=20', endpoint)
    } else {
      await request(session, metrics, 'GET', '/api/auth/me', endpoint)
    }
  } catch {
    // The request helper records the failure once; keep this VU alive.
  }
}

async function runVirtualUser(session, index, metrics, endAt) {
  const startDelay = Math.floor(
    (index / Math.max(1, session.config.users)) * session.config.rampSeconds * 1000,
  )
  await sleep(startDelay)

  while (Date.now() < endAt) {
    await runMeasuredRequest(session, metrics)
    await sleep(randomInt(session.config.thinkMinMs, session.config.thinkMaxMs))
  }
}

async function prepareSession(session, metrics) {
  const maximumAttempts = 3

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      await session.login(metrics)
      await session.primeWorkspace(metrics)

      return
    } catch (error) {
      if (attempt === maximumAttempts) {
        throw error
      }

      session.jar = new CookieJar()
      session.reportIds = []
      await sleep(500 * attempt)
    }
  }
}

async function prepareSessions(sessions, metrics, concurrency) {
  for (let start = 0; start < sessions.length; start += concurrency) {
    const batch = sessions.slice(start, start + concurrency)
    await Promise.all(batch.map((session) => prepareSession(session, metrics)))
    console.log(`Prepared ${Math.min(start + batch.length, sessions.length)}/${sessions.length}`)
  }
}

async function writeReport(config, summary) {
  const outputPath = path.resolve(config.output)
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')

  return outputPath
}

function printSummary(summary, output) {
  const rows = Object.entries(summary.endpoints).map(([endpoint, item]) => ({
    endpoint,
    count: item.count,
    ok: item.ok,
    failed: item.failed,
    timeouts: item.timeouts,
    errorRate: `${(item.errorRate * 100).toFixed(2)}%`,
    successfulRps: item.successfulRps,
    p50Ms: item.p50Ms,
    p95Ms: item.p95Ms,
    p99Ms: item.p99Ms,
    maxMs: item.maxMs,
  }))

  console.table(rows)
  console.log(`Attempted requests: ${summary.totalRequests}`)
  console.log(`Successful requests: ${summary.totalOk}`)
  console.log(`Failures: ${summary.totalFailures}; timeouts: ${summary.totalTimeouts}`)
  console.log(`Attempted RPS: ${summary.attemptedRps}`)
  console.log(`Successful RPS: ${summary.successfulRps}`)
  console.log(`Report: ${output}`)
}

export async function main(environment = process.env) {
  const config = loadConfig(environment)
  const targetHostname = new URL(config.baseUrl).hostname
  const isLoopback = ['127.0.0.1', 'localhost', '::1'].includes(targetHostname)

  if (!isLoopback && config.users > 25 && !config.allowHighConcurrency) {
    throw new Error(
      'Refusing more than 25 virtual users against a non-local target. ' +
        'Set LOAD_ALLOW_HIGH_CONCURRENCY=I_UNDERSTAND only after confirming a safe test environment.',
    )
  }

  const credentials = await loadCredentials(config)
  const sessions = buildSessions(credentials, config)
  const metrics = createMetrics()

  console.log(`Base URL: ${config.baseUrl}`)
  console.log(`Virtual users/distinct sessions: ${config.users}`)
  console.log(`Duration: ${config.durationSeconds}s; ramp: ${config.rampSeconds}s`)
  console.log(`Profile: ${config.profile}`)
  console.log('Preparing login and workspace state (excluded from measured results)...')

  await prepareSessions(sessions, metrics, config.preparationConcurrency)
  await sleep(2000)

  const startedAtMs = Date.now()
  metrics.loadStartedAt = startedAtMs
  const endAt = startedAtMs + config.durationSeconds * 1000
  const progressTimer = setInterval(() => {
    const attempted = [...metrics.byEndpoint.values()].reduce(
      (sum, item) => sum + item.count,
      0,
    )
    const failed = [...metrics.byEndpoint.values()].reduce((sum, item) => sum + item.failed, 0)
    console.log(`progress: ${attempted} attempted, ${failed} failed`)
  }, config.progressSeconds * 1000)

  await Promise.all(
    sessions.map((session, index) => runVirtualUser(session, index, metrics, endAt)),
  )
  clearInterval(progressTimer)

  const summary = summarize(
    metrics,
    config,
    new Date(startedAtMs).toISOString(),
    new Date().toISOString(),
  )
  const output = await writeReport(config, summary)
  printSummary(summary, output)

  if (summary.errorRate > 0.01) {
    process.exitCode = 1
  }

  return summary
}

const isEntryPoint =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (isEntryPoint) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
