import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildClientErrorReport,
  fingerprintFor,
  installGlobalErrorReporting,
  reportClientError,
  resetClientErrorReportingForTests,
  scrubText,
} from '@/lib/observability/error-reporter'

const postSpy = vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve())

vi.mock('@/lib/api/client', () => ({
  getApiBrowserClient: () => ({ post: postSpy }),
  setApiFailureObserver: vi.fn(),
}))

describe('scrubText', () => {
  it('redacts credentials, long tokens, query strings and e-mail local parts', () => {
    const scrubbed = scrubText(
      'Failed https://im.hospital.internal/reset-password?token=abc123 for nurse.abel@stpaulos.local password=Secret9 Bearer AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    )

    expect(scrubbed).toContain('https://im.hospital.internal/reset-password?[query-redacted]')
    expect(scrubbed).toContain('n***@stpaulos.local')
    expect(scrubbed).toContain('password=[redacted]')
    expect(scrubbed).not.toContain('Secret9')
    expect(scrubbed).not.toContain('AAAAAAAAAAAAAAAAAAAA')
  })

  it('caps the length', () => {
    expect(scrubText('x'.repeat(600)).length).toBeLessThanOrEqual(501)
  })
})

describe('reportClientError', () => {
  beforeEach(() => {
    resetClientErrorReportingForTests()
    postSpy.mockClear()
  })

  afterEach(() => {
    resetClientErrorReportingForTests()
  })

  it('builds a sanitised report with route, release and fingerprint', () => {
    const report = buildClientErrorReport('render', new TypeError('Cannot read x of undefined'), {
      routeName: '/admin',
    })

    expect(report.kind).toBe('render')
    expect(report.message).toBe('TypeError: Cannot read x of undefined')
    expect(report.routeName).toBe('/admin')
    expect(report.fingerprint).toBe(fingerprintFor('render', report.message, '/admin'))
    expect(report.stack === null || typeof report.stack === 'string').toBe(true)
  })

  it('posts once per distinct failure and caps the number of reports per page', () => {
    expect(reportClientError('error', new Error('same'))).toBe(true)
    expect(reportClientError('error', new Error('same'))).toBe(false)
    expect(postSpy).toHaveBeenCalledTimes(1)
    expect(postSpy.mock.calls[0]?.[0]).toBe('/api/client-errors')

    for (let index = 0; index < 20; index += 1) {
      reportClientError('error', new Error(`different ${index}`))
    }
    expect(postSpy.mock.calls.length).toBeLessThanOrEqual(10)
  })

  it('never throws when the transport rejects', async () => {
    postSpy.mockImplementationOnce(() => Promise.reject(new Error('offline')))
    expect(() => reportClientError('api', 'API answered 503 for /api/workspace', { status: 503 })).not.toThrow()
    await Promise.resolve()
  })

  it('installs window hooks once', () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    installGlobalErrorReporting()
    installGlobalErrorReporting()
    const registered = addSpy.mock.calls.map((call) => call[0])
    expect(registered.filter((name) => name === 'error')).toHaveLength(1)
    expect(registered.filter((name) => name === 'unhandledrejection')).toHaveLength(1)
    addSpy.mockRestore()
  })
})
