import type { PropsWithChildren } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'

import { AppDataProvider } from '@/context/app-data-context'
import { queryClient } from '@/lib/query-client'

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
