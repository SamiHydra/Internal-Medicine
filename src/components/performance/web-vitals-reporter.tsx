import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

import { useAppData } from '@/context/app-data-context'
import {
  markRouteTransitionStarted,
  setRumEnabled,
  settleRouteTransition,
  startWebVitalsReporting,
} from '@/lib/performance/rum'

function internalNavigationPath(event: MouseEvent): string | null {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return null
  }

  const anchor =
    event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
  if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) {
    return null
  }

  const target = new URL(anchor.href, window.location.href)
  return target.origin === window.location.origin && target.pathname !== window.location.pathname
    ? target.pathname
    : null
}

export function WebVitalsReporter() {
  const location = useLocation()
  const { currentUser } = useAppData()

  useEffect(() => {
    setRumEnabled(Boolean(currentUser))
    if (currentUser) {
      void startWebVitalsReporting()
    }
  }, [currentUser])

  useEffect(() => {
    settleRouteTransition(location.pathname)
  }, [location.pathname])

  useEffect(() => {
    if (!currentUser) {
      return
    }

    const captureNavigation = (event: MouseEvent) => {
      const targetPath = internalNavigationPath(event)
      if (targetPath) {
        markRouteTransitionStarted(targetPath)
      }
    }

    document.addEventListener('click', captureNavigation, true)
    return () => document.removeEventListener('click', captureNavigation, true)
  }, [currentUser])

  return null
}
