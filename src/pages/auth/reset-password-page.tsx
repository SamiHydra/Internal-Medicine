import { ArrowLeft, Eye, EyeOff } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import stPaulosLogo from '@/assets/StPaulosLogoColor.jpg'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { isSupabaseConfigured, supabaseEnvSetupHint } from '@/lib/supabase/env'

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isCheckingSession, setIsCheckingSession] = useState(true)
  const [canResetPassword, setCanResetPassword] = useState(false)
  const [recoveryLinkDetected, setRecoveryLinkDetected] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  useEffect(() => {
    const client = getSupabaseBrowserClient()

    if (!client || !isSupabaseConfigured) {
      setIsCheckingSession(false)
      setCanResetPassword(false)
      return
    }

    let active = true
    const url = new URL(window.location.href)
    const hashParams = new URLSearchParams(
      window.location.hash.startsWith('#')
        ? window.location.hash.slice(1)
        : window.location.hash,
    )
    const authCode = url.searchParams.get('code')
    const hasRecoveryTokens =
      hashParams.get('type') === 'recovery' ||
      hashParams.has('access_token') ||
      hashParams.has('refresh_token')
    const hasRecoveryParams = Boolean(authCode || hasRecoveryTokens)
    const timeoutIds: number[] = []

    setRecoveryLinkDetected(hasRecoveryParams)

    const syncRecoverySession = async () => {
      const { data, error: sessionError } = await client.auth.getSession()

      if (!active) {
        return
      }

      if (sessionError) {
        setError(sessionError.message)
      }

      const hasSession = Boolean(data.session)
      setCanResetPassword(hasSession)

      if (hasSession || !hasRecoveryParams) {
        setIsCheckingSession(false)
      }
    }

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, session) => {
      if (!active) {
        return
      }

      if (
        event === 'PASSWORD_RECOVERY' ||
        event === 'SIGNED_IN' ||
        event === 'INITIAL_SESSION'
      ) {
        setCanResetPassword(Boolean(session))
        setIsCheckingSession(false)
      }
    })

    void (async () => {
      if (authCode) {
        const { error: exchangeError } = await client.auth.exchangeCodeForSession(authCode)

        if (!active) {
          return
        }

        if (exchangeError) {
          setError(exchangeError.message)
        }
      }

      await syncRecoverySession()

      if (hasRecoveryParams) {
        timeoutIds.push(
          window.setTimeout(() => {
            void syncRecoverySession()
          }, 250),
        )
        timeoutIds.push(
          window.setTimeout(() => {
            void syncRecoverySession()
          }, 900),
        )
      }
    })()

    return () => {
      active = false
      subscription.unsubscribe()
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId))
    }
  }, [])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('Use at least 8 characters for the new password.')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    if (!canResetPassword) {
      setError('Open the latest reset link from your email in this browser, then try again.')
      return
    }

    const client = getSupabaseBrowserClient()
    if (!client || !isSupabaseConfigured) {
      setError(`Supabase is not configured. ${supabaseEnvSetupHint}`)
      return
    }

    setIsSubmitting(true)

    try {
      const { error: updateError } = await client.auth.updateUser({ password })

      if (updateError) {
        setError(updateError.message)
        return
      }

      await client.auth.signOut()
      navigate('/login', {
        replace: true,
        state: { passwordReset: true },
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const helperMessage = isCheckingSession
    ? 'Checking your reset link...'
    : canResetPassword
      ? 'Enter your new password below.'
      : recoveryLinkDetected
        ? 'The recovery link has not finished connecting yet. If this stays blocked, open the latest reset link again in this same browser.'
        : 'Open the password reset link from your email to continue.'

  return (
    <div className="min-h-screen bg-[#f8f9fa] px-4 py-8">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-xl items-center justify-center">
        <section className="w-full overflow-hidden rounded-[0.35rem] border border-[#d9e0e7] bg-[linear-gradient(180deg,#ffffff_0%,#f1f5fa_100%)] shadow-[0_24px_48px_rgba(0,33,71,0.08)]">
          <div className="h-1 bg-[linear-gradient(90deg,#005db6_0%,#63a1ff_72%,#f0b429_100%)]" />

          <div className="space-y-8 p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-[6px] bg-white ring-1 ring-[#d7dbe0]">
                <img
                  src={stPaulosLogo}
                  alt="St Paulos logo"
                  className="h-full w-full object-cover"
                />
              </div>

              <div>
                <p className="text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-[#005db6]">
                  St Paulos Hospital
                </p>
                <p className="font-display text-[1.1rem] text-[#000a1e]">
                  Internal Medicine
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#005db6]">
                Password reset
              </p>
              <h1 className="font-display text-[2rem] leading-[0.98] tracking-[-0.04em] text-[#000a1e] sm:text-[2.35rem]">
                Set a new password
              </h1>
              <p className="text-sm leading-7 text-[#5b6169]">{helperMessage}</p>
            </div>

            <form className="space-y-5" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <label
                  className="block text-[11px] font-bold uppercase tracking-[0.12em] text-[#000a1e]"
                  htmlFor="new-password"
                >
                  New password
                </label>
                <div className="relative">
                  <input
                    id="new-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="h-12 w-full rounded-none border-0 border-b-2 border-transparent bg-[linear-gradient(180deg,#edf3fa_0%,#f7f9fb_100%)] px-4 pr-11 text-[0.95rem] font-medium text-[#191c1d] outline-none transition focus:border-[#005db6] focus:bg-[#fbfdff]"
                    disabled={isSubmitting}
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center text-[#c4c6cf] transition hover:text-[#000a1e]"
                    onClick={() => setShowPassword((current) => !current)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    disabled={isSubmitting}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label
                  className="block text-[11px] font-bold uppercase tracking-[0.12em] text-[#000a1e]"
                  htmlFor="confirm-password"
                >
                  Confirm password
                </label>
                <div className="relative">
                  <input
                    id="confirm-password"
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    className="h-12 w-full rounded-none border-0 border-b-2 border-transparent bg-[linear-gradient(180deg,#edf3fa_0%,#f7f9fb_100%)] px-4 pr-11 text-[0.95rem] font-medium text-[#191c1d] outline-none transition focus:border-[#005db6] focus:bg-[#fbfdff]"
                    disabled={isSubmitting}
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center text-[#c4c6cf] transition hover:text-[#000a1e]"
                    onClick={() => setShowConfirmPassword((current) => !current)}
                    aria-label={showConfirmPassword ? 'Hide password confirmation' : 'Show password confirmation'}
                    disabled={isSubmitting}
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              {error ? (
                <p className="text-sm font-medium text-[#ba1a1a]">{error}</p>
              ) : null}

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <button
                  className="auth-primary-button flex h-12 items-center justify-center rounded-[3px] px-5 text-[0.82rem] font-bold uppercase tracking-[0.16em]"
                  type="submit"
                  disabled={isCheckingSession || isSubmitting}
                  style={{ fontFamily: 'Manrope, sans-serif' }}
                >
                  {isSubmitting ? 'Saving...' : 'Update password'}
                </button>

                <Link
                  className="inline-flex items-center gap-2 text-sm font-semibold text-[#005db6]"
                  to="/login"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to sign in
                </Link>
              </div>
            </form>
          </div>
        </section>
      </div>
    </div>
  )
}
