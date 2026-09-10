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

  it('retries a transient GET failure once', async () => {
    fetchMock
      .mockReset()
      .mockResolvedValueOnce({
        status: 503,
        ok: false,
        text: async () => JSON.stringify({ message: 'Temporarily unavailable' }),
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        text: async () => JSON.stringify({ ok: true }),
      })

    const client = new LaravelApiClient('http://127.0.0.1:8000')

    await expect(client.get('/api/analytics/dashboard')).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry an unsafe request', async () => {
    fetchMock
      .mockReset()
      .mockResolvedValueOnce({ status: 204, ok: true })
      .mockRejectedValueOnce(new TypeError('Network unavailable'))

    const client = new LaravelApiClient('http://127.0.0.1:8000')

    await expect(client.post('/api/reports', { values: {} })).rejects.toThrow('Network unavailable')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/sanctum/csrf-cookie')
    expect(String(fetchMock.mock.calls[1][0])).toContain('/api/reports')
  })

  it('deduplicates concurrent CSRF setup requests', async () => {
    const client = new LaravelApiClient('http://127.0.0.1:8000')

    await Promise.all([client.primeCsrfCookie(), client.primeCsrfCookie()])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/sanctum/csrf-cookie')
  })

  it('honors caller cancellation without retrying the GET', async () => {
    fetchMock.mockReset().mockImplementation(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('The operation was aborted.', 'AbortError')),
            { once: true },
          )
        }),
    )

    const client = new LaravelApiClient('http://127.0.0.1:8000')
    const controller = new AbortController()
    const request = client.get('/api/workspace', { signal: controller.signal })
    controller.abort()

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('treats an inactive account during session restore as signed out', async () => {
    fetchMock.mockReset().mockResolvedValue({
      status: 403,
      statusText: 'Forbidden',
      ok: false,
      text: async () => JSON.stringify({ message: 'This account is inactive.' }),
    })

    const client = new LaravelApiClient('http://127.0.0.1:8000')
    const authListener = vi.fn()
    client.auth.onAuthStateChange(authListener)

    await expect(client.auth.getSession()).resolves.toEqual({
      data: { session: null },
      error: null,
    })
    expect(authListener).toHaveBeenCalledWith('SIGNED_OUT', null)
  })

  it('signs out an inactive account discovered during a workspace request', async () => {
    fetchMock.mockReset().mockResolvedValue({
      status: 403,
      statusText: 'Forbidden',
      ok: false,
      text: async () => JSON.stringify({ message: 'This account is inactive.' }),
    })

    const client = new LaravelApiClient('http://127.0.0.1:8000')
    const authListener = vi.fn()
    client.auth.onAuthStateChange(authListener)

    await expect(client.get('/api/workspace')).rejects.toThrow('This account is inactive.')
    expect(authListener).toHaveBeenCalledWith('SIGNED_OUT', null)
  })

  it('does not sign out for an ordinary permission-denied response', async () => {
    fetchMock.mockReset().mockResolvedValue({
      status: 403,
      statusText: 'Forbidden',
      ok: false,
      text: async () => JSON.stringify({ message: 'This action is unauthorized.' }),
    })

    const client = new LaravelApiClient('http://127.0.0.1:8000')
    const authListener = vi.fn()
    client.auth.onAuthStateChange(authListener)

    await expect(client.get('/api/admin/users')).rejects.toThrow('This action is unauthorized.')
    expect(authListener).not.toHaveBeenCalled()
  })
})
