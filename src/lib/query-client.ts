import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30_000,
    },
    mutations: {
      retry: false,
    },
  },
})

/**
 * Query data is authenticated workspace state. Clear it whenever the current
 * session is removed so a later account on the same browser cannot inherit
 * analytics or directory results from the previous user.
 */
export function clearAuthenticatedQueryCache() {
  queryClient.clear()
}
