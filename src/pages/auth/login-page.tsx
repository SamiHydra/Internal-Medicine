import { zodResolver } from '@hookform/resolvers/zod'
import { Activity, ArrowRight, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router-dom'
import { z } from 'zod'

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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.12),_transparent_30%),radial-gradient(circle_at_bottom_right,_rgba(20,184,166,0.1),_transparent_35%),linear-gradient(180deg,_#f8fbff_0%,_#eef4fb_100%)] px-4 py-6 md:px-6 md:py-8">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-7xl items-center">
        <div className="grid w-full items-center gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(380px,460px)]">
          <section className="relative overflow-hidden px-3 py-10 md:px-6 lg:py-0">
            <div className="pointer-events-none absolute inset-0">
              <div className="login-grid-drift absolute inset-0" />
              <div className="login-ambient-drift-reverse absolute left-[2%] top-[8%] h-40 w-40 rounded-full bg-white/55 blur-3xl md:h-52 md:w-52" />
              <div className="login-ambient-drift absolute right-[8%] top-[10%] h-56 w-56 rounded-full bg-sky-200/45 blur-3xl md:h-72 md:w-72" />
              <div className="login-ambient-drift-reverse absolute bottom-[8%] left-[12%] h-52 w-52 rounded-full bg-teal-200/35 blur-3xl md:h-64 md:w-64" />
              <div className="login-ring-orbit absolute right-[14%] top-[22%] h-40 w-40 rounded-full border border-white/60" />
              <div className="login-ring-orbit absolute right-[4%] top-[12%] h-72 w-72 rounded-full border border-sky-200/50" />
              <div className="login-line-flow absolute bottom-[14%] right-[18%] h-px w-32 bg-gradient-to-r from-transparent via-sky-300/80 to-transparent" />
              <div className="login-line-flow absolute bottom-[12%] right-[10%] h-px w-52 bg-gradient-to-r from-transparent via-teal-300/70 to-transparent" />
              <div className="login-glass-shimmer absolute inset-y-[18%] right-[6%] hidden w-[32%] rounded-[2rem] border border-white/35 bg-[linear-gradient(135deg,rgba(255,255,255,0.34),rgba(191,219,254,0.14),rgba(255,255,255,0.06))] shadow-[inset_0_1px_0_rgba(255,255,255,0.4)] backdrop-blur-sm lg:block" />
              <div className="login-ring-orbit absolute right-[10%] top-[26%] hidden h-24 w-24 rounded-full border border-sky-300/60 lg:block" />
              <div
                className="login-dot-blink absolute right-[18%] top-[36%] hidden h-2 w-2 rounded-full bg-sky-500/80 lg:block"
                style={{ animationDelay: '400ms' }}
              />
              <div
                className="login-dot-blink absolute right-[20%] top-[54%] hidden h-2 w-2 rounded-full bg-teal-500/80 lg:block"
                style={{ animationDelay: '1800ms' }}
              />
              <div className="absolute left-[6%] top-[12%] hidden h-[52%] w-px bg-gradient-to-b from-transparent via-white/80 to-transparent lg:block" />
            </div>

            <div className="relative flex min-h-[420px] flex-col justify-between py-4 md:min-h-[520px] md:py-8">
              <div className="login-reveal space-y-6" style={{ animationDelay: '90ms' }}>
                <div className="inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-sky-700 shadow-[0_14px_30px_-24px_rgba(14,165,233,0.55)] backdrop-blur-sm">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Secure weekly operational reporting
                </div>

                <div className="space-y-5">
                  <h1 className="font-display max-w-2xl text-4xl font-semibold leading-[0.95] tracking-tight text-slate-950 md:text-6xl lg:text-[4.9rem]">
                    Internal Medicine Weekly Reporting Dashboard
                  </h1>
                  <div className="flex flex-wrap gap-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                    <span
                      className="login-chip-float rounded-full border border-white/70 bg-white/55 px-3 py-2 backdrop-blur-sm"
                      style={{ animationDelay: '0ms' }}
                    >
                      Inpatient
                    </span>
                    <span
                      className="login-chip-float rounded-full border border-white/70 bg-white/55 px-3 py-2 backdrop-blur-sm"
                      style={{ animationDelay: '800ms' }}
                    >
                      Outpatient
                    </span>
                    <span
                      className="login-chip-float rounded-full border border-white/70 bg-white/55 px-3 py-2 backdrop-blur-sm"
                      style={{ animationDelay: '1600ms' }}
                    >
                      Diagnostic
                    </span>
                  </div>
                </div>
              </div>

              <div
                className="login-reveal relative mt-10 flex items-end justify-between gap-6"
                style={{ animationDelay: '220ms' }}
              >
                <div className="max-w-xs rounded-[1.75rem] border border-white/60 bg-white/52 p-4 shadow-[0_24px_50px_-30px_rgba(15,23,42,0.28)] backdrop-blur-md">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
                    <Activity className="h-4 w-4" />
                    Live workspace
                  </div>
                  <div className="mt-4 flex items-end gap-2">
                    <span
                      className="login-bar-breathe h-8 w-2 rounded-full bg-sky-200"
                      style={{ animationDelay: '0ms' }}
                    />
                    <span
                      className="login-bar-breathe h-12 w-2 rounded-full bg-sky-300"
                      style={{ animationDelay: '260ms' }}
                    />
                    <span
                      className="login-bar-breathe h-16 w-2 rounded-full bg-sky-400"
                      style={{ animationDelay: '520ms' }}
                    />
                    <span
                      className="login-bar-breathe h-10 w-2 rounded-full bg-teal-300"
                      style={{ animationDelay: '780ms' }}
                    />
                    <span
                      className="login-bar-breathe h-20 w-2 rounded-full bg-teal-500"
                      style={{ animationDelay: '1040ms' }}
                    />
                  </div>
                </div>

                <div className="hidden h-px flex-1 bg-gradient-to-r from-slate-300/0 via-slate-300/55 to-slate-300/0 lg:block" />
              </div>
            </div>
          </section>

          <Card
            className="login-reveal border-white/80 bg-white/94 lg:self-center"
            style={{ animationDelay: '160ms' }}
          >
            <CardHeader className="space-y-3 pb-0">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
                Access portal
              </p>
              <CardTitle className="text-3xl">Sign in</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
              <form className="space-y-5" onSubmit={onSubmit}>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    {...form.register('email')}
                    disabled={!isConfigured || isBootstrapping}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
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
                  className="w-full"
                  type="submit"
                  disabled={!isConfigured || isBootstrapping}
                >
                  {isBootstrapping ? 'Signing in...' : 'Enter dashboard'}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </form>

              <div className="border-t border-slate-200 pt-5">
                <Link
                  className="text-sm font-semibold text-sky-700 transition-colors hover:text-sky-800"
                  to="/register"
                >
                  Create account / request access
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
