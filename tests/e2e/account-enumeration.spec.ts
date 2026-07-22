import { test, expect, type APIRequestContext } from '@playwright/test'

import { apiContextFromState, anonContext, ajaxHeaders, xsrfToken } from './helpers/api'
import { ACCOUNTS, DEV_PASSWORD, QA_MARKER } from './helpers/accounts'

/**
 * Regression guard for C-SEC-004 (account-enumeration oracle).
 *
 * The three public registration endpoints once returned DISTINCT 422 messages
 * that separated "an account already exists" from "a request is already
 * pending" from "neither". An anonymous prober could classify any address in a
 * single request (~600 probes/hr/IP under throttle:10,1). PasswordReset@forgot
 * was already non-enumerating, so the same surface was protected inconsistently.
 *
 * The fix makes each endpoint answer the SAME 201 "awaiting approval" body for
 * all three account states. These tests submit each endpoint with (a) an
 * existing account's email, (b) an email that already has a pending request and
 * (c) an unknown email, and assert the status + body are INDISTINGUISHABLE. Any
 * divergence re-opens the oracle and fails the test - that is the goal, so do
 * NOT weaken these assertions to "both are 2xx".
 *
 * Anonymous / API-level, chromium-only.
 */

// A run-scoped nonce keeps the emails this spec writes unique and greppable.
const NONCE = Date.now().toString(36)

type Probe = { status: number; body: unknown }

let anon: APIRequestContext
let anonToken: string | null
// A valid, resolvable department+template pair for the clinical endpoint, which
// resolves the assignment BEFORE it inspects the email state. A malformed
// assignment would 422 identically for every email and mask a real oracle, so
// the payload must reach the email-state branch under test.
let assignment: { departmentId: string; templateId: string }

test.beforeAll(async () => {
  anon = await anonContext()
  anonToken = await xsrfToken(anon)

  // Reference data is read with an admin context purely to BUILD a valid
  // anonymous payload; every probe below is unauthenticated.
  const admin = await apiContextFromState('superadmin')
  const [deptRes, tplRes] = await Promise.all([
    admin.get('/api/admin/departments?active=1', { headers: ajaxHeaders() }),
    admin.get('/api/admin/templates', { headers: ajaxHeaders() }),
  ])
  expect(deptRes.status(), 'need departments to build a valid clinical payload').toBe(200)
  expect(tplRes.status(), 'need templates to build a valid clinical payload').toBe(200)

  const departments = ((await deptRes.json()).data ?? []) as Array<{ id: string; template_id: string | null }>
  const templates = ((await tplRes.json()).data ?? []) as Array<{ id: string; active?: boolean }>
  const activeTemplateIds = new Set(templates.filter((t) => t.active !== false).map((t) => t.id))
  const department = departments.find((d) => d.template_id && activeTemplateIds.has(d.template_id))
  expect(department, 'expected an active department linked to an active template').toBeTruthy()
  assignment = { departmentId: department!.id, templateId: department!.template_id! }

  await admin.dispose()
})

test.afterAll(async () => {
  await anon?.dispose()
})

async function probe(path: string, data: Record<string, unknown>): Promise<Probe> {
  const res = await anon.post(path, { headers: ajaxHeaders(anonToken), data })
  let body: unknown
  try {
    body = await res.json()
  } catch {
    body = await res.text()
  }
  return { status: res.status(), body }
}

function clinicalPayload(email: string): Record<string, unknown> {
  return {
    fullName: `${QA_MARKER} Enum Probe`,
    email,
    password: DEV_PASSWORD,
    requestedAssignments: [assignment],
    notes: QA_MARKER,
  }
}

function academicPayload(email: string): Record<string, unknown> {
  return {
    fullName: `${QA_MARKER} Enum Probe`,
    email,
    password: DEV_PASSWORD,
    role: 'resident',
    notes: QA_MARKER,
  }
}

function adminPayload(email: string): Record<string, unknown> {
  return {
    fullName: `${QA_MARKER} Enum Probe`,
    email,
    password: DEV_PASSWORD,
    notes: QA_MARKER,
  }
}

const endpoints = [
  { slug: 'clinical', label: 'clinical POST /api/access-requests', path: '/api/access-requests', payload: clinicalPayload },
  {
    slug: 'academic',
    label: 'academic POST /api/academic-access-requests',
    path: '/api/academic-access-requests',
    payload: academicPayload,
  },
  { slug: 'admin', label: 'admin POST /api/admin-access-requests', path: '/api/admin-access-requests', payload: adminPayload },
] as const

test.describe('Regression C-SEC-004: registration endpoints do not disclose account existence', () => {
  for (const endpoint of endpoints) {
    test(`${endpoint.label} answers identically for existing / pending / unknown emails`, async () => {
      // Emails are namespaced per endpoint: the academic + admin endpoints share
      // the admin_access_requests table and the clinical endpoint writes to
      // users, so isolated addresses keep each endpoint's three states clean.
      const existingEmail = ACCOUNTS.nurse.identifier // a real, active seeded account
      const pendingEmail = `qa.enum.${endpoint.slug}.pending.${NONCE}@stpaul.local`
      const unknownEmail = `qa.enum.${endpoint.slug}.unknown.${NONCE}@stpaul.local`

      // Put `pendingEmail` into the "a request is already pending" state.
      const seed = await probe(endpoint.path, endpoint.payload(pendingEmail))
      expect(seed.status, 'seeding a pending request must land on the success path').toBe(201)

      // Probe the three distinct account states.
      const existing = await probe(endpoint.path, endpoint.payload(existingEmail))
      const pending = await probe(endpoint.path, endpoint.payload(pendingEmail))
      const unknown = await probe(endpoint.path, endpoint.payload(unknownEmail))

      // Guard: "identical" must come from the real success path, not from all
      // three colliding on a 429 or an error. Assert the non-disclosing 201.
      for (const [state, result] of [
        ['existing', existing],
        ['pending', pending],
        ['unknown', unknown],
      ] as const) {
        expect(
          result.status,
          `${state} probe returned ${result.status} (throttled/error, not the non-disclosing success path)`,
        ).toBe(201)
      }

      // The oracle C-SEC-004 described was distinct responses per state. The
      // fix makes them indistinguishable; any divergence re-opens the oracle.
      expect(pending.status, 'existing vs pending status diverged (enumeration oracle)').toBe(existing.status)
      expect(unknown.status, 'existing vs unknown status diverged (enumeration oracle)').toBe(existing.status)
      expect(pending.body, 'existing vs pending body diverged (enumeration oracle)').toEqual(existing.body)
      expect(unknown.body, 'existing vs unknown body diverged (enumeration oracle)').toEqual(existing.body)
    })
  }

  test('control: POST /api/auth/forgot-password stays non-enumerating (constant 202)', async () => {
    const known = await probe('/api/auth/forgot-password', { email: ACCOUNTS.nurse.identifier })
    const unknown = await probe('/api/auth/forgot-password', { email: `qa.enum.forgot.${NONCE}@stpaul.local` })

    // Non-disclosing by design, and not merely because both were throttled.
    expect(known.status, 'known-email forgot-password should be a constant 202').toBe(202)
    expect(unknown.status, 'unknown-email forgot-password should be a constant 202').toBe(202)
    expect(unknown.body, 'forgot-password body must not depend on account existence').toEqual(known.body)
  })
})
