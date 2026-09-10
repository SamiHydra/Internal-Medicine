import { ArrowLeft, Mail, MailCheck } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import stPaulosLogo from '@/assets/StPaulosLogoColor.jpg'
import { technicalSupport } from '@/config/support'
import { getApiBrowserClient, isApiConfigured } from '@/lib/api/client'
import { apiEnvSetupHint } from '@/lib/api/env'
import { requestPasswordReset } from '@/lib/api/passwords'

/** What happens after the form is submitted, so the wait is not a mystery. */
const STEPS = [
  { title: 'Enter your email', body: 'The address your account was created with.' },
  { title: 'Check your inbox', body: 'A reset link arrives within a few minutes.' },
  { title: 'Choose a new password', body: 'The link signs you straight back in.' },
]

export function ForgotPasswordPage() {
  const [searchParams] = useSearchParams()
  const [email, setEmail] = useState(searchParams.get('email') ?? '')
  const [error, setError] = useState<string | null>(null)
  /** The address the link was sent to; non-null means the request succeeded. */
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)

    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail) {
      setError('Enter your email address first.')
      return
    }

    const client = getApiBrowserClient()
    if (!client || !isApiConfigured) {
      setError(`Laravel API is not configured. ${apiEnvSetupHint}`)
      return
    }

    setIsSubmitting(true)

    try {
      await requestPasswordReset(client, normalizedEmail)
      setSentTo(normalizedEmail)
    } catch (resetError) {
      setError(
        resetError instanceof Error
          ? resetError.message
          : 'Unable to send password reset instructions.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#f8f9fa] px-3 py-3 sm:px-4 sm:py-4 md:px-5 md:py-5 xl:px-6 xl:py-6">
      <main className="relative mx-auto flex min-h-[calc(100vh-1.5rem)] max-w-[1460px] items-center md:h-[calc(100vh-2.5rem)] md:min-h-0 xl:h-[calc(100vh-3rem)]">
        <div className="grid w-full overflow-hidden rounded-[0.35rem] bg-white shadow-[0_28px_60px_rgba(0,33,71,0.12)] outline outline-1 outline-[#c8d5e6]/30 md:h-full md:grid-cols-[minmax(0,1fr)_minmax(480px,545px)] xl:grid-cols-[minmax(0,1.04fr)_minmax(520px,590px)]">
          {/* LEFT - navy hero, matching the sign-in and enrollment screens */}
          <section className="relative hidden overflow-hidden bg-[#04162f] text-white md:flex md:h-full md:flex-col md:justify-between md:p-12 lg:p-14 xl:p-16">
            <div className="absolute inset-y-0 left-0 w-px bg-white/10" />
            <div className="absolute inset-y-0 right-0 w-px bg-white/8" />

            <div className="relative z-10 flex items-center gap-4">
              <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-[8px] bg-white shadow-[0_16px_30px_rgba(0,0,0,0.16)]">
                <img
                  src={stPaulosLogo}
                  alt="St Paul's logo"
                  className="h-full w-full object-cover"
                />
              </div>
              <div>
                <p
                  className="text-[2.15rem] font-extrabold leading-none tracking-[-0.03em] text-white"
                  style={{ fontFamily: 'Manrope, sans-serif' }}
                >
                  St Paul's
                </p>
                <p className="mt-1.5 text-[0.82rem] font-semibold uppercase tracking-[0.24em] text-[#f0b429]">
                  Internal Medicine
                </p>
              </div>
            </div>

            <div className="relative z-10 max-w-[31rem]">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#f0b429]">
                Account recovery
              </p>
              <p
                className="mt-4 text-[2.35rem] font-extrabold leading-[0.98] tracking-[-0.045em] text-white lg:text-[2.6rem] xl:text-[2.85rem]"
                style={{ fontFamily: 'Manrope, sans-serif' }}
              >
                Password Reset
              </p>

              <ol className="mt-9 space-y-5">
                {STEPS.map((step, index) => (
                  <li key={step.title} className="flex gap-4">
                    <span
                      aria-hidden
                      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[0.3rem] bg-white/10 text-[12px] font-bold tabular-nums text-[#63a1ff]"
                    >
                      {index + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[14px] font-semibold text-white">
                        {step.title}
                      </span>
                      <span className="mt-0.5 block text-[13px] leading-5 text-[#9fb0c6]">
                        {step.body}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          {/* RIGHT - the form, or its confirmation once the link is away */}
          <section className="relative flex items-center bg-white px-6 py-10 sm:px-10 md:h-full md:px-12 md:py-8 lg:px-16 xl:px-20">
            <div className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,#005db6_0%,#63a1ff_72%,#f0b429_100%)]" />

            <div
              className="mx-auto w-full max-w-[20rem] lg:max-w-[21rem]"
              style={{ fontFamily: 'Inter, sans-serif' }}
            >
              {/* Compact identity for phones, where the navy panel is hidden. */}
              <div className="mb-10 flex items-center gap-3 md:hidden">
                <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-[6px] bg-white shadow-[0_12px_24px_rgba(0,33,71,0.14)] ring-1 ring-[#d7dbe0]">
                  <img
                    src={stPaulosLogo}
                    alt="St Paul's logo"
                    className="h-full w-full object-cover"
                  />
                </div>
                <div>
                  <p
                    className="text-base font-extrabold leading-none tracking-[-0.03em] text-[#000a1e]"
                    style={{ fontFamily: 'Manrope, sans-serif' }}
                  >
                    St Paul's
                  </p>
                  <p className="mt-1 text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-[#005db6]">
                    Internal Medicine
                  </p>
                </div>
              </div>

              {sentTo === null ? (
                <>
                  <header className="mb-10">
                    <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-[#005db6]">
                      Password reset
                    </p>
                    <h1
                      className="mb-2 text-[2rem] font-extrabold tracking-[-0.035em] text-[#000a1e]"
                      style={{ fontFamily: 'Manrope, sans-serif' }}
                    >
                      Forgot your password?
                    </h1>
                    <div className="mt-4 h-px w-24 bg-[linear-gradient(90deg,#005db6_0%,#63a1ff_68%,#f0b429_100%)]" />
                  </header>

                  <form className="space-y-6" onSubmit={handleSubmit}>
                    <div className="space-y-2">
                      <label
                        className="block text-[11px] font-bold uppercase tracking-[0.12em] text-[#000a1e]"
                        htmlFor="reset-email"
                      >
                        Email
                      </label>
                      <div className="relative">
                        <input
                          id="reset-email"
                          type="email"
                          autoComplete="email"
                          value={email}
                          onChange={(event) => setEmail(event.target.value)}
                          placeholder="resident.id@stpaul.edu"
                          aria-invalid={error ? 'true' : 'false'}
                          aria-describedby={error ? 'reset-error' : undefined}
                          className="h-12 w-full rounded-none border-0 border-b-2 border-transparent bg-[linear-gradient(180deg,#edf3fa_0%,#f7f9fb_100%)] px-4 pr-11 text-[0.95rem] font-medium text-[#191c1d] outline-none transition placeholder:text-[#8c929b] focus:border-[#005db6] focus:bg-[#fbfdff]"
                          disabled={isSubmitting}
                        />
                        <Mail className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#c4c6cf]" />
                      </div>
                      {error ? (
                        <p
                          id="reset-error"
                          role="alert"
                          className="text-xs font-medium text-[#ba1a1a]"
                        >
                          {error}
                        </p>
                      ) : null}
                    </div>

                    <button
                      className="flex h-12 w-full items-center justify-center gap-2 whitespace-nowrap rounded-[3px] bg-[#002147] px-4 text-[0.68rem] font-bold uppercase leading-none tracking-[0.08em] text-white shadow-[0_14px_28px_rgba(0,33,71,0.28)] transition-[background-color,transform] duration-150 ease-out hover:bg-[#06305f] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#005db6] active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-[#778197] disabled:shadow-none sm:text-[0.8rem] sm:tracking-[0.12em]"
                      type="submit"
                      disabled={isSubmitting}
                      style={{ fontFamily: 'Manrope, sans-serif' }}
                    >
                      {isSubmitting ? 'Sending...' : 'Send reset link'}
                    </button>
                  </form>
                </>
              ) : (
                <div role="status">
                  <span className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded-[0.4rem] bg-[#e8f0fb] text-[#005db6]">
                    <MailCheck className="h-6 w-6" />
                  </span>
                  <h1
                    className="mb-2 text-[2rem] font-extrabold tracking-[-0.035em] text-[#000a1e]"
                    style={{ fontFamily: 'Manrope, sans-serif' }}
                  >
                    Check your email
                  </h1>
                  <p className="text-sm font-medium leading-6 text-[#5b6169]">
                    If an account exists for{' '}
                    <span className="font-semibold text-[#000a1e]">{sentTo}</span>,
                    a reset link is on its way.
                  </p>
                  <div className="mt-4 h-px w-24 bg-[linear-gradient(90deg,#005db6_0%,#63a1ff_68%,#f0b429_100%)]" />

                  <p className="mt-6 text-[13px] leading-6 text-[#666970]">
                    The link expires shortly, so use it soon. Nothing arrived after
                    a few minutes? Check your spam folder, then try again.
                  </p>

                  <button
                    type="button"
                    onClick={() => {
                      setSentTo(null)
                      setError(null)
                    }}
                    className="mt-6 flex h-12 w-full items-center justify-center rounded-[3px] border border-[#c8d5e6] bg-white px-4 text-[0.68rem] font-bold uppercase leading-none tracking-[0.08em] text-[#000a1e] transition-colors duration-150 hover:bg-[#f6f8fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#005db6] sm:text-[0.8rem] sm:tracking-[0.12em]"
                    style={{ fontFamily: 'Manrope, sans-serif' }}
                  >
                    Use a different email
                  </button>
                </div>
              )}

              <div className="mt-8 border-t border-[#edeeef] pt-7 text-center">
                <Link
                  className="group inline-flex items-center gap-2 text-sm font-semibold text-[#005db6] transition-colors hover:text-[#00468c]"
                  to="/login"
                >
                  <ArrowLeft className="h-4 w-4 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-safe:group-hover:-translate-x-0.5" />
                  Back to sign in
                </Link>
              </div>

              <div className="mt-7 border-t border-[#edeeef] pt-5 text-center">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#005db6]">
                  Technical support
                </p>
                <p className="mt-2 text-sm text-[#44474e]">
                  Developed and supported by {technicalSupport.name}
                </p>
                <a
                  className="mt-1 inline-block text-sm font-medium text-[#000a1e] transition-colors hover:text-[#005db6]"
                  href={`tel:${technicalSupport.phone.replace(/\s+/g, '')}`}
                >
                  {technicalSupport.phone}
                </a>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
