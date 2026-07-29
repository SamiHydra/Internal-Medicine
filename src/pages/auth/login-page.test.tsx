import { render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  emitAuthStateChange: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  primeCsrfCookie: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/api/client', () => ({
  ApiError: class ApiError extends Error {
    status: number

    constructor(message: string, status: number) {
      super(message)
      this.status = status
    }
  },
  getApiBrowserClient: () => api,
  isApiConfigured: true,
}))

vi.mock('@/lib/api/env', () => ({
  missingApiEnvKeys: [],
}))

import { LoginPage } from './login-page'

describe('LoginPage public entry', () => {
  it('restores an existing session without requiring AppDataProvider', async () => {
    const user = {
      id: 'admin-1',
      fullName: 'Audit Admin',
      role: 'admin' as const,
      passwordChangeRequired: false,
    }
    api.get.mockResolvedValue({ user })
    const onAuthenticated = vi.fn()

    render(
      <MemoryRouter initialEntries={['/login']}>
        <LoginPage onAuthenticated={onAuthenticated} />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(onAuthenticated).toHaveBeenCalledWith(user)
    })
  })

  it('keeps decorative dividers out of the hero flex layout', () => {
    api.get.mockReturnValue(new Promise(() => undefined))

    const { container } = render(
      <MemoryRouter initialEntries={['/login']}>
        <LoginPage />
      </MemoryRouter>,
    )
    const hero = container.querySelector('.login-hero')
    const children = Array.from(hero?.children ?? [])

    expect(children).toHaveLength(4)
    expect(children[0]).toHaveClass('absolute')
    expect(children[1]).toHaveClass('absolute')
    expect(children[0]).not.toHaveClass('login-hero-content')
    expect(children[1]).not.toHaveClass('login-hero-content')
    expect(children[2]).toHaveClass('login-hero-content')
    expect(children[3]).toHaveClass('login-hero-content')
  })
})
