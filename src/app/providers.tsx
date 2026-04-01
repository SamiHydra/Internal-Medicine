import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'
import { Toaster } from 'sonner'

import { AppDataProvider } from '@/context/app-data-context'

const queryClient = new QueryClient()

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={queryClient}>
      <AppDataProvider>
        {children}
        <Toaster richColors position="top-right" />
      </AppDataProvider>
    </QueryClientProvider>
  )
}
