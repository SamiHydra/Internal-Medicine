import { useEffect, useState } from 'react'
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
  superadmin: 'Superadmin',
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
    ensureProfileDirectoryData,
    ensureAccessRequestData,
  } = useAppData()
  const [selectedUserId, setSelectedUserId] = useState<string>('')
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string>('')

  useEffect(() => {
    if (!currentUser) {
      return
    }

    void ensureProfileDirectoryData()
    void ensureAccessRequestData()
  }, [currentUser, ensureAccessRequestData, ensureProfileDirectoryData])

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
  const summaryItems = [
    {
      label: 'Pending requests',
      value: formatCompactNumber(pendingRequests.length),
      note: pendingRequests.length ? 'Requests awaiting review' : 'Queue clear',
      icon: ShieldCheck,
      tone: 'text-[#005db6] bg-[#edf4fb] outline-[#cfe0f4]/75',
    },
    {
      label: 'Nurses',
      value: formatCompactNumber(nurses.length),
      note: 'Assignable reporting users',
      icon: UserRoundPlus,
      tone: 'text-[#00468c] bg-[#edf4fb] outline-[#cfe0f4]/75',
    },
    {
      label: 'Active users',
      value: formatCompactNumber(activeUsers),
      note: 'Profiles with sign-in access',
      icon: Users,
      tone: 'text-[#1d3047] bg-[#edf1f5] outline-[#d4dde8]/75',
    },
    {
      label: 'Assignments',
      value: formatCompactNumber(activeAssignments),
      note: 'Live department coverage',
      icon: CheckCheck,
      tone: 'text-[#8a5a00] bg-[#fcf5e8] outline-[#edd9b0]/75',
    },
  ] as const

  return (
    <div className="space-y-8">
      <section className="rounded-[0.35rem] bg-[#eef2f6] px-5 py-5 md:px-6">
        <div className="space-y-5">
          <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#005db6]">
                Users & access
              </p>
              <h1 className="font-display text-[2rem] leading-[0.96] tracking-[-0.03em] text-[#000a1e] md:text-[2.35rem]">
                People and permissions
              </h1>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {summaryItems.map((item) => {
              const Icon = item.icon

              return (
                <div
                  key={item.label}
                  className={`rounded-[0.35rem] px-3.5 py-3 outline outline-1 ${item.tone}`}
                >
                  <div className="flex items-center gap-2">
                    <Icon className="h-3.5 w-3.5" />
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                      {item.label}
                    </p>
                  </div>
                  <p className="mt-3 font-display text-[1.45rem] leading-none tracking-[-0.03em]">
                    {item.value}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-current/75">{item.note}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="rounded-[0.35rem] bg-[#eef2f6] px-5 py-5"
        >
            <div className="space-y-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#005db6]">
                    Pending
                  </p>
                <h2 className="font-display text-[1.85rem] text-[#000a1e]">Access requests</h2>
                <p className="text-sm text-[#44474e]">
                  Review and approve.
                </p>
              </div>
              <div className="rounded-[0.25rem] border border-[#d4dde8] bg-[#ffffff] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#44474e]">
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
                    className="rounded-[0.35rem] bg-[#ffffff] p-5 outline outline-1 outline-[#d4dde8]/65"
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
                                className="inline-flex items-center gap-2 rounded-[0.25rem] border border-[#d4dde8] bg-[#f3f4f5] px-3 py-1.5 text-xs font-semibold text-[#44474e]"
                              >
                                <span className="h-2 w-2 rounded-[999px] bg-[#005db6]" />
                                {department.name}
                                <span className="text-slate-400">/</span>
                                {serviceLineLabels[department.family]}
                              </span>
                            )
                          })}
                        </div>

                        {request.notes ? (
                          <p className="text-sm leading-6 text-[#44474e]">{request.notes}</p>
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
              <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-[0.5rem] border border-dashed border-[#d4dde8] bg-[#ffffff] px-6 text-center text-[#74777f]">
                <ShieldCheck className="h-5 w-5 text-[#005db6]" />
                <p className="text-sm leading-6">No pending requests.</p>
              </div>
            )}
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="rounded-[0.35rem] bg-[#eef2f6] px-5 py-5"
        >
          <div className="space-y-5">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#005db6]">
                Assignment
              </p>
              <h2 className="font-display text-[1.85rem] text-[#000a1e]">Assignment studio</h2>
              <p className="text-sm text-[#44474e]">Add access directly.</p>
            </div>

            <div className="space-y-4">
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger className="shadow-none">
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
                <SelectTrigger className="shadow-none">
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

            <div className="rounded-[0.35rem] bg-[#f8fafc] p-4 outline outline-1 outline-[#d9e0e7]/75">
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#005db6]">
                  Preview
                </p>
                {selectedDepartment ? (
                  <div className="space-y-2">
                    <p className="text-base font-semibold text-[#000a1e]">{selectedDepartment.name}</p>
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-[0.25rem] border border-[#d4dde8] bg-[#ffffff] px-3 py-1.5 text-xs font-semibold text-[#44474e]">
                        {serviceLineLabels[selectedDepartment.family]}
                      </span>
                      <span className="rounded-[0.25rem] border border-[#d4dde8] bg-[#ffffff] px-3 py-1.5 text-xs font-semibold text-[#44474e]">
                        {templateMap[selectedDepartment.templateId].name}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-[#44474e]">Choose a department.</p>
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
        className="rounded-[0.35rem] bg-[#eef2f6] px-5 py-6"
      >
        <div className="space-y-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#005db6]">
                Directory
              </p>
              <h2 className="font-display text-[1.85rem] text-[#000a1e]">Active roster</h2>
              <p className="text-sm text-[#44474e]">Users and assignments.</p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-[0.25rem] border border-[#d4dde8] bg-[#ffffff] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#44474e]">
              <Users className="h-4 w-4 text-[#005db6]" />
              {orderedProfiles.length} users
            </div>
          </div>

          <div className="space-y-3">
            {orderedProfiles.map((profile, index) => {
              const assignments = state.assignments.filter((assignment) => assignment.nurseId === profile.id)
              const isProtectedAdmin = profile.role !== 'nurse' && currentUser.role !== 'superadmin'
              const isSuperadminProfile = profile.role === 'superadmin'
              const canToggleProfileState = !isProtectedAdmin && !isSuperadminProfile

              return (
                <motion.div
                  key={profile.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.24, ease: 'easeOut', delay: index * 0.015 }}
                  className="rounded-[0.35rem] border border-[#d4dde8] bg-[#ffffff] p-5"
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
                              'rounded-[0.25rem] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]',
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
                                className="inline-flex items-center gap-3 rounded-[0.25rem] border border-[#d4dde8] bg-[#f3f4f5] px-3 py-2 text-xs font-semibold text-[#44474e] shadow-[0_14px_24px_-22px_rgba(15,23,42,0.08)]"
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
                        <div className="rounded-[0.35rem] border border-dashed border-[#d4dde8] bg-[#f8fafc] px-4 py-3 text-sm text-slate-500">
                          No assignments.
                        </div>
                      )}
                    </div>

                    <Button
                      variant="secondary"
                      disabled={!canToggleProfileState}
                      onClick={() => void toggleUserActive(profile.id)}
                    >
                      {!canToggleProfileState
                        ? isSuperadminProfile
                          ? 'Protected'
                          : 'Superadmin only'
                        : profile.active
                          ? 'Deactivate'
                          : 'Activate'}
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
