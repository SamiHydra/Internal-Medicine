import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  CheckCheck,
  ChevronDown,
  Search,
  ShieldCheck,
  UserRoundPlus,
  Users,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { departments, templateMap } from '@/config/templates'
import { useAppData } from '@/context/app-data-context'
import { useWorkspace } from '@/context/workspace-context'
import { cn } from '@/lib/utils'
import type { UserRole } from '@/types/domain'

const serviceLineLabels = {
  inpatient: 'Inpatient',
  outpatient: 'Outpatient',
  procedure: 'Procedures',
} as const

const roleLabels = {
  superadmin: 'Maintenance',
  admin: 'Admin',
  nurse: 'Nurse',
  resident: 'Resident',
  consultant: 'Consultant',
} as const

const sectionClass =
  'rounded-[0.35rem] bg-white px-5 py-6 outline outline-1 outline-[#d4dde8] shadow-[0_24px_60px_-42px_rgba(0,33,71,0.28)] md:px-6 md:py-7'
const countChipClass =
  'inline-flex items-center gap-2 self-start rounded-full bg-[#f4f7fb] px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#44474e] outline outline-1 outline-[#e3e9f1]'

function initialsFor(fullName: string) {
  return (
    fullName
      .split(' ')
      .map((part) => part[0])
      .filter(Boolean)
      .join('')
      .slice(0, 2)
      .toUpperCase() || '—'
  )
}

function SectionEyebrow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden="true" className="h-3 w-[3px] rounded-full bg-[#f0b429]" />
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#005db6]">{label}</p>
    </div>
  )
}

export function UserManagementPage() {
  const {
    state,
    approveAccessRequest,
    rejectAccessRequest,
    toggleUserActive,
    toggleAssignmentActive,
    assignUserToDepartment,
    currentUser,
    ensureUserManagementData,
    adminAccessRequests,
    refreshAdminAccessRequests,
    approveAdminAccessRequest,
    rejectAdminAccessRequest,
  } = useAppData()
  const { workspace } = useWorkspace()
  const [selectedUserId, setSelectedUserId] = useState<string>('')
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string>('')
  const [rosterSearch, setRosterSearch] = useState('')
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(() => new Set())

  const [expandedRequests, setExpandedRequests] = useState<Set<string>>(() => new Set())
  const adminRequestsLoadedRef = useRef(false)

  const toggleFromSet =
    (setter: Dispatch<SetStateAction<Set<string>>>) => (id: string) =>
      setter((prev) => {
        const next = new Set(prev)
        if (next.has(id)) {
          next.delete(id)
        } else {
          next.add(id)
        }
        return next
      })

  const toggleExpandedUser = toggleFromSet(setExpandedUsers)
  const toggleExpandedRequest = toggleFromSet(setExpandedRequests)

  // Only the maintenance owner and admins approve other admins.
  const canApproveAdmins = currentUser?.role === 'superadmin' || currentUser?.role === 'admin'

  useEffect(() => {
    if (!currentUser) {
      return
    }

    void ensureUserManagementData()
    if (canApproveAdmins && !adminRequestsLoadedRef.current) {
      adminRequestsLoadedRef.current = true
      void refreshAdminAccessRequests()
    }
  }, [
    currentUser,
    canApproveAdmins,
    ensureUserManagementData,
    refreshAdminAccessRequests,
  ])

  if (!currentUser) {
    return null
  }

  const pendingAdminRequests = adminAccessRequests.filter((request) => request.status === 'pending')

  const nurses = state.profiles
    .filter((profile) => profile.role === 'nurse')
    .sort((left, right) => left.fullName.localeCompare(right.fullName))
  const pendingRequests = state.accessRequests.filter((request) => request.status === 'pending')
  const selectedDepartment = departments.find((department) => department.id === selectedDepartmentId)
  // Users & Access scopes to the active workspace: management roles always, plus
  // the workspace's domain role (clinical → nurse, academic → resident/consultant).
  const visibleRoles = new Set<UserRole>(
    workspace === 'clinical'
      ? ['admin', 'superadmin', 'nurse']
      : ['admin', 'superadmin', 'resident', 'consultant'],
  )
  const orderedProfiles = state.profiles
    .filter((profile) => visibleRoles.has(profile.role))
    .sort((left, right) => {
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
  const rosterQuery = rosterSearch.trim().toLowerCase()
  const filteredProfiles = rosterQuery
    ? orderedProfiles.filter(
        (profile) =>
          profile.fullName.toLowerCase().includes(rosterQuery) ||
          profile.email.toLowerCase().includes(rosterQuery),
      )
    : orderedProfiles

  return (
    <div className="space-y-6 px-4 py-5 md:px-6 md:py-8">
      <section className={cn('grid gap-6', workspace === 'clinical' && canApproveAdmins && 'lg:grid-cols-2')}>
        {workspace === 'clinical' ? (
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className={sectionClass}
        >
          <div className="space-y-5">
            <div className="flex flex-col gap-4 border-b border-[#eef2f6] pb-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <SectionEyebrow label="Pending" />
                <h2 className="mt-1 font-display text-[1.4rem] font-bold tracking-[-0.02em] text-[#000a1e] md:text-[1.6rem]">
                  Access requests
                </h2>
                <p className="mt-1 text-sm text-[#74777f]">Review and approve nurse reporting access.</p>
              </div>
              <span className={countChipClass}>{pendingRequests.length} in queue</span>
            </div>

            {pendingRequests.length ? (
              <div className="overflow-hidden rounded-[0.4rem] border border-[#cfe0f4]">
                {pendingRequests.map((request) => {
                  const expanded = expandedRequests.has(request.id)
                  const requestedDepartments = request.requestedAssignments
                    .map((assignment) => departments.find((entry) => entry.id === assignment.departmentId))
                    .filter((department): department is (typeof departments)[number] => Boolean(department))

                  return (
                    <div key={request.id} className="border-b border-[#dbe8f6] bg-[#f6fbff] last:border-b-0">
                      <div
                        onClick={() => toggleExpandedRequest(request.id)}
                        className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-2.5 transition-colors duration-200 hover:bg-[#eef6ff]"
                      >
                        <button
                          type="button"
                          aria-expanded={expanded}
                          aria-label={`${expanded ? 'Hide' : 'Show'} request details`}
                          onClick={(event) => {
                            event.stopPropagation()
                            toggleExpandedRequest(request.id)
                          }}
                          className="shrink-0 rounded-[0.25rem] p-0.5 text-[#9aa7b8] outline-none transition-colors hover:text-[#005db6] focus-visible:text-[#005db6]"
                        >
                          <ChevronDown
                            className={cn(
                              'h-4 w-4 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]',
                              expanded && 'rotate-180',
                            )}
                          />
                        </button>
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#edf4fb] text-[11px] font-bold text-[#005db6]">
                          {initialsFor(request.userName)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-[#000a1e]">
                            {request.userName}
                          </span>
                          <span className="block truncate text-xs text-[#74777f]">{request.email}</span>
                        </span>
                        <span className="hidden shrink-0 text-xs text-[#74777f] sm:block">
                          {requestedDepartments.length}{' '}
                          {requestedDepartments.length === 1 ? 'dept' : 'depts'}
                        </span>
                        <div className="flex w-full shrink-0 items-center gap-2 [&>button]:flex-1 sm:w-auto sm:[&>button]:flex-none">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={(event) => {
                              event.stopPropagation()
                              void approveAccessRequest(request.id, currentUser.id)
                            }}
                          >
                            <CheckCheck className="h-4 w-4" />
                            Approve
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={(event) => {
                              event.stopPropagation()
                              void rejectAccessRequest(request.id, currentUser.id)
                            }}
                          >
                            Reject
                          </Button>
                        </div>
                      </div>

                      {expanded ? (
                        <div className="space-y-3 border-t border-[#dbe8f6] px-4 py-3.5">
                          <div className="flex flex-wrap gap-2">
                            {requestedDepartments.length ? (
                              requestedDepartments.map((department) => (
                                <span
                                  key={`${request.id}-${department.id}`}
                                  className="inline-flex items-center gap-2 rounded-full border border-[#e6ecf3] bg-white px-3 py-1.5 text-xs font-semibold text-[#44474e]"
                                >
                                  <span className="h-1.5 w-1.5 rounded-full bg-[#005db6]" />
                                  {department.name}
                                  <span className="text-[#9aa7b8]">/</span>
                                  {serviceLineLabels[department.family]}
                                </span>
                              ))
                            ) : (
                              <span className="text-sm text-[#74777f]">No departments requested.</span>
                            )}
                          </div>
                          {request.notes ? (
                            <p className="text-sm leading-6 text-[#44474e]">{request.notes}</p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-[0.4rem] border border-dashed border-[#d4dde8] bg-[#f7f9fc] px-6 text-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-[0.4rem] bg-[#edf4fb] text-[#005db6]">
                  <ShieldCheck className="h-5 w-5" />
                </span>
                <p className="text-sm leading-6 text-[#5b6169]">No pending requests.</p>
              </div>
            )}
          </div>
        </motion.section>
        ) : null}

        {canApproveAdmins ? (
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className={sectionClass}
          >
            <div className="space-y-5">
              <div className="flex flex-col gap-4 border-b border-[#eef2f6] pb-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <SectionEyebrow label="Pending" />
                  <h2 className="mt-1 font-display text-[1.4rem] font-bold tracking-[-0.02em] text-[#000a1e] md:text-[1.6rem]">
                    Admin access requests
                  </h2>
                  <p className="mt-1 text-sm text-[#74777f]">
                    Approve to create the admin account, or reject.
                  </p>
                </div>
                <span className={countChipClass}>{pendingAdminRequests.length} in queue</span>
              </div>

              {pendingAdminRequests.length ? (
                <div className="overflow-hidden rounded-[0.4rem] border border-[#cfe0f4]">
                  {pendingAdminRequests.map((request) => {
                    const expanded = expandedRequests.has(request.id)

                    return (
                      <div key={request.id} className="border-b border-[#dbe8f6] bg-[#f6fbff] last:border-b-0">
                        <div
                          onClick={() => toggleExpandedRequest(request.id)}
                          className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-2.5 transition-colors duration-200 hover:bg-[#eef6ff]"
                        >
                          <button
                            type="button"
                            aria-expanded={expanded}
                            aria-label={`${expanded ? 'Hide' : 'Show'} request details`}
                            onClick={(event) => {
                              event.stopPropagation()
                              toggleExpandedRequest(request.id)
                            }}
                            className="shrink-0 rounded-[0.25rem] p-0.5 text-[#9aa7b8] outline-none transition-colors hover:text-[#005db6] focus-visible:text-[#005db6]"
                          >
                            <ChevronDown
                              className={cn(
                                'h-4 w-4 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]',
                                expanded && 'rotate-180',
                              )}
                            />
                          </button>
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#edf4fb] text-[11px] font-bold text-[#005db6]">
                            {initialsFor(request.fullName)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-[#000a1e]">
                              {request.fullName}
                            </span>
                            <span className="block truncate text-xs text-[#74777f]">{request.email}</span>
                          </span>
                          <span className="hidden shrink-0 rounded-full border border-[#cfe0f4] bg-white px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#005db6] sm:block">
                            Admin
                          </span>
                          <div className="flex w-full shrink-0 items-center gap-2 [&>button]:flex-1 sm:w-auto sm:[&>button]:flex-none">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={(event) => {
                                event.stopPropagation()
                                void approveAdminAccessRequest(request.id)
                              }}
                            >
                              <CheckCheck className="h-4 w-4" />
                              Approve
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={(event) => {
                                event.stopPropagation()
                                void rejectAdminAccessRequest(request.id)
                              }}
                            >
                              Reject
                            </Button>
                          </div>
                        </div>

                        {expanded ? (
                          <div className="border-t border-[#dbe8f6] px-4 py-3.5">
                            <p className="text-sm leading-6 text-[#44474e]">
                              {request.notes ? request.notes : 'No notes provided with this request.'}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="flex min-h-[160px] flex-col items-center justify-center gap-3 rounded-[0.4rem] border border-dashed border-[#d4dde8] bg-[#f7f9fc] px-6 text-center">
                  <span className="flex h-11 w-11 items-center justify-center rounded-[0.4rem] bg-[#edf4fb] text-[#005db6]">
                    <ShieldCheck className="h-5 w-5" />
                  </span>
                  <p className="text-sm leading-6 text-[#5b6169]">No admin requests awaiting approval.</p>
                </div>
              )}
            </div>
          </motion.section>
        ) : null}

      </section>

      {workspace === 'clinical' ? (
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className={sectionClass}
      >
        <div className="space-y-5">
          <div className="border-b border-[#eef2f6] pb-5">
            <SectionEyebrow label="Assignment" />
            <h2 className="mt-1 font-display text-[1.4rem] font-bold tracking-[-0.02em] text-[#000a1e] md:text-[1.6rem]">
              Assignment studio
            </h2>
            <p className="mt-1 text-sm text-[#74777f]">Grant a nurse direct department access.</p>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#74777f]">
                Nurse
              </p>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger className="shadow-none" aria-label="Nurse">
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
            </div>

            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#74777f]">
                Department
              </p>
              <Select value={selectedDepartmentId} onValueChange={setSelectedDepartmentId}>
                <SelectTrigger className="shadow-none" aria-label="Department">
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

            <Button
              className="h-11 w-full lg:w-auto"
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

          {selectedDepartment ? (
            <div className="flex flex-wrap items-center gap-2.5 rounded-[0.4rem] bg-[#f7f9fc] px-4 py-3 outline outline-1 outline-[#e6ecf3]">
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#005db6]">
                Preview
              </span>
              <span className="text-sm font-semibold text-[#000a1e]">{selectedDepartment.name}</span>
              <span className="rounded-full border border-[#e6ecf3] bg-white px-3 py-1 text-xs font-semibold text-[#44474e]">
                {serviceLineLabels[selectedDepartment.family]}
              </span>
              <span className="rounded-full border border-[#e6ecf3] bg-white px-3 py-1 text-xs font-semibold text-[#44474e]">
                {templateMap[selectedDepartment.templateId].name}
              </span>
            </div>
          ) : null}
        </div>
      </motion.section>
      ) : null}

      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className={sectionClass}
      >
        <div className="space-y-5">
          <div className="flex flex-col gap-4 border-b border-[#eef2f6] pb-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <SectionEyebrow label="Directory" />
              <h2 className="mt-1 font-display text-[1.4rem] font-bold tracking-[-0.02em] text-[#000a1e] md:text-[1.6rem]">
                Active roster
              </h2>
              <p className="mt-1 text-sm text-[#74777f]">
                {workspace === 'clinical'
                  ? 'Users and their department assignments.'
                  : 'Residents, consultants, and administrators.'}
              </p>
            </div>
            <div className="flex w-full items-center gap-3 sm:w-auto">
              <div className="relative w-full sm:w-64">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9aa7b8]" />
                <Input
                  value={rosterSearch}
                  onChange={(event) => setRosterSearch(event.target.value)}
                  placeholder="Search name or email"
                  className="h-10 pl-9 text-sm"
                />
              </div>
              <span className={cn(countChipClass, 'whitespace-nowrap')}>
                <Users className="h-3.5 w-3.5 text-[#005db6]" />
                {filteredProfiles.length}
              </span>
            </div>
          </div>

          {filteredProfiles.length ? (
            <div className="overflow-hidden rounded-[0.4rem] border border-[#e6ecf3]">
              <div className="hidden items-center gap-3 border-b border-[#eef2f6] bg-[#f7f9fc] px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#74777f] lg:flex">
                <span className="w-4 shrink-0" />
                <span className="w-9 shrink-0" />
                <span className="min-w-0 flex-[2_1_0%]">Member</span>
                <span className="min-w-[7rem] flex-1">Role</span>
                <span className="min-w-[5rem] flex-1">Status</span>
                <span className="min-w-[6rem] flex-1">Departments</span>
                <span className="w-[112px] shrink-0 text-right">Action</span>
              </div>

              {filteredProfiles.map((profile) => {
                const assignments = state.assignments.filter(
                  (assignment) => assignment.nurseId === profile.id,
                )
                const isProtectedAdmin = profile.role !== 'nurse' && currentUser.role !== 'superadmin'
                const isSuperadminProfile = profile.role === 'superadmin'
                const canToggleProfileState = !isProtectedAdmin && !isSuperadminProfile
                const expanded = expandedUsers.has(profile.id)
                const activeAssignmentCount = assignments.filter((assignment) => assignment.active).length

                return (
                  <div key={profile.id} className="border-b border-[#eef2f6] last:border-b-0">
                    <div
                      onClick={() => toggleExpandedUser(profile.id)}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors duration-200 hover:bg-[#f7f9fc]',
                        !profile.active && 'opacity-70',
                      )}
                    >
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-label={`${expanded ? 'Hide' : 'Show'} ${profile.fullName} assignments`}
                        onClick={(event) => {
                          event.stopPropagation()
                          toggleExpandedUser(profile.id)
                        }}
                        className="shrink-0 rounded-[0.25rem] p-0.5 text-[#9aa7b8] outline-none transition-colors hover:text-[#005db6] focus-visible:text-[#005db6]"
                      >
                        <ChevronDown
                          className={cn(
                            'h-4 w-4 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]',
                            expanded && 'rotate-180',
                          )}
                        />
                      </button>
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#04162f] text-[11px] font-bold text-[#f0b429]">
                        {initialsFor(profile.fullName)}
                      </span>
                      <span className="min-w-0 flex-[2_1_0%]">
                        <span className="block truncate text-sm font-semibold text-[#000a1e]">
                          {profile.fullName}
                        </span>
                        <span className="block truncate text-xs text-[#74777f]">{profile.email}</span>
                      </span>
                      <span className="hidden min-w-[7rem] flex-1 lg:block">
                        <Badge variant={profile.role === 'nurse' ? 'info' : 'success'}>
                          {roleLabels[profile.role]}
                        </Badge>
                      </span>
                      <span className="hidden min-w-[5rem] flex-1 lg:block">
                        <span
                          className={cn(
                            'rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em]',
                            profile.active ? 'bg-[#edf7f0] text-[#1f6b3b]' : 'bg-[#fceeee] text-[#ba1a1a]',
                          )}
                        >
                          {profile.active ? 'Active' : 'Inactive'}
                        </span>
                      </span>
                      <span className="hidden min-w-[6rem] flex-1 text-xs text-[#74777f] lg:block">
                        {assignments.length ? `${activeAssignmentCount}/${assignments.length} active` : 'No depts'}
                      </span>
                      <div className="shrink-0 lg:w-[112px] lg:text-right">
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={!canToggleProfileState}
                          onClick={(event) => {
                            event.stopPropagation()
                            void toggleUserActive(profile.id)
                          }}
                        >
                          {!canToggleProfileState
                            ? isSuperadminProfile
                              ? 'Protected'
                              : 'Locked'
                            : profile.active
                              ? 'Deactivate'
                              : 'Activate'}
                        </Button>
                      </div>
                    </div>

                    {expanded ? (
                      <div className="border-t border-[#eef2f6] bg-[#f7f9fc] px-4 py-3.5">
                        <div className="mb-3 flex flex-wrap items-center gap-2 lg:hidden">
                          <Badge variant={profile.role === 'nurse' ? 'info' : 'success'}>
                            {roleLabels[profile.role]}
                          </Badge>
                          <span
                            className={cn(
                              'rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em]',
                              profile.active ? 'bg-[#edf7f0] text-[#1f6b3b]' : 'bg-[#fceeee] text-[#ba1a1a]',
                            )}
                          >
                            {profile.active ? 'Active' : 'Inactive'}
                          </span>
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
                                  className="inline-flex cursor-pointer items-center gap-2.5 rounded-full border border-[#e6ecf3] bg-white px-3 py-1.5 text-xs font-semibold text-[#44474e] transition-colors duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-[#bcd0ea]"
                                >
                                  <Checkbox
                                    checked={assignment.active}
                                    onCheckedChange={() => void toggleAssignmentActive(assignment.id)}
                                  />
                                  <span>{department.name}</span>
                                  <span className="text-[#9aa7b8]">/</span>
                                  <span className="text-[#74777f]">{serviceLineLabels[department.family]}</span>
                                  <span className="text-[#9aa7b8]">/</span>
                                  <span className="text-[#74777f]">{templateMap[assignment.templateId].name}</span>
                                </label>
                              )
                            })}
                          </div>
                        ) : (
                          <p className="text-sm text-[#74777f]">No department assignments.</p>
                        )}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="rounded-[0.4rem] border border-dashed border-[#d4dde8] bg-[#f7f9fc] px-6 py-10 text-center text-sm text-[#74777f]">
              No users match “{rosterSearch}”.
            </div>
          )}
        </div>
      </motion.section>
    </div>
  )
}
