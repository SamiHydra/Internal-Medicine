import { zodResolver } from '@hookform/resolvers/zod'
import { motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router-dom'
import { z } from 'zod'

import stPaulosLogo from '@/assets/StPaulosLogoColor.jpg'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAppData } from '@/context/app-data-context'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

type LoginValues = z.infer<typeof loginSchema>

const heroPhrases = ['dashboard', 'submissions', 'reviews']

export function LoginPage() {
  const {
    currentUser,
    error: appError,
    isConfigured,
    isBootstrapping,
    login,
    missingEnvVars,
  } = useAppData()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [typedText, setTypedText] = useState('')
  const [activePhraseIndex, setActivePhraseIndex] = useState(0)
  const [isDeleting, setIsDeleting] = useState(false)
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  })

  useEffect(() => {
    if (currentUser) {
      navigate(currentUser.role === 'nurse' ? '/nurse' : '/admin', {
        replace: true,
      })
    }
  }, [currentUser, navigate])

  useEffect(() => {
    const phrase = heroPhrases[activePhraseIndex]
    const isComplete = typedText === phrase
    const isEmpty = typedText.length === 0
    const delay = isComplete ? 880 : isDeleting ? 40 : 62

    const timer = window.setTimeout(() => {
      if (!isDeleting) {
        if (isComplete) {
          setIsDeleting(true)
          return
        }

        setTypedText(phrase.slice(0, typedText.length + 1))
        return
      }

      if (!isEmpty) {
        setTypedText(phrase.slice(0, typedText.length - 1))
        return
      }

      setIsDeleting(false)
      setActivePhraseIndex((currentIndex) => (currentIndex + 1) % heroPhrases.length)
    }, delay)

    return () => window.clearTimeout(timer)
  }, [activePhraseIndex, isDeleting, typedText])

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null)
    const role = await login(values.email, values.password)

    if (!role) {
      setError(appError ?? 'Check your email and password and try again.')
      return
    }

    navigate(role === 'nurse' ? '/nurse' : '/admin', { replace: true })
  })

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_14%_18%,rgba(29,78,216,0.12),transparent_24%),radial-gradient(circle_at_76%_22%,rgba(56,189,248,0.12),transparent_22%),radial-gradient(circle_at_28%_78%,rgba(245,158,11,0.08),transparent_20%),linear-gradient(180deg,#f6fbff_0%,#edf6ff_42%,#eef8ff_100%)] px-4 py-6 md:px-6 md:py-8">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-[84rem] items-center">
        <div className="grid w-full items-center gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(392px,452px)] lg:gap-3">
          <section className="relative overflow-hidden px-3 py-10 md:px-6 lg:flex lg:min-h-[560px] lg:items-center lg:py-0">
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.2)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.2)_1px,transparent_1px)] bg-[size:72px_72px] opacity-35 [mask-image:radial-gradient(circle_at_38%_52%,black_18%,transparent_74%)]" />
              <div className="absolute left-[3%] top-[12%] h-40 w-40 rounded-full bg-white/58 blur-3xl md:h-52 md:w-52" />
              <div className="absolute right-[12%] top-[12%] h-56 w-56 rounded-full bg-sky-200/38 blur-3xl md:h-72 md:w-72" />
              <div className="absolute bottom-[10%] left-[16%] h-52 w-52 rounded-full bg-amber-100/26 blur-3xl md:h-64 md:w-64" />
              <div className="login-ring-orbit absolute right-[16%] top-[24%] h-40 w-40 rounded-full border border-sky-200/55" />
              <div className="login-ring-orbit absolute right-[6%] top-[14%] h-72 w-72 rounded-full border border-sky-100/60" />
              <div className="login-line-flow absolute bottom-[16%] right-[18%] h-px w-32 bg-gradient-to-r from-transparent via-sky-300/80 to-transparent" />
              <div className="login-line-flow absolute bottom-[14%] right-[10%] h-px w-52 bg-gradient-to-r from-transparent via-amber-300/75 to-transparent" />
              <div className="absolute inset-y-[18%] right-[6%] hidden w-[34%] rounded-[2rem] border border-white/35 bg-[linear-gradient(135deg,rgba(255,255,255,0.3),rgba(191,219,254,0.14),rgba(255,255,255,0.05))] shadow-[inset_0_1px_0_rgba(255,255,255,0.4)] backdrop-blur-sm lg:block" />
              <div className="login-ring-orbit absolute right-[12%] top-[28%] hidden h-24 w-24 rounded-full border border-sky-300/60 lg:block" />
              <div
                className="login-dot-blink absolute right-[18%] top-[36%] hidden h-2 w-2 rounded-full bg-sky-500/80 lg:block"
                style={{ animationDelay: '400ms' }}
              />
              <div
                className="login-dot-blink absolute right-[20%] top-[54%] hidden h-2 w-2 rounded-full bg-teal-500/80 lg:block"
                style={{ animationDelay: '1800ms' }}
              />
              <div className="absolute left-[7%] top-[16%] hidden h-[54%] w-px bg-gradient-to-b from-transparent via-[#1d4ed8]/30 to-transparent lg:block" />
              <div className="absolute left-[calc(7%-4px)] top-[20%] hidden h-2.5 w-2.5 rounded-full bg-[#1e3a8a] lg:block" />
              <div className="absolute left-[calc(7%-2px)] top-[62%] hidden h-1.5 w-1.5 rounded-full bg-[#38bdf8] lg:block" />
            </div>

            <div className="relative flex min-h-[420px] flex-col justify-center gap-10 py-4 md:min-h-[520px] md:py-8 lg:pl-10">
              <div className="login-reveal max-w-[48rem] space-y-8" style={{ animationDelay: '90ms' }}>
                <div className="relative inline-flex items-center gap-5 overflow-hidden rounded-[2.35rem] border border-white/80 bg-[linear-gradient(120deg,rgba(255,255,255,0.9),rgba(231,244,255,0.74),rgba(255,249,232,0.46))] px-5 py-4 shadow-[0_28px_48px_-34px_rgba(30,58,138,0.28)] backdrop-blur-md">
                  <div className="absolute inset-y-0 left-0 w-28 bg-gradient-to-r from-[#1d4ed8]/10 via-[#38bdf8]/8 to-transparent" />
                  <motion.div
                    className="absolute inset-x-5 top-0 h-1 bg-gradient-to-r from-[#1d4ed8] via-[#38bdf8] to-[#fbbf24]"
                    animate={{ x: ['-8%', '8%', '-8%'] }}
                    transition={{ duration: 4.8, repeat: Infinity, ease: 'easeInOut' }}
                  />
                  <motion.div
                    className="absolute right-6 top-4 h-16 w-16 rounded-full border border-sky-200/60"
                    animate={{ scale: [1, 1.08, 1], opacity: [0.28, 0.52, 0.28] }}
                    transition={{ duration: 4.6, repeat: Infinity, ease: 'easeInOut' }}
                  />
                  <motion.div
                    className="absolute bottom-5 right-8 h-2.5 w-2.5 rounded-full bg-[#38bdf8]"
                    animate={{ scale: [1, 1.45, 1], opacity: [0.35, 0.95, 0.35] }}
                    transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
                  />

                  <div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-[1.6rem] border border-white/90 bg-white/88 shadow-[0_20px_32px_-26px_rgba(30,58,138,0.36)]">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(29,78,216,0.18),transparent_36%),radial-gradient(circle_at_82%_78%,rgba(251,191,36,0.16),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.28),transparent_72%)]" />
                    <motion.div
                      className="absolute inset-[14%] rounded-[1.3rem] bg-[radial-gradient(circle,rgba(56,189,248,0.2),transparent_68%)] blur-xl"
                      animate={{ scale: [0.92, 1.06, 0.92], opacity: [0.4, 0.72, 0.4] }}
                      transition={{ duration: 4.6, repeat: Infinity, ease: 'easeInOut' }}
                    />
                    <img
                      src={stPaulosLogo}
                      alt="St. Paulos logo"
                      className="relative h-[4.25rem] w-[4.25rem] object-cover"
                    />
                  </div>

                  <div className="relative min-w-0 space-y-2 pr-6">
                    <div className="flex items-center gap-3">
                      <span className="h-2.5 w-2.5 rounded-full bg-[#1d4ed8]" />
                      <span className="text-[0.72rem] font-semibold uppercase tracking-[0.38em] text-[#1d4ed8] sm:text-[0.8rem]">
                        Hospital
                      </span>
                    </div>

                    <div className="space-y-1">
                      <p className="text-[1.55rem] font-semibold uppercase leading-none tracking-[0.16em] text-slate-950 sm:text-[2.15rem]">
                        St. Paulos
                      </p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <p className="text-[0.9rem] font-medium uppercase tracking-[0.36em] text-slate-700 sm:text-[1.02rem]">
                          Internal Medicine
                        </p>
                        <motion.span
                          className="h-px w-20 bg-gradient-to-r from-[#1d4ed8] via-[#38bdf8] to-[#fbbf24]"
                          animate={{ width: ['4.5rem', '6rem', '4.5rem'], opacity: [0.72, 1, 0.72] }}
                          transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="space-y-4">
                    <h1 className="font-display max-w-[9.8ch] text-5xl font-semibold leading-[0.84] tracking-tight text-slate-950 md:text-[5.4rem] lg:text-[6.7rem]">
                      <span className="block">Weekly reporting</span>
                      <span className="relative mt-1 block min-h-[0.95em] text-[#1e3a8a]">
                        <span className="invisible">submissions</span>
                        <span className="absolute inset-0">
                          {typedText}
                          <motion.span
                            className="ml-1 inline-block h-[0.82em] w-[3px] bg-[#f59e0b] align-[-0.08em]"
                            animate={{ opacity: [1, 0, 1] }}
                            transition={{ duration: 0.72, repeat: Infinity, ease: 'easeInOut' }}
                          />
                        </span>
                      </span>
                    </h1>
                  </div>
                </div>
              </div>

              <div
                className="login-reveal relative flex items-center gap-4"
                style={{ animationDelay: '220ms' }}
              >
                <div className="w-full max-w-[34rem] rounded-[2rem] border border-white/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.72),rgba(239,246,255,0.52))] px-5 py-4 shadow-[0_18px_34px_-24px_rgba(30,58,138,0.18)] backdrop-blur-md">
                  <div className="grid grid-cols-[118px_minmax(0,1fr)_108px] items-center gap-5">
                    <div className="flex h-24 items-end gap-2 rounded-[1.4rem] bg-white/42 px-4 py-4">
                      <motion.span
                        className="h-8 w-3 rounded-full bg-sky-200"
                        animate={{ height: [32, 56, 32], opacity: [0.5, 1, 0.5] }}
                        transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
                      />
                      <motion.span
                        className="h-12 w-3 rounded-full bg-sky-400"
                        animate={{ height: [48, 34, 48], opacity: [0.6, 1, 0.6] }}
                        transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut', delay: 0.24 }}
                      />
                      <motion.span
                        className="h-16 w-3 rounded-full bg-[#1d4ed8]"
                        animate={{ height: [64, 76, 64], opacity: [0.7, 1, 0.7] }}
                        transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut', delay: 0.48 }}
                      />
                      <motion.span
                        className="h-10 w-3 rounded-full bg-teal-300"
                        animate={{ height: [40, 60, 40], opacity: [0.55, 1, 0.55] }}
                        transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut', delay: 0.72 }}
                      />
                      <motion.span
                        className="h-20 w-3 rounded-full bg-[#fbbf24]"
                        animate={{ height: [80, 52, 80], opacity: [0.6, 1, 0.6] }}
                        transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut', delay: 0.96 }}
                      />
                    </div>

                    <div className="space-y-3">
                      <div className="h-px w-24 bg-gradient-to-r from-[#1d4ed8]/60 via-[#38bdf8]/55 to-transparent" />
                      <div className="flex items-center gap-3">
                        <motion.span
                          className="h-2.5 w-2.5 rounded-full bg-[#1d4ed8]"
                          animate={{ scale: [1, 1.45, 1], opacity: [0.45, 1, 0.45] }}
                          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                        />
                        <motion.span
                          className="h-2.5 w-2.5 rounded-full bg-[#38bdf8]"
                          animate={{ scale: [1, 1.45, 1], opacity: [0.45, 1, 0.45] }}
                          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut', delay: 0.35 }}
                        />
                        <motion.span
                          className="h-2.5 w-2.5 rounded-full bg-[#fbbf24]"
                          animate={{ scale: [1, 1.45, 1], opacity: [0.45, 1, 0.45] }}
                          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut', delay: 0.7 }}
                        />
                      </div>
                      <svg viewBox="0 0 160 52" className="h-14 w-full overflow-visible">
                        <motion.path
                          d="M4 38 C 22 38, 24 12, 44 12 S 70 42, 90 28 S 118 8, 156 18"
                          fill="none"
                          stroke="#38bdf8"
                          strokeWidth="4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeDasharray="200"
                          animate={{ strokeDashoffset: [200, 0] }}
                          transition={{ duration: 2.6, repeat: Infinity, repeatDelay: 0.4, ease: 'easeInOut' }}
                        />
                        <motion.circle
                          cx="90"
                          cy="28"
                          r="5"
                          fill="#1d4ed8"
                          animate={{ scale: [1, 1.3, 1], opacity: [0.5, 1, 0.5] }}
                          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                        />
                      </svg>
                    </div>

                    <div className="relative flex h-24 w-24 items-center justify-center">
                      <svg viewBox="0 0 120 120" className="h-24 w-24 -rotate-90">
                        <circle
                          cx="60"
                          cy="60"
                          r="42"
                          fill="none"
                          stroke="rgba(255,255,255,0.72)"
                          strokeWidth="14"
                        />
                        <motion.circle
                          cx="60"
                          cy="60"
                          r="42"
                          fill="none"
                          stroke="#1d4ed8"
                          strokeWidth="14"
                          strokeLinecap="round"
                          strokeDasharray="88 176"
                          animate={{ rotate: [0, 18, 0] }}
                          transition={{ duration: 4.2, repeat: Infinity, ease: 'easeInOut' }}
                          style={{ transformOrigin: '60px 60px' }}
                        />
                        <motion.circle
                          cx="60"
                          cy="60"
                          r="42"
                          fill="none"
                          stroke="#38bdf8"
                          strokeWidth="14"
                          strokeLinecap="round"
                          strokeDasharray="56 208"
                          strokeDashoffset="-96"
                          animate={{ rotate: [0, -22, 0] }}
                          transition={{ duration: 4.6, repeat: Infinity, ease: 'easeInOut' }}
                          style={{ transformOrigin: '60px 60px' }}
                        />
                        <motion.circle
                          cx="60"
                          cy="60"
                          r="42"
                          fill="none"
                          stroke="#fbbf24"
                          strokeWidth="14"
                          strokeLinecap="round"
                          strokeDasharray="28 236"
                          strokeDashoffset="-162"
                          animate={{ rotate: [0, 28, 0] }}
                          transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
                          style={{ transformOrigin: '60px 60px' }}
                        />
                      </svg>
                      <motion.span
                        className="absolute h-2.5 w-2.5 rounded-full bg-[#1d4ed8]"
                        animate={{ scale: [1, 1.4, 1], opacity: [0.6, 1, 0.6] }}
                        transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <Card
            className="login-reveal relative overflow-hidden rounded-[2.35rem] border border-white/85 bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(241,248,255,0.92),rgba(255,255,255,0.9))] shadow-[0_34px_68px_-38px_rgba(30,58,138,0.3)] backdrop-blur-md lg:self-center"
            style={{ animationDelay: '160ms' }}
          >
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#1d4ed8] via-[#38bdf8] to-[#0f766e]" />
              <div className="absolute left-0 top-0 h-full w-24 bg-gradient-to-r from-[#1d4ed8]/7 via-[#38bdf8]/5 to-transparent" />
              <div className="absolute right-[-20%] top-[-14%] h-44 w-44 rounded-full bg-sky-200/24 blur-3xl" />
              <div className="absolute bottom-[-18%] right-[6%] h-40 w-40 rounded-full bg-amber-100/24 blur-3xl" />
              <motion.div
                className="absolute right-8 top-8 h-16 w-16 rounded-full border border-sky-200/55"
                animate={{ scale: [1, 1.08, 1], opacity: [0.28, 0.5, 0.28] }}
                transition={{ duration: 4.8, repeat: Infinity, ease: 'easeInOut' }}
              />
              <motion.div
                className="absolute right-14 top-14 h-2.5 w-2.5 rounded-full bg-[#38bdf8]"
                animate={{ scale: [1, 1.45, 1], opacity: [0.45, 1, 0.45] }}
                transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
              />
            </div>

            <CardHeader className="relative space-y-4 px-8 pb-0 pt-8">
              <div className="flex items-center gap-3">
                <span className="h-2.5 w-2.5 rounded-full bg-[#1d4ed8]" />
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#1d4ed8]">
                  Access portal
                </p>
              </div>
              <div className="space-y-2">
                <CardTitle className="text-[2.2rem] leading-none text-slate-950">
                  Sign in
                </CardTitle>
                <motion.div
                  className="h-px w-28 bg-gradient-to-r from-[#1d4ed8] via-[#38bdf8] to-[#fbbf24]"
                  animate={{ width: ['5.5rem', '7.5rem', '5.5rem'], opacity: [0.72, 1, 0.72] }}
                  transition={{ duration: 3.6, repeat: Infinity, ease: 'easeInOut' }}
                />
              </div>
            </CardHeader>
            <CardContent className="relative space-y-6 px-8 pb-8 pt-7">
              <form className="space-y-5" onSubmit={onSubmit}>
                <div className="space-y-2">
                  <Label className="text-[0.95rem] font-medium text-slate-700" htmlFor="email">
                    Email
                  </Label>
                  <Input
                    id="email"
                    className="h-14 rounded-[1.15rem] border-white/80 bg-[linear-gradient(180deg,rgba(226,236,255,0.72),rgba(241,247,255,0.96))] px-5 text-[1.02rem] shadow-[0_12px_22px_-20px_rgba(30,58,138,0.35)] placeholder:text-slate-400 focus-visible:border-sky-300 focus-visible:ring-sky-200/70"
                    {...form.register('email')}
                    disabled={!isConfigured || isBootstrapping}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-[0.95rem] font-medium text-slate-700" htmlFor="password">
                    Password
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    className="h-14 rounded-[1.15rem] border-white/80 bg-[linear-gradient(180deg,rgba(226,236,255,0.72),rgba(241,247,255,0.96))] px-5 text-[1.02rem] shadow-[0_12px_22px_-20px_rgba(30,58,138,0.35)] placeholder:text-slate-400 focus-visible:border-sky-300 focus-visible:ring-sky-200/70"
                    {...form.register('password')}
                    disabled={!isConfigured || isBootstrapping}
                  />
                </div>
                {error ? <p className="text-sm text-red-600">{error}</p> : null}
                {!isConfigured ? (
                  <p className="text-sm text-amber-700">
                    Missing environment: {missingEnvVars.join(', ')}
                  </p>
                ) : null}
                <Button
                  className="h-14 w-full rounded-[1.2rem] border-0 bg-[linear-gradient(90deg,#1d4ed8_0%,#0ea5e9_52%,#0f766e_100%)] text-base font-medium text-white shadow-[0_18px_36px_-20px_rgba(30,58,138,0.45)] transition-transform duration-300 hover:-translate-y-0.5 hover:brightness-105"
                  type="submit"
                  disabled={!isConfigured || isBootstrapping}
                >
                  {isBootstrapping ? 'Signing in...' : 'Enter dashboard'}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </form>

              <div className="border-t border-slate-200/80 pt-5">
                <Link
                  className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900 transition-colors hover:text-[#1d4ed8]"
                  to="/register"
                >
                  Create account / request access
                  <span className="text-[#1d4ed8]">→</span>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
