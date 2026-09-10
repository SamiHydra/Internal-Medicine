import { BrowserRouter } from 'react-router-dom'

import type { SessionPayload } from '@/lib/api/types'
import { LoginPage } from '@/pages/auth/login-page'

export function PublicLoginApp({
  onAuthenticated,
}: {
  onAuthenticated: (user: SessionPayload['user']) => void | Promise<void>
}) {
  return (
    <BrowserRouter>
      <LoginPage onAuthenticated={onAuthenticated} />
    </BrowserRouter>
  )
}
