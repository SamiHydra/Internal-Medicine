import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RouteErrorBoundary } from '@/components/layout/route-error-boundary'

const reportSpy = vi.fn()

vi.mock('@/lib/observability/error-reporter', () => ({
  reportClientError: (...args: unknown[]) => reportSpy(...args),
}))

function Explode({ when }: { when: boolean }) {
  if (when) {
    throw new Error('render exploded')
  }

  return <p>page content</p>
}

describe('RouteErrorBoundary', () => {
  afterEach(() => {
    reportSpy.mockClear()
    vi.restoreAllMocks()
  })

  it('renders children when nothing fails', () => {
    render(
      <RouteErrorBoundary resetKey="/admin">
        <Explode when={false} />
      </RouteErrorBoundary>,
    )

    expect(screen.getByText('page content')).toBeInTheDocument()
  })

  it('shows a recovery panel, reports once, and resets when the route changes', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const view = render(
      <RouteErrorBoundary resetKey="/admin">
        <Explode when />
      </RouteErrorBoundary>,
    )

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload this page' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go to my home page' })).toBeInTheDocument()
    expect(reportSpy).toHaveBeenCalledTimes(1)
    expect(reportSpy.mock.calls[0]?.[0]).toBe('render')

    view.rerender(
      <RouteErrorBoundary resetKey="/admin/settings">
        <Explode when={false} />
      </RouteErrorBoundary>,
    )

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('page content')).toBeInTheDocument()
  })
})
