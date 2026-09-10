import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { z } from 'zod'
import {
  UserCog,
  UserRoundPlus,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAppData } from '@/context/app-data-context'
import { cn } from '@/lib/utils'
import type { UserProfile } from '@/types/domain'

const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Use at least 3 characters.')
  .max(32, 'Keep the username under 32 characters.')
  .regex(/^[a-z0-9._-]+$/i, 'Use only letters, numbers, dots, underscores, or hyphens.')

const adminAccountSchema = z.object({
  fullName: z.string().trim().min(3, 'Enter a full name.'),
  username: usernameSchema,
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().min(8, 'Use at least 8 characters.'),
  title: z.string().trim().max(80, 'Keep the title under 80 characters.').optional(),
})

type AdminAccountValues = z.infer<typeof adminAccountSchema>

const roleLabels = {
  superadmin: 'Maintenance',
  admin: 'Admin',
  nurse: 'Nurse',
  resident: 'Resident',
  consultant: 'Consultant',
  student_rep: 'Student rep',
} as const

function adminSortValue(profile: UserProfile) {
  return profile.role === 'superadmin' ? 0 : 1
}

export function ManualAdminSetupPage() {
  const {
    state,
    currentUser,
    createAdminAccount,
    ensureProfileDirectoryData,
    toggleUserActive,
  } = useAppData()

  useEffect(() => {
    if (!currentUser) {
      return
    }

    void ensureProfileDirectoryData()
  }, [currentUser, ensureProfileDirectoryData])

  const adminForm = useForm<AdminAccountValues>({
    resolver: zodResolver(adminAccountSchema),
    defaultValues: {
      fullName: '',
      username: '',
      email: '',
      password: '',
      title: '',
    },
  })

  if (!currentUser) {
    return null
  }

  // The maintenance owner (superadmin) is the only role allowed to create admin
  // accounts directly and manage the admin roster. It is created only via the
  // server/database and can never be claimed through the app.
  if (currentUser.role !== 'superadmin') {
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

  const onCreateAdmin = adminForm.handleSubmit(async (values) => {
    const success = await createAdminAccount({
      fullName: values.fullName,
      username: values.username,
      email: values.email,
      password: values.password,
      role: 'admin',
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
      title: '',
    })
  })

  return (
    <div className="space-y-8 px-4 py-6 md:px-6 lg:px-8">
      <section className="rounded-[0.35rem] bg-[#eef2f6] px-5 py-5 md:px-6">
        <div className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#005db6]">
            Maintenance tools
          </p>
          <p className="max-w-3xl text-sm leading-6 text-[#44474e]">
            This route is intentionally not shown in the navigation. Create admin users directly, or
            deactivate them, without waiting on the approval queue. The maintenance owner is created
            only on the server and cannot be claimed from inside the app.
          </p>
        </div>
      </section>

      {/* minmax(0,…) tracks and min-w-0 panels keep the single phone column from
          taking the panels' min-content width and overflowing the viewport (QA-012). */}
      <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <section className="min-w-0 rounded-[0.35rem] bg-[#eef2f6] px-5 py-6">
          <div className="space-y-5">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#005db6]">
                Manual create
              </p>
              <h2 className="font-display text-[1.85rem] text-[#000a1e]">Create admin user</h2>
              <p className="text-sm text-[#44474e]">
                This creates the auth account immediately, bypassing the approval queue.
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

        <section className="min-w-0 rounded-[0.35rem] bg-[#eef2f6] px-5 py-6">
          <div className="space-y-5">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#005db6]">
                Restricted roster
              </p>
              <h2 className="font-display text-[1.85rem] text-[#000a1e]">Admin accounts</h2>
              <p className="text-sm text-[#44474e]">
                Only the maintenance owner can deactivate admin users. The maintenance account
                itself cannot be disabled here.
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
                      {/* min-w-0 and overflow-wrap: a long name or email must wrap
                          instead of widening the page on a 320px phone (QA-012 sweep). */}
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-base font-semibold text-[#000a1e] [overflow-wrap:anywhere]">
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
                        <div className="space-y-1 text-sm text-[#44474e] [overflow-wrap:anywhere]">
                          <p>{profile.email}</p>
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
    </div>
  )
}
