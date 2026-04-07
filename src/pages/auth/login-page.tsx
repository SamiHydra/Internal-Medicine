import { zodResolver } from '@hookform/resolvers/zod'
import {
  ArrowRight,
  Eye,
  EyeOff,
  User,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { z } from 'zod'

import { technicalSupport } from '@/config/support'
import stPaulosLogo from '@/assets/StPaulosLogoColor.jpg'
import { useAppData } from '@/context/app-data-context'

const loginSchema = z.object({
  identifier: z.string().trim().min(1),
  password: z.string().min(1),
})

type LoginValues = z.infer<typeof loginSchema>

export function LoginPage() {
  const {
    currentUser,
    error: appError,
    isConfigured,
    isBootstrapping,
    login,
    missingEnvVars,
  } = useAppData()
  const location = useLocation()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [isSigningIn, setIsSigningIn] = useState(false)
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      identifier: '',
      password: '',
    },
  })

  useEffect(() => {
    if (currentUser && !isSigningIn) {
      navigate(currentUser.role === 'nurse' ? '/nurse' : '/admin', {
        replace: true,
      })
    }
  }, [currentUser, isSigningIn, navigate])

  useEffect(() => {
    const preloadDashboards = () => {
      void import('@/pages/nurse/nurse-dashboard-page')
      void import('@/pages/admin/admin-dashboard-page')
    }

    if ('requestIdleCallback' in window) {
      const idleHandle = window.requestIdleCallback(preloadDashboards, {
        timeout: 800,
      })

      return () => {
        window.cancelIdleCallback(idleHandle)
      }
    }

    const timeoutHandle = globalThis.setTimeout(preloadDashboards, 250)
    return () => {
      globalThis.clearTimeout(timeoutHandle)
    }
  }, [])

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null)
    setIsSigningIn(true)
    const role = await login(values.identifier, values.password)

    if (!role) {
      setError(appError ?? 'Check your email and password and try again.')
      setIsSigningIn(false)
      return
    }

    if (role === 'nurse') {
      await import('@/pages/nurse/nurse-dashboard-page')
    } else {
      await import('@/pages/admin/admin-dashboard-page')
    }
    navigate(role === 'nurse' ? '/nurse' : '/admin', { replace: true })
  })

  const identifierError = form.formState.errors.identifier
    ? 'Enter your email or username.'
    : null
  const passwordError = form.formState.errors.password
    ? 'Password is required.'
    : null
  const resetSuccess =
    typeof location.state === 'object' &&
    location.state !== null &&
    'passwordReset' in location.state &&
    location.state.passwordReset === true

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#f8f9fa] px-3 py-3 sm:px-4 sm:py-4 md:px-5 md:py-5 xl:px-6 xl:py-6">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute right-[-12%] top-[-12%] h-[34rem] w-[34rem] rounded-full bg-[#005db6]/[0.07] blur-3xl" />
        <div className="absolute bottom-[-18%] left-[-12%] h-[38rem] w-[38rem] rounded-full bg-[#000a1e]/[0.05] blur-3xl" />
        <div className="absolute right-[10%] top-[18%] h-[8px] w-24 bg-[#f0b429]" />
        <div
          className="absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              'radial-gradient(circle, rgba(0, 33, 71, 0.8) 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }}
        />
      </div>

      <main className="relative mx-auto flex min-h-[calc(100vh-1.5rem)] max-w-[1460px] items-center md:h-[calc(100vh-2.5rem)] md:min-h-0 xl:h-[calc(100vh-3rem)]">
        <div className="grid w-full overflow-hidden rounded-[0.35rem] bg-[linear-gradient(180deg,#ffffff_0%,#eef3f8_100%)] shadow-[0_28px_60px_rgba(0,33,71,0.12)] outline outline-1 outline-[#c8d5e6]/30 md:h-full md:grid-cols-[minmax(0,1fr)_minmax(480px,545px)] xl:grid-cols-[minmax(0,1.04fr)_minmax(520px,590px)]">
          <section className="relative hidden overflow-hidden bg-[linear-gradient(150deg,#000a1e_0%,#07162f_52%,#002147_100%)] text-white md:flex md:h-full md:flex-col md:justify-between md:p-12 lg:p-14 xl:p-16">
            <div
              className="absolute inset-0 opacity-70"
              style={{
                backgroundImage:
                  'linear-gradient(90deg, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0.035) 9%, transparent 9%, transparent 14%, rgba(255,255,255,0.02) 14%, rgba(255,255,255,0.02) 24%, transparent 24%, transparent 31%, rgba(255,255,255,0.04) 31%, rgba(255,255,255,0.04) 42%, transparent 42%, transparent 49%, rgba(255,255,255,0.025) 49%, rgba(255,255,255,0.025) 58%, transparent 58%, transparent 67%, rgba(255,255,255,0.035) 67%, rgba(255,255,255,0.035) 77%, transparent 77%, transparent 100%)',
              }}
            />
            <div
              className="absolute inset-0 opacity-60"
              style={{
                backgroundImage:
                  'linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.08) 18%, transparent 18%, transparent 36%, rgba(0,0,0,0.12) 36%, rgba(0,0,0,0.12) 54%, transparent 54%, transparent 100%)',
              }}
            />
            <div className="absolute inset-y-0 left-0 w-px bg-white/10" />
            <div className="absolute inset-y-0 right-0 w-px bg-white/8" />

            <div className="relative z-10">
              <div className="flex items-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-[6px] bg-white shadow-[0_16px_30px_rgba(0,0,0,0.16)]">
                  <img
                    src={stPaulosLogo}
                    alt="St Paulos logo"
                    className="h-full w-full object-cover"
                  />
                </div>
                <div>
                  <p
                    className="text-[1.55rem] font-extrabold leading-none tracking-[-0.03em] text-white"
                    style={{ fontFamily: 'Manrope, sans-serif' }}
                  >
                    St Paulos
                  </p>
                  <p className="mt-1 text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[#f0b429]">
                    Internal Medicine
                  </p>
                </div>
              </div>
            </div>

            <div className="relative z-10 max-w-[31rem]">
              <h1
                className="text-[3.95rem] font-extrabold leading-[0.92] tracking-[-0.055em] text-white lg:text-[4.3rem] xl:text-[4.7rem]"
                style={{ fontFamily: 'Manrope, sans-serif' }}
              >
                Weekly Reporting
                <br />
                <span className="text-[#63a1ff]">&amp; Review Dashboard</span>
              </h1>
              <div className="mt-6 h-px w-28 bg-[linear-gradient(90deg,#63a1ff_0%,#f0b429_100%)]" />
            </div>
          </section>

          <section className="relative flex items-center bg-[linear-gradient(180deg,#ffffff_0%,#f1f5fa_100%)] px-6 py-10 sm:px-10 md:h-full md:px-12 md:py-8 lg:px-16 xl:px-20">
            <div className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,#005db6_0%,#63a1ff_72%,#f0b429_100%)]" />
            <div className="mx-auto w-full max-w-[20rem] lg:max-w-[21rem]" style={{ fontFamily: 'Inter, sans-serif' }}>
              <div className="mb-10 flex items-center gap-3 md:hidden">
                <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-[6px] bg-white shadow-[0_12px_24px_rgba(0,33,71,0.14)] ring-1 ring-[#d7dbe0]">
                  <img
                    src={stPaulosLogo}
                    alt="St Paulos logo"
                    className="h-full w-full object-cover"
                  />
                </div>
                <div>
                  <p
                    className="text-base font-extrabold leading-none tracking-[-0.03em] text-[#000a1e]"
                    style={{ fontFamily: 'Manrope, sans-serif' }}
                  >
                    St Paulos
                  </p>
                  <p className="mt-1 text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-[#005db6]">
                    Internal Medicine
                  </p>
                </div>
              </div>

              <header className="mb-10">
                <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-[#005db6]">
                  Secure access
                </p>
                <h2
                  className="mb-2 text-[2rem] font-extrabold tracking-[-0.035em] text-[#000a1e]"
                  style={{ fontFamily: 'Manrope, sans-serif' }}
                >
                  Reporting Sign In
                </h2>
                <p className="text-sm font-medium text-[#5b6169]">
                  Access the internal medicine weekly reporting dashboard
                </p>
                <div className="mt-4 h-px w-24 bg-[linear-gradient(90deg,#005db6_0%,#63a1ff_68%,#f0b429_100%)]" />
              </header>

              <form className="space-y-6" onSubmit={onSubmit}>
                <div className="space-y-2">
                  <label
                    className="block text-[11px] font-bold uppercase tracking-[0.12em] text-[#000a1e]"
                      htmlFor="identifier"
                  >
                    Username or Email
                  </label>
                  <div className="relative">
                    <input
                      id="identifier"
                      type="text"
                      placeholder="resident.id@stpaulos.edu"
                      autoComplete="username"
                      aria-invalid={identifierError ? 'true' : 'false'}
                      className="h-12 w-full rounded-none border-0 border-b-2 border-transparent bg-[linear-gradient(180deg,#edf3fa_0%,#f7f9fb_100%)] px-4 pr-11 text-[0.95rem] font-medium text-[#191c1d] outline-none transition placeholder:text-[#8c929b] focus:border-[#005db6] focus:bg-[#fbfdff]"
                      disabled={!isConfigured || isBootstrapping || isSigningIn}
                      {...form.register('identifier')}
                    />
                    <User className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#c4c6cf]" />
                  </div>
                  {identifierError ? (
                    <p className="text-xs font-medium text-[#ba1a1a]">{identifierError}</p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <label
                      className="block text-[11px] font-bold uppercase tracking-[0.12em] text-[#000a1e]"
                      htmlFor="password"
                    >
                      Password
                    </label>
                    <button
                      type="button"
                      className="appearance-none border-0 bg-transparent p-0 font-black uppercase text-[#005db6] whitespace-nowrap transition-colors hover:text-[#00468c] focus-visible:outline-none focus-visible:text-[#00468c]"
                      style={{
                        fontSize: '10.5px',
                        lineHeight: '1',
                        letterSpacing: '0.1em',
                        fontWeight: 900,
                      }}
                      onClick={() => {
                        const identifier = form.getValues('identifier').trim()
                        navigate(
                          identifier && identifier.includes('@')
                            ? `/forgot-password?email=${encodeURIComponent(identifier)}`
                            : '/forgot-password',
                        )
                      }}
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="************"
                      autoComplete="current-password"
                      aria-invalid={passwordError ? 'true' : 'false'}
                      className="h-12 w-full rounded-none border-0 border-b-2 border-transparent bg-[linear-gradient(180deg,#edf3fa_0%,#f7f9fb_100%)] px-4 pr-11 text-[0.95rem] font-medium text-[#191c1d] outline-none transition placeholder:text-[#8c929b] focus:border-[#005db6] focus:bg-[#fbfdff]"
                      disabled={!isConfigured || isBootstrapping || isSigningIn}
                      {...form.register('password')}
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center text-[#c4c6cf] transition hover:text-[#000a1e]"
                      onClick={() => setShowPassword((current) => !current)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      disabled={!isConfigured || isBootstrapping || isSigningIn}
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  {passwordError ? (
                    <p className="text-xs font-medium text-[#ba1a1a]">{passwordError}</p>
                  ) : null}
                </div>

                {error ? (
                  <p className="text-sm font-medium text-[#ba1a1a]">{error}</p>
                ) : null}
                {resetSuccess ? (
                  <p className="text-sm font-medium text-[#1f6b3b]">
                    Password updated. Sign in with your new password.
                  </p>
                ) : null}
                {!isConfigured ? (
                  <p className="text-sm font-medium text-[#8a5a00]">
                    Missing environment: {missingEnvVars.join(', ')}
                  </p>
                ) : null}

                <button
                  className="auth-primary-button flex h-12 w-full items-center justify-center gap-2 rounded-[3px] px-4 text-[0.82rem] font-bold uppercase tracking-[0.16em]"
                  type="submit"
                  disabled={!isConfigured || isBootstrapping || isSigningIn}
                  style={{ fontFamily: 'Manrope, sans-serif' }}
                >
                  {isBootstrapping || isSigningIn ? 'Signing in...' : 'Sign In to Reporting Portal'}
                </button>

                <div className="border-t border-[#edeeef] pt-7">
                  <div className="flex flex-col items-center gap-4 text-center">
                    <p className="text-xs text-[#5b6169]">Need access to weekly reporting?</p>
                    <Link
                      className="auth-accent-button inline-flex min-w-[13rem] items-center justify-center gap-2 rounded-[4px] px-6 py-2.5 text-[0.72rem] font-bold uppercase tracking-[0.06em]"
                      to="/register"
                      style={{ fontFamily: 'Manrope, sans-serif' }}
                    >
                      Request access
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </div>

                <div className="border-t border-[#edeeef] pt-5 text-center">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#005db6]">
                    Technical support
                  </p>
                  <p className="mt-2 text-sm text-[#44474e]">
                    Developed and supported by {technicalSupport.name}
                  </p>
                  <p className="mt-1 text-sm font-medium text-[#000a1e]">
                    {technicalSupport.phone}
                  </p>
                </div>
              </form>
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
