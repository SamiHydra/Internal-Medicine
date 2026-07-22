import { apiEnv, isApiConfigured } from '@/lib/api/env'

type AuthEvent = 'INITIAL_SESSION' | 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'USER_UPDATED'

export type ApiSession = {
  user: {
    id: string
  }
}

type AuthListener = (event: AuthEvent, session: ApiSession | null) => void

type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: unknown
  query?: Record<string, string | number | boolean | null | undefined>
  timeoutMs?: number
}

const DEFAULT_GET_TIMEOUT_MS = 15_000
const TRANSIENT_GET_STATUSES = new Set([502, 503, 504])

export class ApiError extends Error {
  readonly status: number
  readonly details?: unknown

  constructor(
    message: string,
    status: number,
    details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}

function isInactiveAccountError(error: unknown): error is ApiError {
  return (
    error instanceof ApiError &&
    error.status === 403 &&
    error.message.toLowerCase().includes('account is inactive')
  )
}

function readCookie(name: string) {
  if (typeof document === 'undefined') {
    return null
  }

  return (
    document.cookie
      .split('; ')
      .find((row) => row.startsWith(`${name}=`))
      ?.split('=')
      .slice(1)
      .join('=') ?? null
  )
}

function isUnsafeMethod(method: string) {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())
}

export class LaravelApiClient {
  readonly baseUrl: string

  private csrfReady = false
  private authListeners = new Set<AuthListener>()

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  auth = {
    getSession: async (): Promise<{
      data: { session: ApiSession | null }
      error: Error | null
    }> => {
      try {
        const payload = await this.get<{ user: { id: string } }>('/api/auth/me')
        return {
          data: { session: { user: { id: payload.user.id } } },
          error: null,
        }
      } catch (error) {
        if (
          error instanceof ApiError &&
          (error.status === 401 || isInactiveAccountError(error))
        ) {
          if (isInactiveAccountError(error)) {
            this.markSignedOut()
          }

          return { data: { session: null }, error: null }
        }

        return {
          data: { session: null },
          error: error instanceof Error ? error : new Error('Unable to read the current session.'),
        }
      }
    },
    onAuthStateChange: (listener: AuthListener) => {
      this.authListeners.add(listener)

      return {
        data: {
          subscription: {
            unsubscribe: () => {
              this.authListeners.delete(listener)
            },
          },
        },
      }
    },
  }

  channel(name?: string) {
    void name

    const channel = {
      on: (...args: unknown[]) => {
        void args
        return channel
      },
      subscribe: () => Promise.resolve('ok'),
    }

    return channel
  }

  removeChannel(channel?: unknown) {
    void channel

    return Promise.resolve()
  }

  emitAuthStateChange(event: AuthEvent, session: ApiSession | null) {
    this.authListeners.forEach((listener) => listener(event, session))
  }

  /**
   * Mark the client as signed out: drop the cached CSRF readiness so the next
   * login re-primes the cookie (otherwise a stale XSRF token causes 419s after
   * logout/expiry), and notify listeners so the app can redirect to /login.
   */
  markSignedOut() {
    this.csrfReady = false
    this.emitAuthStateChange('SIGNED_OUT', null)
  }

  async get<T>(path: string, options?: RequestOptions) {
    return this.request<T>(path, { ...options, method: 'GET' })
  }

  async post<T>(path: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>(path, { ...options, method: 'POST', body })
  }

  async put<T>(path: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>(path, { ...options, method: 'PUT', body })
  }

  async patch<T>(path: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>(path, { ...options, method: 'PATCH', body })
  }

  async delete<T>(path: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>(path, { ...options, method: 'DELETE', body })
  }

  async primeCsrfCookie() {
    await this.ensureCsrfCookie()
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method ?? 'GET'

    if (isUnsafeMethod(method)) {
      await this.ensureCsrfCookie()
    }

    const headers = new Headers(options.headers)
    headers.set('Accept', 'application/json')
    headers.set('X-Requested-With', 'XMLHttpRequest')

    let body: BodyInit | null | undefined
    if (options.body instanceof FormData || typeof options.body === 'string') {
      body = options.body
    } else if (options.body !== undefined && options.body !== null) {
      headers.set('Content-Type', 'application/json')
      body = JSON.stringify(options.body)
    }

    if (isUnsafeMethod(method)) {
      const xsrfToken = readCookie('XSRF-TOKEN')
      if (xsrfToken) {
        headers.set('X-XSRF-TOKEN', decodeURIComponent(xsrfToken))
      }
    }

    const {
      query,
      timeoutMs = method.toUpperCase() === 'GET' ? DEFAULT_GET_TIMEOUT_MS : 0,
      ...requestInit
    } = options
    const isRetryableGet = method.toUpperCase() === 'GET'
    const maxAttempts = isRetryableGet ? 2 : 1

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const timeoutController = !requestInit.signal && timeoutMs > 0 ? new AbortController() : null
      const timeoutId = timeoutController
        ? window.setTimeout(() => timeoutController.abort(), timeoutMs)
        : null

      try {
        const response = await fetch(this.url(path, query), {
          ...requestInit,
          method,
          headers,
          body,
          credentials: 'include',
          signal: requestInit.signal ?? timeoutController?.signal,
        })

        if (TRANSIENT_GET_STATUSES.has(response.status) && attempt + 1 < maxAttempts) {
          await this.retryDelay(attempt)
          continue
        }

        if (response.status === 204) {
          return null as T
        }

        const payload = await this.parseResponse(response)

        if (!response.ok) {
          const apiError = new ApiError(
            this.errorMessage(payload, response),
            response.status,
            payload,
          )
          // A mid-session 401 (session expired) or 419 (CSRF/session token mismatch)
          // or the explicit inactive-account 403 on a non-auth endpoint means the
          // Sanctum session is no longer usable.
          // markSignedOut() drops the cached CSRF readiness (so the next unsafe
          // request re-primes /sanctum/csrf-cookie) and redirects to /login, instead
          // of stranding the user on an authenticated shell where every write 401/419s.
          // Auth endpoints (/api/auth/me, /login) handle their own statuses.
          if (
            (response.status === 401 ||
              response.status === 419 ||
              isInactiveAccountError(apiError)) &&
            !path.startsWith('/api/auth/')
          ) {
            this.markSignedOut()
          }

          throw apiError
        }

        return payload as T
      } catch (error) {
        if (error instanceof ApiError) {
          throw error
        }

        if (attempt + 1 < maxAttempts) {
          await this.retryDelay(attempt)
          continue
        }

        if (timeoutController?.signal.aborted) {
          throw new ApiError('The server took too long to respond. Please try again.', 408)
        }

        throw error
      } finally {
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId)
        }
      }
    }

    throw new ApiError('The API request failed.', 500)
  }

  private async retryDelay(attempt: number) {
    await new Promise((resolve) => window.setTimeout(resolve, 200 * (attempt + 1)))
  }

  private async ensureCsrfCookie() {
    if (this.csrfReady) {
      return
    }

    const response = await fetch(this.url('/sanctum/csrf-cookie'), {
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
    })

    if (!response.ok) {
      throw new ApiError('Unable to initialize the secure API session.', response.status)
    }

    this.csrfReady = true
  }

  private url(path: string, query?: RequestOptions['query']) {
    const url = new URL(path, this.baseUrl)

    Object.entries(query ?? {}).forEach(([key, value]) => {
      if (value === null || value === undefined) {
        return
      }

      // Laravel's `boolean` validation rule rejects the strings "true"/"false";
      // serialize booleans as 1/0, which it accepts.
      url.searchParams.set(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value))
    })

    return url.toString()
  }

  private async parseResponse(response: Response) {
    const text = await response.text()
    if (!text) {
      return null
    }

    try {
      return JSON.parse(text) as unknown
    } catch {
      return text
    }
  }

  private errorMessage(payload: unknown, response: Response) {
    if (typeof payload === 'object' && payload) {
      if ('message' in payload && typeof payload.message === 'string') {
        return payload.message
      }

      if ('errors' in payload && typeof payload.errors === 'object' && payload.errors) {
        const firstError = Object.values(payload.errors).flat()[0]
        if (typeof firstError === 'string') {
          return firstError
        }
      }
    }

    return response.statusText || 'The API request failed.'
  }
}

let browserClient: LaravelApiClient | null | undefined

export function getApiBrowserClient() {
  if (!isApiConfigured) {
    return null
  }

  browserClient ??= new LaravelApiClient(apiEnv.baseUrl!)

  return browserClient
}

export const api = getApiBrowserClient()

export { isApiConfigured } from '@/lib/api/env'
