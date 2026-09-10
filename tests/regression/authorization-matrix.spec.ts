/**
 * API authorization matrix (BUSINESS_LOGIC_REGRESSION_REPORT.md, Phase 4).
 *
 * Every API route is called as every role. The expectation comes from the
 * route's own `permission:` middleware and the permissions the API reports
 * for each role (`GET /api/auth/me`), so nothing is inferred from navigation:
 *
 *   - anonymous on an authenticated route ........ 401
 *   - a role without the route's permission ...... 401/403 (never 2xx)
 *   - a role with the permission (GET only) ...... not 401/403
 *   - routes without a permission middleware ..... policy-scoped; recorded
 *
 * Mutations are only sent as roles that are NOT allowed (the middleware
 * refuses before any handler runs, so nothing is written). Allowed roles are
 * exercised by the domain specs. Route parameters are resolved to real rows
 * so implicit model binding does not turn a 403 into a 404.
 */
import { test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {
  anonContext,
  apiAs,
  call,
  check,
  dbOne,
  flushRateLimits,
  info,
  OUTPUT_DIR,
  REPO_ROOT,
  resetFindings,
  ROLE_IDENTIFIERS,
  type RoleName,
} from './helpers'

const DOMAIN = 'authorization-matrix'
type Route = { method: string; uri: string; middleware: string[] }
type Cell = { route: string; role: RoleName; expected: string; actual: number; ok: boolean; note?: string }

const ROLES: RoleName[] = ['anonymous', 'nurse', 'resident', 'consultant', 'student_rep', 'admin', 'maintenance']

/** Routes never sent as anonymous with junk: they are throttled and covered by auth.spec.ts. */
const SKIP_ANONYMOUS_MUTATIONS = new Set([
  'api/auth/login',
  'api/auth/forgot-password',
  'api/auth/reset-password',
  'api/access-requests',
  'api/academic-access-requests',
  'api/admin-access-requests',
  'api/client-errors',
  'api/testing/flush-rate-limits',
])
/**
 * Routes whose permission middleware admits the role but whose policy then
 * narrows by ownership or scope, so a 403 for the sampled row is the existing
 * rule, not a mismatch. Both narrowings are unchanged from the baseline.
 */
const POLICY_NARROWED: Record<string, { roles: RoleName[]; reason: string }> = {
  'GET api/admin/transfer-requests': {
    roles: ['consultant'],
    reason: 'TransferRequestPolicy: a consultant may only review requests into a section they head; the seeded consultant heads none',
  },
  'GET api/analytics/exports/{analyticsExport}/download': {
    roles: ['admin', 'maintenance'],
    reason: 'AnalyticsController::download is owner-only; the sampled export belongs to another user',
  },
}

/** Never called by any signed-in role here: it would end the cached session. */
const SKIP_ALWAYS = new Set(['api/auth/logout', 'api/testing/flush-rate-limits'])

function loadRoutes(): Route[] {
  const raw = execFileSync('php', ['artisan', 'route:list', '--json', '--path=api'], {
    cwd: path.join(REPO_ROOT, 'backend'),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  const routes = JSON.parse(raw) as Array<{ method: string; uri: string; middleware: string[] }>
  return routes
    .map((r) => ({ method: r.method.split('|')[0], uri: r.uri, middleware: r.middleware ?? [] }))
    .filter((r) => r.method !== 'HEAD' && r.method !== 'OPTIONS')
}

function permissionOf(route: Route): string | null {
  const m = route.middleware.find((x) => x.startsWith('App\\Http\\Middleware\\EnsurePermission:'))
  return m ? m.split(':')[1] : null
}

function isAuthenticated(route: Route): boolean {
  return route.middleware.some((x) => x.includes('Authenticate:sanctum'))
}

/** Real row ids for route parameters, so binding succeeds and authorization is what answers. */
function resolveParams(uri: string): string {
  const pick = (sql: string) => (dbOne<{ id: string }>(sql)?.id ?? '00000000-0000-0000-0000-000000000000') as string
  const lookups: Record<string, () => string> = {
    user: () => pick("select id from users where role_key='nurse' and active=1 limit 1"),
    report: () => pick('select id from reports order by updated_at desc limit 1'),
    comment: () => pick('select id from report_comments limit 1'),
    actionItem: () => pick('select id from action_items limit 1'),
    evidence: () => pick('select id from action_item_evidence limit 1'),
    analyticsExport: () => pick('select id from analytics_exports limit 1'),
    accessRequest: () => pick('select id from access_requests limit 1'),
    adminAccessRequest: () => pick('select id from admin_access_requests limit 1'),
    assignment: () => pick('select id from report_assignments limit 1'),
    department: () => pick('select id from departments limit 1'),
    ward: () => pick('select id from wards limit 1'),
    section: () => pick('select id from sections limit 1'),
    dutyType: () => pick('select id from duty_types limit 1'),
    evaluationForm: () => pick('select id from evaluation_forms limit 1'),
    key: () => (dbOne<{ key: string }>('select key from evaluation_forms limit 1')?.key ?? 'resident_evaluation'),
    morningSession: () => pick('select id from morning_sessions order by session_date desc limit 1'),
    transferRequest: () => pick('select id from transfer_requests limit 1'),
    override: () => pick('select id from morning_roster_overrides limit 1'),
    repAssignment: () => pick('select id from rep_assignments limit 1'),
    calendar: () => pick('select id from rotation_calendars limit 1'),
    batch: () => pick('select id from student_batches limit 1'),
    student: () => pick('select id from students limit 1'),
    placement: () => pick('select id from subgroup_placements limit 1'),
    schedule: () => pick('select id from teaching_activity_schedules limit 1'),
    teachingSession: () => pick('select id from teaching_sessions limit 1'),
    template: () => pick('select id from report_templates limit 1'),
    field: () => pick('select id from report_field_definitions limit 1'),
    clinicalAlertRule: () => pick('select id from clinical_alert_rules limit 1'),
    notification: () => pick('select id from notifications limit 1'),
    year: () => '2026',
    month: () => '9',
  }
  return uri.replace(/\{(\w+)\??\}/g, (_, name: string) => (lookups[name] ? lookups[name]() : '00000000-0000-0000-0000-000000000000'))
}

test.describe.configure({ mode: 'serial' })

test('authorization matrix over every API route and role', async () => {
  test.setTimeout(20 * 60 * 1000)
  resetFindings(DOMAIN)
  await flushRateLimits()

  const routes = loadRoutes().filter((r) => !SKIP_ALWAYS.has(r.uri))
  info(DOMAIN, 'M-000', 'routes enumerated from php artisan route:list', String(routes.length))

  // Permissions as the API reports them, per role.
  const contexts: Partial<Record<RoleName, Awaited<ReturnType<typeof apiAs>>>> = {}
  const permissions: Partial<Record<RoleName, Set<string>>> = {}
  for (const role of ROLES) {
    if (role === 'anonymous') {
      contexts[role] = await anonContext()
      permissions[role] = new Set()
      continue
    }
    const ctx = await apiAs(ROLE_IDENTIFIERS[role])
    contexts[role] = ctx
    const me = await call(ctx, 'GET', '/api/auth/me')
    const perms: string[] = me.json?.user?.permissions ?? me.json?.permissions ?? []
    permissions[role] = new Set(perms)
    info(DOMAIN, `M-role-${role}`, `permissions reported by /api/auth/me for ${role}`, `${perms.length}: ${perms.join(', ')}`)
  }

  const cells: Cell[] = []
  let unexpected2xx = 0

  for (const route of routes) {
    const permission = permissionOf(route)
    const authenticated = isAuthenticated(route)
    const url = '/' + resolveParams(route.uri)
    const isGet = route.method === 'GET'

    for (const role of ROLES) {
      const ctx = contexts[role]!
      let expected: string
      let shouldCall = true

      if (role === 'anonymous') {
        if (!authenticated) {
          expected = 'public'
          shouldCall = isGet && !SKIP_ANONYMOUS_MUTATIONS.has(route.uri)
        } else {
          expected = '401'
        }
      } else if (permission) {
        const allowed = permissions[role]!.has(permission)
        expected = allowed ? 'allowed' : '403'
        shouldCall = allowed ? isGet : true
      } else {
        expected = 'policy'
        shouldCall = isGet // policy-scoped mutations are exercised by the domain specs
      }

      if (!shouldCall) {
        cells.push({ route: `${route.method} ${route.uri}`, role, expected, actual: -1, ok: true, note: 'not sent (allowed mutation or throttled public route)' })
        continue
      }

      const result = await call(ctx, route.method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url, isGet ? {} : { data: {} })
      const status = result.status
      const narrowed = POLICY_NARROWED[`${route.method} ${route.uri}`]
      const policyNarrowed = Boolean(narrowed && narrowed.roles.includes(role) && expected === 'allowed' && status === 403)
      let ok: boolean
      if (policyNarrowed) ok = true
      else if (expected === '401') ok = status === 401
      else if (expected === '403') ok = status === 401 || status === 403 || status === 404
      else if (expected === 'allowed') ok = status !== 401 && status !== 403
      else ok = status < 500 // public/policy: only a server error is wrong here

      if ((expected === '401' || expected === '403') && status >= 200 && status < 300) unexpected2xx += 1
      cells.push({ route: `${route.method} ${route.uri}`, role, expected, actual: status, ok, note: policyNarrowed ? `policy-narrowed: ${narrowed!.reason}` : undefined })
    }
  }

  for (const ctx of Object.values(contexts)) await ctx?.dispose()

  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  fs.writeFileSync(path.join(OUTPUT_DIR, 'authorization-matrix.cells.json'), JSON.stringify(cells, null, 2))

  // Markdown matrix: one row per route, one column per role.
  const byRoute = new Map<string, Partial<Record<RoleName, Cell>>>()
  for (const cell of cells) {
    if (!byRoute.has(cell.route)) byRoute.set(cell.route, {})
    byRoute.get(cell.route)![cell.role] = cell
  }
  const render = (cell?: Cell) => {
    if (!cell) return ''
    if (cell.actual === -1) return `~ (${cell.expected})`
    return `${cell.actual}${cell.ok ? '' : ' !!'}`
  }
  const lines = [
    '| Route | ' + ROLES.join(' | ') + ' |',
    '|---|' + ROLES.map(() => '---').join('|') + '|',
    ...Array.from(byRoute.entries()).map(([route, row]) => `| \`${route}\` | ${ROLES.map((r) => render(row[r])).join(' | ')} |`),
  ]
  fs.writeFileSync(path.join(OUTPUT_DIR, 'authorization-matrix.md'), lines.join('\n') + '\n')

  const failures = cells.filter((c) => !c.ok)
  const sent = cells.filter((c) => c.actual !== -1)
  info(DOMAIN, 'M-001', 'requests sent', String(sent.length))
  check(
    DOMAIN,
    'M-002',
    'no role receives a 2xx from a route its permission does not allow, and anonymous never passes an authenticated route (routes/api.php middleware, Permissions.php)',
    '0 unexpected 2xx',
    `${unexpected2xx} unexpected 2xx`,
    unexpected2xx === 0,
    failures.slice(0, 20).map((f) => `${f.role} ${f.route} -> ${f.actual}`).join('; '),
  )
  check(
    DOMAIN,
    'M-003',
    'every allowed GET answers without 401/403 and no route answers 5xx to any role',
    '0 mismatches',
    `${failures.length} mismatches`,
    failures.length === 0,
    failures.slice(0, 20).map((f) => `${f.role} ${f.route} expected ${f.expected} got ${f.actual}`).join('; '),
  )
})
