import { useLayoutEffect } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Resets scroll to the top whenever the route changes, so navigating between
 * pages always starts at the top instead of inheriting the previous page's
 * scroll position. The window is the scroll container in this app (app-shell's
 * <main> is min-h-screen with a sticky header), so we scroll the window.
 *
 * Keyed on pathname only - in-page filter/query changes should not jump.
 */
export function ScrollToTop() {
  const { pathname } = useLocation()

  useLayoutEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return null
}
