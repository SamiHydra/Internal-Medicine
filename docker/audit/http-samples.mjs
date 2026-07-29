import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

const baseUrl = process.env.AUDIT_BASE_URL || 'https://localhost:18443'
const output = process.env.AUDIT_HTTP_OUTPUT || 'docker/audit/evidence/http-baselines.json'

class Jar {
  cookies = new Map()
  store(headers) {
    const values =
      typeof headers.getSetCookie === 'function'
        ? headers.getSetCookie()
        : [headers.get('set-cookie')].filter(Boolean)
    for (const header of values) {
      for (const cookie of header.split(/,(?=\s*[^;,]+=)/g)) {
        const [pair] = cookie.split(';')
        const index = pair.indexOf('=')
        if (index > 0) this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim())
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

const jar = new Jar()
const sourceIp = '10.251.0.1'

async function call(target, options = {}) {
  const headers = {
    Accept: 'application/json',
    Origin: baseUrl,
    Referer: `${baseUrl}/`,
    'X-Requested-With': 'XMLHttpRequest',
    'X-Forwarded-For': sourceIp,
    ...(options.headers || {}),
  }
  if (jar.header()) headers.Cookie = jar.header()
  if (options.method && options.method !== 'GET') {
    const token = jar.xsrf()
    if (token) headers['X-XSRF-TOKEN'] = token
  }
  if (options.body) headers['Content-Type'] = 'application/json'

  const start = performance.now()
  const response = await fetch(`${baseUrl}${target}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const headersAt = performance.now()
  jar.store(response.headers)
  const text = await response.text()
  const end = performance.now()
  if (!response.ok) {
    throw new Error(`${target} returned ${response.status}: ${text.slice(0, 300)}`)
  }
  return {
    status: response.status,
    ttfbMs: headersAt - start,
    totalMs: end - start,
    bytes: Buffer.byteLength(text),
    text,
  }
}

function percentile(values, pct) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * pct) - 1)]
}

function summary(samples) {
  return {
    count: samples.length,
    bytes: samples[0]?.bytes ?? 0,
    ttfbP50Ms: Number(percentile(samples.map((row) => row.ttfbMs), 0.5).toFixed(2)),
    ttfbP95Ms: Number(percentile(samples.map((row) => row.ttfbMs), 0.95).toFixed(2)),
    totalP50Ms: Number(percentile(samples.map((row) => row.totalMs), 0.5).toFixed(2)),
    totalP95Ms: Number(percentile(samples.map((row) => row.totalMs), 0.95).toFixed(2)),
    samples: samples.map(({ text, ...row }) => ({
      ...row,
      ttfbMs: Number(row.ttfbMs.toFixed(3)),
      totalMs: Number(row.totalMs.toFixed(3)),
    })),
  }
}

await call('/sanctum/csrf-cookie')
await call('/api/auth/login', {
  method: 'POST',
  body: {
    identifier: 'audit.load.0001@stpaulos.local',
    password: 'AuditLoad2026!',
  },
})

const endpoints = {
  academic_summary: '/api/academic/analytics/summary',
  academic_trend: '/api/academic/analytics/trend',
  academic_people: '/api/academic/analytics/people',
  clinical_all: '/api/analytics/dashboard',
  clinical_8w: '/api/analytics/dashboard?date_from=2026-06-08&date_to=2026-08-02',
  students: '/api/academic/analytics/students',
  workspace_default:
    '/api/workspace?includeProfiles=0&includeAccessRequests=0&includeHistory=0',
  workspace_all:
    '/api/workspace?includeProfiles=0&includeAccessRequests=0&includeHistory=1&reportPeriodWindow=all',
}

const result = {
  capturedAt: new Date().toISOString(),
  baseUrl,
  phpPath: 'Nginx TLS -> PHP-FPM 8.3 -> Laravel -> MariaDB 11.4',
  endpoints: {},
  queryMetrics: {},
}

for (const [name, target] of Object.entries(endpoints)) {
  await call('/audit-measure.php?case=flush')
  const cold = await call(target)
  const warm = []
  for (let index = 0; index < 20; index++) warm.push(await call(target))
  result.endpoints[name] = {
    cold: {
      ttfbMs: Number(cold.ttfbMs.toFixed(3)),
      totalMs: Number(cold.totalMs.toFixed(3)),
      bytes: cold.bytes,
    },
    warm: summary(warm),
  }

  const metric = await call(`/audit-measure.php?case=${name}&cold=1`)
  result.queryMetrics[name] = JSON.parse(metric.text)
}

await call('/audit-measure.php?case=flush')
const concurrentStart = performance.now()
const concurrentHttp = await Promise.all(
  ['academic_summary', 'academic_trend', 'academic_people'].map((name) =>
    call(endpoints[name]).then((value) => ({ name, ...value, text: undefined })),
  ),
)
result.concurrentAcademicHttp = {
  wallMs: Number((performance.now() - concurrentStart).toFixed(3)),
  sumRequestMs: Number(
    concurrentHttp.reduce((sum, row) => sum + row.totalMs, 0).toFixed(3),
  ),
  requests: concurrentHttp,
}

await call('/audit-measure.php?case=flush')
const concurrentMetricStart = performance.now()
const concurrentMetrics = await Promise.all(
  ['academic_summary', 'academic_trend', 'academic_people'].map(async (name) => {
    const value = await call(`/audit-measure.php?case=${name}`)
    return JSON.parse(value.text)
  }),
)
result.concurrentAcademicInstrumented = {
  wallMs: Number((performance.now() - concurrentMetricStart).toFixed(3)),
  sumWorkerSeconds: Number(
    (concurrentMetrics.reduce((sum, row) => sum + row.elapsedMs, 0) / 1000).toFixed(3),
  ),
  aggregateAllocationMb: Number(
    concurrentMetrics
      .reduce((sum, row) => sum + Math.max(0, row.allocationDeltaMb), 0)
      .toFixed(3),
  ),
  aggregatePeakDeltaMb: Number(
    concurrentMetrics.reduce((sum, row) => sum + Math.max(0, row.peakDeltaMb), 0).toFixed(3),
  ),
  requests: concurrentMetrics,
}

const outputPath = path.resolve(output)
await mkdir(path.dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify(result, null, 2))
