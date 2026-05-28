import type { LaravelApiClient } from '@/lib/api/client'

export async function requestPasswordReset(
  client: LaravelApiClient,
  email: string,
) {
  await client.post('/api/auth/forgot-password', { email })
}

export async function resetPassword(
  client: LaravelApiClient,
  payload: {
    email: string
    token: string
    password: string
    passwordConfirmation: string
  },
) {
  await client.post('/api/auth/reset-password', {
    email: payload.email,
    token: payload.token,
    password: payload.password,
    password_confirmation: payload.passwordConfirmation,
  })
}
