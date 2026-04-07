import { ArrowLeft } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import stPaulosLogo from '@/assets/StPaulosLogoColor.jpg'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { isSupabaseConfigured, supabaseEnvSetupHint } from '@/lib/supabase/env'

export function ForgotPasswordPage() {
  const [searchParams] = useSearchParams()
  const [email, setEmail] = useState(searchParams.get('email') ?? '')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setSuccess(null)

    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail) {
      setError('Enter your email address first.')
      return
    }

    const client = getSupabaseBrowserClient()
    if (!client || !isSupabaseConfigured) {
      setError(`Supabase is not configured. ${supabaseEnvSetupHint}`)
      return
    }

    setIsSubmitting(true)

    try {
      const { error: resetError } = await client.auth.resetPasswordForEmail(
        normalizedEmail,
        {
          redirectTo: `${window.location.origin}/reset-password`,
        },
      )

      if (resetError) {
        setError(resetError.message)
        return
      }

      setSuccess(`Password reset instructions were sent to ${normalizedEmail}.`)
    } finally {
      setIsSubmitting(false)
    }
  }

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
                Forgot your password?
              </h1>
              <p className="text-sm leading-7 text-[#5b6169]">
                Enter your email and we will send you a reset link.
              </p>
            </div>

            <form className="space-y-5" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <label
                  className="block text-[11px] font-bold uppercase tracking-[0.12em] text-[#000a1e]"
                  htmlFor="reset-email"
                >
                  Email
                </label>
                <input
                  id="reset-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="resident.id@stpaulos.edu"
                  className="h-12 w-full rounded-none border-0 border-b-2 border-transparent bg-[linear-gradient(180deg,#edf3fa_0%,#f7f9fb_100%)] px-4 text-[0.95rem] font-medium text-[#191c1d] outline-none transition placeholder:text-[#8c929b] focus:border-[#005db6] focus:bg-[#fbfdff]"
                  disabled={isSubmitting}
                />
              </div>

              {error ? (
                <p className="text-sm font-medium text-[#ba1a1a]">{error}</p>
              ) : null}
              {success ? (
                <p className="text-sm font-medium text-[#1f6b3b]">{success}</p>
              ) : null}

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <button
                  className="auth-primary-button flex h-12 items-center justify-center rounded-[3px] px-5 text-[0.82rem] font-bold uppercase tracking-[0.16em]"
                  type="submit"
                  disabled={isSubmitting}
                  style={{ fontFamily: 'Manrope, sans-serif' }}
                >
                  {isSubmitting ? 'Sending...' : 'Send reset link'}
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
