import { Eye, EyeOff } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import stPaulosLogo from '@/assets/StPaulosLogoColor.jpg'
import { useAppData } from '@/context/app-data-context'
import { landingPathForRole } from '@/routes/landing'

const fieldClass =
  'h-12 w-full rounded-none border-0 border-b-2 border-transparent bg-[linear-gradient(180deg,#edf3fa_0%,#f7f9fb_100%)] px-4 pr-11 text-[0.95rem] font-medium text-[#191c1d] outline-none transition focus:border-[#005db6] focus:bg-[#fbfdff]'

export function ForcePasswordChangePage() {
  const navigate = useNavigate()
  const { currentUser, changePassword, logout } = useAppData()
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [show, setShow] = useState(false)

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
    if (password === currentPassword) {
      setError('Choose a password different from your current one.')
      return
    }

    setIsSubmitting(true)
    const ok = await changePassword(currentPassword, password)
    setIsSubmitting(false)

    if (ok) {
      navigate(currentUser ? landingPathForRole(currentUser.role) : '/login', { replace: true })
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
                <img src={stPaulosLogo} alt="St Paul logo" className="h-full w-full object-cover" />
              </div>
              <div>
                <p className="text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-[#005db6]">
                  St Paul Hospital
                </p>
                <p className="font-display text-[1.1rem] text-[#000a1e]">Internal Medicine</p>
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#005db6]">
                Security
              </p>
              <h1 className="font-display text-[2rem] leading-[0.98] tracking-[-0.04em] text-[#000a1e] sm:text-[2.35rem]">
                Set a new password
              </h1>
              <p className="text-sm leading-7 text-[#5b6169]">
                Your account uses a temporary password. Choose a new one to continue to the workspace.
              </p>
            </div>

            <form className="space-y-5" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <label
                  className="block text-[11px] font-bold uppercase tracking-[0.12em] text-[#000a1e]"
                  htmlFor="current-password"
                >
                  Current (temporary) password
                </label>
                <input
                  id="current-password"
                  type={show ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  className={fieldClass}
                  disabled={isSubmitting}
                  autoComplete="current-password"
                />
              </div>

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
                    type={show ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className={fieldClass}
                    disabled={isSubmitting}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center text-[#c4c6cf] transition hover:text-[#000a1e]"
                    onClick={() => setShow((current) => !current)}
                    aria-label={show ? 'Hide password' : 'Show password'}
                    disabled={isSubmitting}
                  >
                    {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label
                  className="block text-[11px] font-bold uppercase tracking-[0.12em] text-[#000a1e]"
                  htmlFor="confirm-password"
                >
                  Confirm new password
                </label>
                <input
                  id="confirm-password"
                  type={show ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className={fieldClass}
                  disabled={isSubmitting}
                  autoComplete="new-password"
                />
              </div>

              {error ? <p className="text-sm font-medium text-[#ba1a1a]">{error}</p> : null}

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <button
                  className="auth-primary-button flex h-12 items-center justify-center rounded-[3px] px-5 text-[0.82rem] font-bold uppercase tracking-[0.16em]"
                  type="submit"
                  disabled={isSubmitting}
                  style={{ fontFamily: 'Manrope, sans-serif' }}
                >
                  {isSubmitting ? 'Saving...' : 'Update password'}
                </button>

                <button
                  type="button"
                  className="inline-flex items-center gap-2 text-sm font-semibold text-[#005db6]"
                  onClick={() => void logout()}
                  disabled={isSubmitting}
                >
                  Sign out
                </button>
              </div>
            </form>
          </div>
        </section>
      </div>
    </div>
  )
}
