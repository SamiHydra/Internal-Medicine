import { AlertTriangle } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { reportClientError } from '@/lib/observability/error-reporter'

type RouteErrorBoundaryProps = {
  /** Change it (the pathname) to give a new route a fresh boundary. */
  resetKey: string
  children: ReactNode
}

type RouteErrorBoundaryState = {
  error: Error | null
  resetKey: string
}

/**
 * Catches a route's render failure (docs/OBSERVABILITY.md, "route rendering
 * failures") so one broken page never blanks the whole shell. Reports the
 * failure once, then offers the two recoveries that always work: reload this
 * page, or go back to the home route. Moving to another route resets it.
 */
export class RouteErrorBoundary extends Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
  state: RouteErrorBoundaryState = { error: null, resetKey: this.props.resetKey }

  static getDerivedStateFromError(error: Error): Partial<RouteErrorBoundaryState> {
    return { error }
  }

  static getDerivedStateFromProps(
    props: RouteErrorBoundaryProps,
    state: RouteErrorBoundaryState,
  ): Partial<RouteErrorBoundaryState> | null {
    if (props.resetKey !== state.resetKey) {
      return { error: null, resetKey: props.resetKey }
    }

    return null
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportClientError('render', error, { routeName: undefined })
    void info
  }

  render() {
    if (!this.state.error) {
      return this.props.children
    }

    return (
      <section
        role="alert"
        data-testid="route-error-boundary"
        className="mx-auto my-10 w-full max-w-xl rounded-[0.4rem] bg-white p-7 outline outline-1 outline-[#d4dde8] shadow-[0_24px_60px_-42px_rgba(0,33,71,0.28)]"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#005db6]">Something went wrong</p>
        <h1 className="mt-2 flex items-center gap-2 font-display text-[1.5rem] font-bold leading-tight tracking-[-0.02em] text-[#000a1e]">
          <AlertTriangle className="h-5 w-5 text-[#c88719]" aria-hidden="true" />
          This page could not be shown
        </h1>
        <p className="mt-3 text-sm leading-6 text-[#5b6169]">
          The rest of the application is still working and nothing you saved has been lost.
          The problem has been recorded for the maintenance team. Reload this page, or return
          to your home page and try again.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button onClick={() => window.location.reload()}>Reload this page</Button>
          <Button variant="secondary" onClick={() => window.location.assign('/')}>
            Go to my home page
          </Button>
        </div>
      </section>
    )
  }
}
