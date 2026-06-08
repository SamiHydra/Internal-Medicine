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
}

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
        if (error instanceof ApiError && error.status === 401) {
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

    const response = await fetch(this.url(path, options.query), {
      ...options,
      method,
      headers,
      body,
      credentials: 'include',
    })

    if (response.status === 204) {
      return null as T
    }

    const payload = await this.parseResponse(response)

    if (!response.ok) {
      // A mid-session 401 on a non-auth endpoint means the Sanctum session
      // expired. Proactively sign out so the app redirects to /login instead of
      // stranding the user on an authenticated shell where every action 401s.
      // Auth endpoints (/api/auth/me, /login) handle their own 401s.
      if (response.status === 401 && !path.startsWith('/api/auth/')) {
        this.markSignedOut()
      }

      throw new ApiError(this.errorMessage(payload, response), response.status, payload)
    }

    return payload as T
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
