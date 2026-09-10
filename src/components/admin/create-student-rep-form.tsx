import { useState, type FormEvent } from 'react'
import { UserRoundPlus } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAppData } from '@/context/app-data-context'

/**
 * Creates a student-representative account.
 *
 * Every other role reaches the system through public signup plus an approval
 * queue. A rep is appointed, not self-declared, so the public form deliberately
 * does not offer the role and an administrator is the only way to create one.
 * Until this existed the role was unusable: the rep-assignment form told admins
 * to "create the account in Users & Access first", and no such form existed.
 *
 * The account is created with password_change_required, so the temporary
 * password set here is replaced by the rep on first sign-in.
 */
export function CreateStudentRepForm({ onCreated }: { onCreated?: () => void }) {
  const { createAdminAccount } = useAppData()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Mirrors the production password policy (AppServiceProvider: min 12 +
  // mixedCase + numbers). Deliberately stricter than the 8-char local rule, so
  // an admin never sets a password here that the real server would reject.
  const passwordTooShort = password.length > 0 && password.length < 12
  const canSubmit =
    fullName.trim().length > 1 && email.trim().length > 3 && password.length >= 12 && !isSubmitting

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) {
      return
    }

    setIsSubmitting(true)
    try {
      const created = await createAdminAccount({
        fullName: fullName.trim(),
        username: username.trim() || email.trim().split('@')[0],
        email: email.trim(),
        password,
        role: 'student_rep',
      })

      if (!created) {
        return
      }

      toast.success(`${fullName.trim()} can now sign in and record teaching sessions.`)
      setFullName('')
      setEmail('')
      setUsername('')
      setPassword('')
      onCreated?.()
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor="repFullName">Full name</Label>
        <Input
          id="repFullName"
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          placeholder="Selam Tadesse"
          autoComplete="off"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="repEmail">Email</Label>
        <Input
          id="repEmail"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="selam.tadesse@stpaulos.local"
          autoComplete="off"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="repUsername">Username</Label>
        <Input
          id="repUsername"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="Defaults to the email name"
          autoComplete="off"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="repPassword">Temporary password</Label>
        <Input
          id="repPassword"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="At least 12 characters"
          autoComplete="new-password"
          aria-invalid={passwordTooShort || undefined}
          aria-describedby={passwordTooShort ? 'repPasswordHint' : undefined}
        />
        {/* Say why the button is disabled rather than leaving the reason in a
            placeholder that disappears as soon as they type. */}
        {passwordTooShort ? (
          <p id="repPasswordHint" className="text-sm text-[#ba1a1a]">
            Use at least 12 characters.
          </p>
        ) : null}
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={!canSubmit}>
          <UserRoundPlus className="h-4 w-4" />
          {isSubmitting ? 'Creating rep...' : 'Create rep account'}
        </Button>
        <p className="mt-2 text-sm leading-5 text-[#5f6670]">
          The rep sets their own password on first sign-in. Reps can only record whether a
          teaching session was held; they can never reach evaluations or scores.
        </p>
      </div>
    </form>
  )
}
