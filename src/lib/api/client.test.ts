import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LaravelApiClient } from '@/lib/api/client'

describe('LaravelApiClient query serialization', () => {
  const originalFetch = globalThis.fetch
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      text: async () => JSON.stringify({ ok: true }),
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('serializes boolean query params as 1/0 so Laravel\'s boolean rule accepts them', async () => {
    const client = new LaravelApiClient('http://127.0.0.1:8000')

    await client.get('/api/workspace', {
      query: {
        includeProfiles: false,
        includeAccessRequests: true,
        includeHistory: false,
      },
    })

    const requestedUrl = String(fetchMock.mock.calls[0][0])

    // Regression: previously String(false) produced "false", which Laravel rejects.
    expect(requestedUrl).toContain('includeProfiles=0')
    expect(requestedUrl).toContain('includeAccessRequests=1')
    expect(requestedUrl).toContain('includeHistory=0')
    expect(requestedUrl).not.toContain('true')
    expect(requestedUrl).not.toContain('false')
  })

  it('leaves string and number query params unchanged and drops null/undefined', async () => {
    const client = new LaravelApiClient('http://127.0.0.1:8000')

    await client.get('/api/reports', {
      query: {
        period: 'p1',
        limit: 25,
        skip: null,
        cursor: undefined,
      },
    })

    const requestedUrl = String(fetchMock.mock.calls[0][0])
    expect(requestedUrl).toContain('period=p1')
    expect(requestedUrl).toContain('limit=25')
    expect(requestedUrl).not.toContain('skip')
    expect(requestedUrl).not.toContain('cursor')
  })
})
