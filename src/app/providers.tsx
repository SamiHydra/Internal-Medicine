import type { PropsWithChildren } from 'react'
import { Toaster } from 'sonner'

import { AppDataProvider } from '@/context/app-data-context'

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <AppDataProvider>
      {children}
      <Toaster richColors position="top-right" />
    </AppDataProvider>
  )
}
