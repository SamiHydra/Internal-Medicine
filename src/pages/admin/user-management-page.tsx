import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  CheckCheck,
  ChevronRight,
  ShieldCheck,
  UserRoundPlus,
  Users,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { departments, templateMap } from '@/config/templates'
import { useAppData } from '@/context/app-data-context'
import { cn, formatCompactNumber } from '@/lib/utils'

const serviceLineLabels = {
  inpatient: 'Inpatient',
  outpatient: 'Outpatient',
  procedure: 'Procedures',
} as const

const roleLabels = {
  admin: 'Admin',
  doctor_admin: 'Clinical lead',
  nurse: 'Nurse',
} as const

export function UserManagementPage() {
  const {
    state,
    approveAccessRequest,
    rejectAccessRequest,
    toggleUserActive,
    toggleAssignmentActive,
    assignUserToDepartment,
    currentUser,
  } = useAppData()
  const [selectedUserId, setSelectedUserId] = useState<string>('')
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string>('')

  if (!currentUser) {
    return null
  }

  const nurses = state.profiles
    .filter((profile) => profile.role === 'nurse')
    .sort((left, right) => left.fullName.localeCompare(right.fullName))
  const pendingRequests = state.accessRequests.filter((request) => request.status === 'pending')
  const activeUsers = state.profiles.filter((profile) => profile.active).length
  const activeAssignments = state.assignments.filter((assignment) => assignment.active).length
  const selectedDepartment = departments.find((department) => department.id === selectedDepartmentId)
  const orderedProfiles = [...state.profiles].sort((left, right) => {
    if (left.role !== right.role) {
      if (left.role === 'nurse') {
        return -1
      }
      if (right.role === 'nurse') {
        return 1
      }
    }

    return left.fullName.localeCompare(right.fullName)
  })

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden px-2 py-4 md:px-4">
        <div className="pointer-events-none absolute inset-0">
          <div className="login-grid-drift absolute inset-0 opacity-50" />
          <div className="login-ambient-drift absolute left-[-4%] top-[8%] h-44 w-44 rounded-full bg-white/56 blur-3xl md:h-56 md:w-56" />
          <div className="login-ambient-drift-reverse absolute right-[6%] top-[8%] h-64 w-64 rounded-full bg-sky-200/32 blur-3xl" />
          <div className="login-ambient-drift absolute bottom-[8%] left-[18%] h-56 w-56 rounded-full bg-teal-200/18 blur-3xl" />
          <div className="login-ring-orbit absolute right-[12%] top-[18%] h-24 w-24 rounded-full border border-sky-200/40" />
          <div className="login-line-flow absolute bottom-[18%] right-[10%] h-px w-32 bg-gradient-to-r from-transparent via-sky-300/65 to-transparent" />
        </div>

        <div className="relative grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-end">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-[760px] space-y-4"
          >
            <div className="inline-flex items-center gap-2 rounded-full bg-white/72 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-sky-700 shadow-[0_14px_30px_-24px_rgba(14,165,233,0.55)] backdrop-blur-sm">
              <span className="h-2 w-2 rounded-full bg-sky-500" />
              Users & access
            </div>

            <div className="space-y-0">
              <h1 className="font-display max-w-[8ch] text-5xl font-semibold leading-[0.9] tracking-tight text-slate-950 md:text-[5.6rem] xl:text-[6.2rem]">
                People and permissions
              </h1>
              <p className="pt-5 text-sm font-semibold uppercase tracking-[0.24em] text-slate-500 md:pt-6 md:text-[0.8rem]">
                Pending requests / live roster / assignment control
              </p>
            </div>

            <div className="flex flex-wrap gap-2.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              <span className="login-chip-float rounded-full border border-white/70 bg-white/55 px-3 py-2 backdrop-blur-sm">
                {pendingRequests.length ? `${pendingRequests.length} pending` : 'Queue clear'}
              </span>
              <span
                className="login-chip-float rounded-full border border-white/70 bg-white/55 px-3 py-2 backdrop-blur-sm"
                style={{ animationDelay: '700ms' }}
              >
                {formatCompactNumber(activeAssignments)} live assignments
              </span>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 }}
            className="grid gap-4 rounded-[2rem] border border-white/65 bg-white/44 p-5 shadow-[0_24px_55px_-34px_rgba(15,23,42,0.2)] backdrop-blur-md xl:justify-self-end"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1 border-b border-white/70 pb-4 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Pending
                </p>
                <p className="mt-2 font-display text-4xl leading-none text-slate-950">
                  {pendingRequests.length}
                </p>
              </div>
              <div className="space-y-1 border-b border-white/70 pb-4 sm:border-b-0 sm:pb-0 sm:pl-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Nurses
                </p>
                <p className="mt-2 font-display text-4xl leading-none text-slate-950">
                  {nurses.length}
                </p>
              </div>
            </div>

            <div className="grid gap-4 border-t border-white/70 pt-4 sm:grid-cols-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Active users
                </p>
                <p className="mt-2 text-lg font-semibold text-slate-950">
                  {formatCompactNumber(activeUsers)}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Assignments
                </p>
                <p className="mt-2 text-lg font-semibold text-slate-950">
                  {formatCompactNumber(activeAssignments)}
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="relative overflow-hidden rounded-[2.4rem] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(242,248,255,0.84))] px-5 py-6 shadow-[0_24px_54px_-36px_rgba(15,23,42,0.22)]"
        >
          <div className="pointer-events-none absolute inset-0">
            <div className="login-grid-drift absolute inset-0 opacity-12" />
            <div className="login-ambient-drift absolute right-[-4%] top-[-12%] h-44 w-44 rounded-full bg-sky-200/12 blur-3xl" />
            <div className="login-line-flow absolute inset-x-6 top-0 h-1 bg-gradient-to-r from-cyan-400 via-sky-500 to-emerald-400" />
          </div>

          <div className="relative space-y-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">
                  Pending
                </p>
                <h2 className="font-display text-3xl text-slate-950">Access requests</h2>
                <p className="text-sm text-slate-500">
                  Review and approve.
                </p>
              </div>
              <div className="rounded-full border border-white/80 bg-white/72 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600 shadow-[0_14px_24px_-20px_rgba(15,23,42,0.15)]">
                {pendingRequests.length} in queue
              </div>
            </div>

            {pendingRequests.length ? (
              <div className="space-y-3">
                {pendingRequests.map((request, index) => (
                  <motion.div
                    key={request.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.24, ease: 'easeOut', delay: index * 0.03 }}
                    className="rounded-[1.7rem] border border-slate-200/80 bg-white/82 p-5 shadow-[0_16px_30px_-24px_rgba(15,23,42,0.18)]"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 space-y-3">
                        <div className="space-y-1">
                          <p className="text-base font-semibold text-slate-950">{request.userName}</p>
                          <p className="text-sm text-slate-500">{request.email}</p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {request.requestedAssignments.map((assignment) => {
                            const department = departments.find(
                              (entry) => entry.id === assignment.departmentId,
                            )

                            if (!department) {
                              return null
                            }

                            return (
                              <span
                                key={`${request.id}-${assignment.departmentId}`}
                                className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-slate-50/90 px-3 py-1.5 text-xs font-semibold text-slate-700"
                              >
                                <span className="h-2 w-2 rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400" />
                                {department.name}
                                <span className="text-slate-400">/</span>
                                {serviceLineLabels[department.family]}
                              </span>
                            )
                          })}
                        </div>

                        {request.notes ? (
                          <p className="text-sm leading-6 text-slate-600">{request.notes}</p>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap gap-3">
                        <Button
                          variant="secondary"
                          onClick={() => void approveAccessRequest(request.id, currentUser.id)}
                        >
                          <CheckCheck className="h-4 w-4" />
                          Approve
                        </Button>
                        <Button
                          variant="destructive"
                          onClick={() => void rejectAccessRequest(request.id, currentUser.id)}
                        >
                          Reject
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-[1.9rem] border border-dashed border-sky-100/90 bg-white/62 px-6 text-center text-slate-500">
                <ShieldCheck className="h-5 w-5 text-sky-500" />
                <p className="text-sm leading-6">No pending requests.</p>
              </div>
            )}
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="relative overflow-hidden rounded-[2.4rem] border border-white/10 bg-[linear-gradient(160deg,#07152d_0%,#0b3156_42%,#0f4c81_72%,#0f766e_100%)] px-5 py-6 text-white shadow-[0_30px_58px_-32px_rgba(8,47,73,0.76)]"
        >
          <div className="pointer-events-none absolute inset-0">
            <div className="login-grid-drift absolute inset-0 opacity-18" />
            <div className="login-ambient-drift absolute right-[-8%] top-[-10%] h-52 w-52 rounded-full bg-cyan-300/12 blur-3xl" />
            <div className="login-line-flow absolute inset-x-6 top-0 h-1 bg-gradient-to-r from-cyan-300 via-sky-400 to-emerald-300" />
          </div>

          <div className="relative space-y-5">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-100">
                Assignment
              </p>
              <h2 className="font-display text-3xl text-white">Assignment studio</h2>
              <p className="text-sm text-cyan-50/72">Add access directly.</p>
            </div>

            <div className="space-y-4">
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger className="border-white/12 bg-white/8 text-white shadow-none placeholder:text-cyan-50/50">
                  <SelectValue placeholder="Choose nurse" />
                </SelectTrigger>
                <SelectContent>
                  {nurses.map((nurse) => (
                    <SelectItem key={nurse.id} value={nurse.id}>
                      {nurse.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={selectedDepartmentId} onValueChange={setSelectedDepartmentId}>
                <SelectTrigger className="border-white/12 bg-white/8 text-white shadow-none placeholder:text-cyan-50/50">
                  <SelectValue placeholder="Choose department" />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((department) => (
                    <SelectItem key={department.id} value={department.id}>
                      {department.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-[1.7rem] border border-white/12 bg-white/8 p-4 backdrop-blur-sm">
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100/72">
                  Preview
                </p>
                {selectedDepartment ? (
                  <div className="space-y-2">
                    <p className="text-base font-semibold text-white">{selectedDepartment.name}</p>
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-full border border-white/12 bg-white/10 px-3 py-1.5 text-xs font-semibold text-cyan-50">
                        {serviceLineLabels[selectedDepartment.family]}
                      </span>
                      <span className="rounded-full border border-white/12 bg-white/10 px-3 py-1.5 text-xs font-semibold text-cyan-50">
                        {templateMap[selectedDepartment.templateId].name}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-cyan-50/72">Choose a department.</p>
                )}
              </div>
            </div>

            <Button
              className="w-full sm:w-auto"
              onClick={() => {
                if (!selectedUserId || !selectedDepartmentId) {
                  return
                }

                const department = departments.find((entry) => entry.id === selectedDepartmentId)
                if (!department) {
                  return
                }

                void assignUserToDepartment(
                  selectedUserId,
                  selectedDepartmentId,
                  department.templateId,
                )
              }}
              disabled={!selectedUserId || !selectedDepartmentId}
            >
              <UserRoundPlus className="h-4 w-4" />
              Add assignment
            </Button>
          </div>
        </motion.section>
      </section>

      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="relative overflow-hidden rounded-[2.4rem] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(242,248,255,0.84))] px-5 py-6 shadow-[0_24px_54px_-36px_rgba(15,23,42,0.22)]"
      >
        <div className="pointer-events-none absolute inset-0">
          <div className="login-grid-drift absolute inset-0 opacity-12" />
          <div className="login-ambient-drift absolute right-[-4%] top-[-12%] h-44 w-44 rounded-full bg-sky-200/12 blur-3xl" />
          <div className="login-line-flow absolute inset-x-6 top-0 h-1 bg-gradient-to-r from-cyan-400 via-sky-500 to-emerald-400" />
        </div>

        <div className="relative space-y-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">
                Directory
              </p>
              <h2 className="font-display text-3xl text-slate-950">Active roster</h2>
              <p className="text-sm text-slate-500">Users and assignments.</p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/72 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600 shadow-[0_14px_24px_-20px_rgba(15,23,42,0.15)]">
              <Users className="h-4 w-4 text-sky-700" />
              {orderedProfiles.length} users
            </div>
          </div>

          <div className="space-y-3">
            {orderedProfiles.map((profile, index) => {
              const assignments = state.assignments.filter((assignment) => assignment.nurseId === profile.id)

              return (
                <motion.div
                  key={profile.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.24, ease: 'easeOut', delay: index * 0.015 }}
                  className="rounded-[1.7rem] border border-slate-200/80 bg-white/82 p-5 shadow-[0_16px_30px_-24px_rgba(15,23,42,0.18)]"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 space-y-3">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-base font-semibold text-slate-950">{profile.fullName}</p>
                          <Badge variant={profile.role === 'nurse' ? 'info' : 'success'}>
                            {roleLabels[profile.role]}
                          </Badge>
                          <span
                            className={cn(
                              'rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]',
                              profile.active
                                ? 'bg-emerald-50 text-emerald-800'
                                : 'bg-rose-50 text-rose-800',
                            )}
                          >
                            {profile.active ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        <p className="text-sm text-slate-500">{profile.email}</p>
                      </div>

                      {assignments.length ? (
                        <div className="flex flex-wrap gap-2">
                          {assignments.map((assignment) => {
                            const department = departments.find((entry) => entry.id === assignment.departmentId)
                            if (!department) {
                              return null
                            }

                            return (
                              <label
                                key={assignment.id}
                                className="inline-flex items-center gap-3 rounded-full border border-slate-200/80 bg-slate-50/90 px-3 py-2 text-xs font-semibold text-slate-700 shadow-[0_14px_24px_-22px_rgba(15,23,42,0.12)]"
                              >
                                <Checkbox
                                  checked={assignment.active}
                                  onCheckedChange={() => void toggleAssignmentActive(assignment.id)}
                                />
                                <span>{department.name}</span>
                                <span className="text-slate-400">/</span>
                                <span className="text-slate-500">
                                  {serviceLineLabels[department.family]}
                                </span>
                                <span className="text-slate-400">/</span>
                                <span className="text-slate-500">
                                  {templateMap[assignment.templateId].name}
                                </span>
                              </label>
                            )
                          })}
                        </div>
                      ) : (
                        <div className="rounded-[1.2rem] border border-dashed border-slate-200/90 bg-slate-50/80 px-4 py-3 text-sm text-slate-500">
                          No assignments.
                        </div>
                      )}
                    </div>

                    <Button
                      variant="secondary"
                      onClick={() => void toggleUserActive(profile.id)}
                    >
                      {profile.active ? 'Deactivate' : 'Activate'}
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </motion.div>
              )
            })}
          </div>
        </div>
      </motion.section>
    </div>
  )
}
