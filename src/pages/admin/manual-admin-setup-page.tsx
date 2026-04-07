import { zodResolver } from '@hookform/resolvers/zod'
import {
  Controller,
  useForm,
} from 'react-hook-form'
import {
  useEffect,
  useState,
} from 'react'
import { Navigate } from 'react-router-dom'
import { z } from 'zod'
import {
  ShieldCheck,
  UserCog,
  UserRoundPlus,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAppData } from '@/context/app-data-context'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import type { UserProfile } from '@/types/domain'

const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Use at least 3 characters.')
  .max(32, 'Keep the username under 32 characters.')
  .regex(/^[a-z0-9._-]+$/i, 'Use only letters, numbers, dots, underscores, or hyphens.')

const bootstrapSchema = z.object({
  fullName: z.string().trim().min(3, 'Enter a full name.'),
  username: usernameSchema,
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().min(8, 'Use at least 8 characters.'),
})

const adminAccountSchema = z.object({
  fullName: z.string().trim().min(3, 'Enter a full name.'),
  username: usernameSchema,
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().min(8, 'Use at least 8 characters.'),
  role: z.enum(['admin', 'doctor_admin']),
  title: z.string().trim().max(80, 'Keep the title under 80 characters.').optional(),
})

type BootstrapValues = z.infer<typeof bootstrapSchema>
type AdminAccountValues = z.infer<typeof adminAccountSchema>

const roleLabels = {
  superadmin: 'Superadmin',
  admin: 'Admin',
  doctor_admin: 'Clinical lead',
  nurse: 'Nurse',
} as const

function adminSortValue(profile: UserProfile) {
  if (profile.role === 'superadmin') {
    return 0
  }

  if (profile.role === 'doctor_admin') {
    return 1
  }

  return 2
}

export function ManualAdminSetupPage() {
  const client = getSupabaseBrowserClient()
  const {
    state,
    currentUser,
    claimSuperadmin,
    createAdminAccount,
    ensureProfileDirectoryData,
    toggleUserActive,
  } = useAppData()
  const [pendingAuthState, setPendingAuthState] = useState<{
    pendingEmail: string | null
    userId: string
  } | null>(null)

  useEffect(() => {
    if (!currentUser) {
      return
    }

    void ensureProfileDirectoryData()
  }, [currentUser, ensureProfileDirectoryData])

  useEffect(() => {
    if (!client || !currentUser) {
      return
    }

    let ignore = false
    const currentAuthUserId = currentUser.id

    void client.auth
      .getUser()
      .then(({ data, error }) => {
        if (ignore) {
          return
        }

        if (error || !data.user || data.user.id !== currentUser.id) {
          setPendingAuthState({
            pendingEmail: null,
            userId: currentAuthUserId,
          })
          return
        }

        const nextPendingEmail = data.user.new_email?.trim().toLowerCase() ?? null
        const currentConfirmedEmail = data.user.email?.trim().toLowerCase() ?? currentUser.email

        setPendingAuthState({
          pendingEmail:
            nextPendingEmail && nextPendingEmail !== currentConfirmedEmail
              ? nextPendingEmail
              : null,
          userId: currentAuthUserId,
        })
      })
      .catch(() => {
        if (!ignore) {
          setPendingAuthState({
            pendingEmail: null,
            userId: currentAuthUserId,
          })
        }
      })

    return () => {
      ignore = true
    }
  }, [client, currentUser])

  const bootstrapForm = useForm<BootstrapValues>({
    resolver: zodResolver(bootstrapSchema),
    defaultValues: {
      fullName: currentUser?.fullName ?? '',
      username: currentUser?.username ?? '',
      email: currentUser?.email ?? '',
      password: '',
    },
  })

  const adminForm = useForm<AdminAccountValues>({
    resolver: zodResolver(adminAccountSchema),
    defaultValues: {
      fullName: '',
      username: '',
      email: '',
      password: '',
      role: 'admin',
      title: '',
    },
  })

  useEffect(() => {
    bootstrapForm.reset({
      fullName: currentUser?.fullName ?? '',
      username: currentUser?.username ?? '',
      email: currentUser?.email ?? '',
      password: '',
    })
  }, [bootstrapForm, currentUser])

  if (!currentUser) {
    return null
  }

  const pendingAuthEmail =
    pendingAuthState?.userId === currentUser.id ? pendingAuthState.pendingEmail : null

  const hasSuperadmin = state.profiles.some((profile) => profile.role === 'superadmin')
  const isSuperadmin = currentUser.role === 'superadmin'
  const canBootstrap =
    !hasSuperadmin && (currentUser.role === 'admin' || currentUser.role === 'doctor_admin')

  if (!canBootstrap && !isSuperadmin) {
    return <Navigate to="/admin" replace />
  }

  const adminProfiles = state.profiles
    .filter((profile) => profile.role !== 'nurse')
    .sort((left, right) => {
      const roleOrder = adminSortValue(left) - adminSortValue(right)
      if (roleOrder !== 0) {
        return roleOrder
      }

      return left.fullName.localeCompare(right.fullName)
    })

  const onBootstrap = bootstrapForm.handleSubmit(async (values) => {
    const success = await claimSuperadmin({
      fullName: values.fullName,
      username: values.username,
      email: values.email,
      password: values.password,
    })

    if (!success) {
      return
    }

    bootstrapForm.reset({
      ...values,
      password: '',
    })

    const normalizedEmail = values.email.trim().toLowerCase()
    const client = getSupabaseBrowserClient()

    if (!client) {
      return
    }

    const { data } = await client.auth.getUser()
    const currentConfirmedEmail = data.user?.email?.trim().toLowerCase() ?? normalizedEmail
    const nextPendingEmail = data.user?.new_email?.trim().toLowerCase() ?? null

    setPendingAuthState({
      pendingEmail:
        nextPendingEmail && nextPendingEmail !== currentConfirmedEmail
          ? nextPendingEmail
          : null,
      userId: currentUser.id,
    })

    if (nextPendingEmail && nextPendingEmail !== currentConfirmedEmail) {
      toast.message(
        `The new email ${nextPendingEmail} still needs confirmation. Supabase keeps the old confirmed email active until that is finished.`,
      )
    }
  })

  const onCreateAdmin = adminForm.handleSubmit(async (values) => {
    const success = await createAdminAccount({
      fullName: values.fullName,
      username: values.username,
      email: values.email,
      password: values.password,
      role: values.role,
      title: values.title || undefined,
    })

    if (!success) {
      return
    }

    adminForm.reset({
      fullName: '',
      username: '',
      email: '',
      password: '',
      role: 'admin',
      title: '',
    })
  })

  return (
    <div className="space-y-8 px-4 py-6 md:px-6 lg:px-8">
      <section className="rounded-[0.35rem] bg-[#eef2f6] px-5 py-5 md:px-6">
        <div className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#005db6]">
            Hidden setup
          </p>
          <h1 className="font-display text-[2rem] leading-[0.96] tracking-[-0.03em] text-[#000a1e] md:text-[2.35rem]">
            Admin account setup
          </h1>
          <p className="max-w-3xl text-sm leading-6 text-[#44474e]">
            This route is intentionally not shown in the navigation. Use it to bootstrap the one
            superadmin account, then create or deactivate admin users without exposing public admin
            signup.
          </p>
        </div>
      </section>

      {canBootstrap ? (
        <section className="rounded-[0.35rem] bg-[#eef2f6] px-5 py-6">
          <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-[0.25rem] border border-[#d4dde8] bg-[#ffffff] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#005db6]">
                <ShieldCheck className="h-4 w-4" />
                First-time bootstrap
              </div>
              <h2 className="font-display text-[1.85rem] text-[#000a1e]">Claim superadmin</h2>
              <p className="text-sm leading-6 text-[#44474e]">
                No superadmin exists yet. Claim this signed-in account as the one protected
                superadmin before creating any other admin users. This updates the current
                account with the final sign-in username, email, and password.
              </p>
            </div>

            <form className="space-y-5 rounded-[0.35rem] border border-[#d4dde8] bg-[#ffffff] p-5" onSubmit={onBootstrap}>
              <div className="space-y-2">
                <Label>Full name</Label>
                <Input className="h-12 px-4" {...bootstrapForm.register('fullName')} />
                {bootstrapForm.formState.errors.fullName ? (
                  <p className="text-xs text-[#ba1a1a]">
                    {bootstrapForm.formState.errors.fullName.message}
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label>Username</Label>
                <Input
                  className="h-12 px-4"
                  autoComplete="username"
                  {...bootstrapForm.register('username')}
                />
                {bootstrapForm.formState.errors.username ? (
                  <p className="text-xs text-[#ba1a1a]">
                    {bootstrapForm.formState.errors.username.message}
                  </p>
                ) : (
                  <p className="text-xs text-[#74777f]">
                    This username can be used on the sign-in page.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  className="h-12 px-4"
                  autoComplete="email"
                  type="email"
                  {...bootstrapForm.register('email')}
                />
                {bootstrapForm.formState.errors.email ? (
                  <p className="text-xs text-[#ba1a1a]">
                    {bootstrapForm.formState.errors.email.message}
                  </p>
                ) : (
                  <p className="text-xs text-[#74777f]">
                    This becomes the superadmin sign-in email.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Password</Label>
                <Input
                  className="h-12 px-4"
                  autoComplete="new-password"
                  type="password"
                  {...bootstrapForm.register('password')}
                />
                {bootstrapForm.formState.errors.password ? (
                  <p className="text-xs text-[#ba1a1a]">
                    {bootstrapForm.formState.errors.password.message}
                  </p>
                ) : (
                  <p className="text-xs text-[#74777f]">
                    Use this password for future superadmin sign-in.
                  </p>
                )}
              </div>

              <div className="flex justify-end">
                <Button type="submit" disabled={bootstrapForm.formState.isSubmitting}>
                  <ShieldCheck className="h-4 w-4" />
                  {bootstrapForm.formState.isSubmitting
                    ? 'Claiming...'
                    : 'Claim superadmin'}
                </Button>
              </div>
            </form>
          </div>
        </section>
      ) : null}

      {isSuperadmin ? (
        <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <section className="rounded-[0.35rem] bg-[#eef2f6] px-5 py-6">
            <div className="space-y-5">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#005db6]">
                  Manual create
                </p>
                <h2 className="font-display text-[1.85rem] text-[#000a1e]">Create admin user</h2>
                <p className="text-sm text-[#44474e]">
                  This creates the auth account, then promotes the matching profile to an admin
                  role.
                </p>
              </div>

              <form className="space-y-5" onSubmit={onCreateAdmin}>
                <div className="space-y-2">
                  <Label>Full name</Label>
                  <Input className="h-12 px-4" {...adminForm.register('fullName')} />
                  {adminForm.formState.errors.fullName ? (
                    <p className="text-xs text-[#ba1a1a]">
                      {adminForm.formState.errors.fullName.message}
                    </p>
                  ) : null}
                </div>

                <div className="grid gap-5 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Username</Label>
                    <Input
                      className="h-12 px-4"
                      autoComplete="username"
                      {...adminForm.register('username')}
                    />
                    {adminForm.formState.errors.username ? (
                      <p className="text-xs text-[#ba1a1a]">
                        {adminForm.formState.errors.username.message}
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <Label>Role</Label>
                    <Controller
                      control={adminForm.control}
                      name="role"
                      render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger className="h-12 bg-white">
                            <SelectValue placeholder="Choose role" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="doctor_admin">Clinical lead</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input
                    className="h-12 px-4"
                    autoComplete="email"
                    type="email"
                    {...adminForm.register('email')}
                  />
                  {adminForm.formState.errors.email ? (
                    <p className="text-xs text-[#ba1a1a]">
                      {adminForm.formState.errors.email.message}
                    </p>
                  ) : null}
                </div>

                <div className="grid gap-5 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Password</Label>
                    <Input
                      className="h-12 px-4"
                      autoComplete="new-password"
                      type="password"
                      {...adminForm.register('password')}
                    />
                    {adminForm.formState.errors.password ? (
                      <p className="text-xs text-[#ba1a1a]">
                        {adminForm.formState.errors.password.message}
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <Label>Title</Label>
                    <Input
                      className="h-12 px-4"
                      placeholder="Optional"
                      {...adminForm.register('title')}
                    />
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button type="submit" disabled={adminForm.formState.isSubmitting}>
                    <UserRoundPlus className="h-4 w-4" />
                    {adminForm.formState.isSubmitting ? 'Creating...' : 'Create admin'}
                  </Button>
                </div>
              </form>
            </div>
          </section>

          <section className="rounded-[0.35rem] bg-[#eef2f6] px-5 py-6">
            <div className="space-y-5">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#005db6]">
                  Restricted roster
                </p>
                <h2 className="font-display text-[1.85rem] text-[#000a1e]">Admin accounts</h2>
                <p className="text-sm text-[#44474e]">
                  Only the superadmin can activate or deactivate admin users. The protected
                  superadmin account cannot be disabled here.
                </p>
              </div>

              <div className="space-y-3">
                {adminProfiles.map((profile) => {
                  const isProtected = profile.role === 'superadmin'
                  const isCurrentUser = profile.id === currentUser.id

                  return (
                    <div
                      key={profile.id}
                      className="rounded-[0.35rem] border border-[#d4dde8] bg-[#ffffff] p-4"
                    >
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-base font-semibold text-[#000a1e]">
                              {profile.fullName}
                            </p>
                            <span
                              className={cn(
                                'rounded-[0.25rem] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]',
                                profile.active
                                  ? 'bg-emerald-50 text-emerald-800'
                                  : 'bg-rose-50 text-rose-800',
                              )}
                            >
                              {profile.active ? 'Active' : 'Inactive'}
                            </span>
                            <span className="rounded-[0.25rem] border border-[#d4dde8] bg-[#f3f4f5] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#44474e]">
                              {roleLabels[profile.role]}
                            </span>
                            {isCurrentUser ? (
                              <span className="rounded-[0.25rem] border border-[#d4dde8] bg-[#edf4fb] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#005db6]">
                                Current
                              </span>
                            ) : null}
                          </div>
                          <div className="space-y-1 text-sm text-[#44474e]">
                            <p>
                              {isCurrentUser && pendingAuthEmail ? 'Current email: ' : ''}
                              {profile.email}
                            </p>
                            {isCurrentUser && pendingAuthEmail ? (
                              <p className="font-medium text-[#946300]">
                                Pending email change: {pendingAuthEmail}
                              </p>
                            ) : null}
                            <p>
                              Username:{' '}
                              <span className="font-semibold text-[#000a1e]">
                                {profile.username ?? 'Not set'}
                              </span>
                            </p>
                            <p>{profile.title}</p>
                          </div>
                        </div>

                        <Button
                          variant="secondary"
                          disabled={isProtected}
                          onClick={() => void toggleUserActive(profile.id)}
                        >
                          {isProtected ? (
                            <>
                              <UserCog className="h-4 w-4" />
                              Protected
                            </>
                          ) : profile.active ? (
                            'Deactivate'
                          ) : (
                            'Activate'
                          )}
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </section>
        </section>
      ) : null}
    </div>
  )
}
