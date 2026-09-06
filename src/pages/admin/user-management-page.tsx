import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
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
import { visibleRoleKeysForWorkspace } from '@/lib/role-registry'
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
  student_rep: 'Student rep',
} as const

// Roles an admin can correct an existing account to. Deliberately narrower than
// the server whitelist: `admin` is omitted so this never becomes a one-click
// promotion path around the approval queue. Nurse and student rep are the two
// admin-created roles, so they are the two a wrong pick lands on.
const CORRECTABLE_ROLES = ['nurse', 'student_rep'] as const

type CorrectableRole = (typeof CORRECTABLE_ROLES)[number]

function isCorrectableRole(role: UserRole): role is CorrectableRole {
  return (CORRECTABLE_ROLES as readonly UserRole[]).includes(role)
}

const sectionClass =
  'rounded-[0.35rem] bg-white px-5 py-6 outline outline-1 outline-[#d4dde8] shadow-[0_24px_60px_-42px_rgba(0,33,71,0.28)] md:px-6 md:py-7'
const countChipClass =
  'inline-flex items-center gap-2 self-start rounded-full bg-[#f4f7fb] px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#44474e] outline outline-1 outline-[#e3e9f1]'
const requestQueueClass =
  'overflow-hidden rounded-[0.55rem] border border-[#dce3eb] bg-white shadow-[0_18px_48px_-40px_rgba(0,33,71,0.42)]'
const requestActionClass =
  'h-9 px-3.5 shadow-none pointer-coarse:min-h-11'
const requestRejectClass =
  'h-9 px-3 text-[#a81919] hover:bg-[#fff1f1] hover:text-[#8f1010] pointer-coarse:min-h-11'
const rosterPageSize = 20

type ResidentApprovalDraft = {
  trainingYear: string
  rotationGroup: string
}

function initialsFor(fullName: string) {
  return (
    fullName
      .split(' ')
      .map((part) => part[0])
      .filter(Boolean)
      .join('')
      .slice(0, 2)
      .toUpperCase() || '-'
  )
}

function SectionEyebrow({ label }: { label: string }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#005db6]">{label}</p>
  )
}

export function UserManagementPage() {
  const {
    state,
    approveAccessRequest,
    rejectAccessRequest,
    toggleUserActive,
    changeUserRole,
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
  const [rosterPage, setRosterPage] = useState(1)
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(() => new Set())
  const [roleChangePending, setRoleChangePending] = useState<string | null>(null)
  const deferredDirectoryRef = useRef<HTMLDivElement>(null)
  const [showDirectorySections, setShowDirectorySections] = useState(false)

  const [expandedRequests, setExpandedRequests] = useState<Set<string>>(() => new Set())
  const [residentApprovalDrafts, setResidentApprovalDrafts] = useState<
    Record<string, ResidentApprovalDraft>
  >({})
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

  const residentDraftFor = (request: (typeof adminAccessRequests)[number]) =>
    residentApprovalDrafts[request.id] ?? {
      trainingYear: request.trainingYear ? String(request.trainingYear) : '',
      rotationGroup: request.rotationGroup ?? '',
    }

  const updateResidentDraft = (
    request: (typeof adminAccessRequests)[number],
    updates: Partial<ResidentApprovalDraft>,
  ) => {
    setResidentApprovalDrafts((current) => {
      const existing = current[request.id] ?? {
        trainingYear: request.trainingYear ? String(request.trainingYear) : '',
        rotationGroup: request.rotationGroup ?? '',
      }

      return {
        ...current,
        [request.id]: { ...existing, ...updates },
      }
    })
  }

  // Only the maintenance owner and admins review the self-service account queue.
  const canApproveAdmins = currentUser?.role === 'superadmin' || currentUser?.role === 'admin'

  /**
   * Corrects an account created under the wrong role. The two roles live in
   * different workspaces, so the row leaves the current roster on success -
   * say where it went rather than letting it silently vanish.
   */
  const handleRoleChange = async (
    profile: { id: string; fullName: string; role: UserRole },
    nextRole: CorrectableRole,
  ) => {
    if (profile.role === nextRole) {
      return
    }

    setRoleChangePending(profile.id)
    try {
      const changed = await changeUserRole(profile.id, nextRole)
      if (changed) {
        toast.success(
          nextRole === 'student_rep'
            ? `${profile.fullName} is now a student rep and appears on the Academic roster.`
            : `${profile.fullName} is now a nurse and appears on the Clinical roster.`,
        )
      }
    } finally {
      setRoleChangePending(null)
    }
  }

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

  useEffect(() => {
    if (showDirectorySections || !deferredDirectoryRef.current) {
      return
    }

    let mountTimer: number | null = null
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) {
        return
      }

      observer.disconnect()
      mountTimer = window.setTimeout(() => {
        setShowDirectorySections(true)
      }, 300)
    })
    observer.observe(deferredDirectoryRef.current)

    return () => {
      observer.disconnect()
      if (mountTimer !== null) {
        window.clearTimeout(mountTimer)
      }
    }
  }, [showDirectorySections])

  if (!currentUser) {
    return null
  }

  const nurses = state.profiles
    .filter((profile) => profile.role === 'nurse')
    .sort((left, right) => left.fullName.localeCompare(right.fullName))
  const pendingRequests = state.accessRequests.filter((request) => request.status === 'pending')
  const selectedDepartment = departments.find((department) => department.id === selectedDepartmentId)
  const rolesByKey = new Map(state.roles.map((role) => [role.key, role]))
  const visibleRoles = visibleRoleKeysForWorkspace(state.roles, workspace)
  // The self-service queue carries admin and academic signups alike and is NOT
  // scoped to the active workspace: the approver notification points at the
  // shared /admin/users path, so a scoped queue would silently strand academic
  // enrollments on the clinical page. The per-row role badge carries the split.
  const pendingAccountRequests = adminAccessRequests.filter(
    (request) => request.status === 'pending',
  )
  const orderedProfiles = state.profiles
    .filter((profile) => !visibleRoles.size || visibleRoles.has(profile.role))
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
  const rosterPageCount = Math.max(1, Math.ceil(filteredProfiles.length / rosterPageSize))
  const activeRosterPage = Math.min(rosterPage, rosterPageCount)
  const visibleProfiles = filteredProfiles.slice(
    (activeRosterPage - 1) * rosterPageSize,
    activeRosterPage * rosterPageSize,
  )

  return (
    <div className="space-y-6 px-4 py-5 md:px-6 md:py-8">
      <section
        className={cn(
          'grid items-start gap-6',
          workspace === 'clinical' &&
            canApproveAdmins &&
            'min-[1680px]:grid-cols-2',
        )}
      >
        {workspace === 'clinical' ? (
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className={requestQueueClass}
          >
            <div>
              <div className="flex items-start justify-between gap-4 border-b border-[#e7ecf2] px-5 py-5 md:px-6">
                <div className="min-w-0">
                  <h2 className="font-display text-[1.25rem] font-bold tracking-[-0.02em] text-[#000a1e]">
                    Access requests
                  </h2>
                  <p className="mt-1 text-sm leading-5 text-[#6e7580]">
                    Nurse access to clinical reporting areas.
                  </p>
                </div>
                <span className="inline-flex shrink-0 items-center gap-2 rounded-[0.3rem] bg-[#fff7e5] px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[#8a5a00]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#f0b429]" />
                  {pendingRequests.length} pending
                </span>
              </div>

              {pendingRequests.length ? (
                <div className="divide-y divide-[#e7ecf2]">
                  {pendingRequests.map((request) => {
                    const expanded = expandedRequests.has(request.id)
                    const requestedDepartments = request.requestedAssignments
                      .map((assignment) =>
                        departments.find((entry) => entry.id === assignment.departmentId),
                      )
                      .filter(
                        (department): department is (typeof departments)[number] =>
                          Boolean(department),
                      )

                    return (
                      <div
                        key={request.id}
                        className={cn(
                          'bg-white transition-colors duration-200',
                          expanded && 'bg-[#f8fafc]',
                        )}
                      >
                        <div
                          onClick={() => toggleExpandedRequest(request.id)}
                          className="group relative flex cursor-pointer flex-wrap items-center gap-3 py-3.5 pl-5 pr-14 transition-colors duration-200 hover:bg-[#f8fafc] sm:pr-5 md:px-6"
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.35rem] bg-[#071b35] text-[11px] font-bold tracking-[0.04em] text-[#f0b429]">
                            {initialsFor(request.userName)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-[#000a1e]">
                              {request.userName}
                            </span>
                            <span className="block truncate text-xs text-[#74777f]">
                              {request.email}
                            </span>
                          </span>
                          <span className="hidden shrink-0 text-xs font-medium text-[#6e7580] md:block">
                            {requestedDepartments.length}{' '}
                            {requestedDepartments.length === 1
                              ? 'department'
                              : 'departments'}
                          </span>
                          <div className="flex w-full shrink-0 items-center gap-1.5 [&>button]:flex-1 sm:w-auto sm:[&>button]:flex-none">
                            <Button
                              size="sm"
                              className={requestActionClass}
                              onClick={(event) => {
                                event.stopPropagation()
                                void approveAccessRequest(request.id, currentUser.id)
                              }}
                            >
                              <CheckCheck className="h-4 w-4" />
                              Approve
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className={requestRejectClass}
                              onClick={(event) => {
                                event.stopPropagation()
                                void rejectAccessRequest(request.id, currentUser.id)
                              }}
                            >
                              Reject
                            </Button>
                          </div>
                          <button
                            type="button"
                            aria-expanded={expanded}
                            aria-label={`${expanded ? 'Hide' : 'Show'} request details`}
                            onClick={(event) => {
                              event.stopPropagation()
                              toggleExpandedRequest(request.id)
                            }}
                            className="absolute right-5 top-4 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.3rem] text-[#8b96a5] outline-none transition-colors hover:bg-[#edf3f8] hover:text-[#005db6] focus-visible:ring-2 focus-visible:ring-[#63a1ff]/45 sm:static pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                          >
                            <ChevronDown
                              className={cn(
                                'h-4 w-4 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]',
                                expanded && 'rotate-180',
                              )}
                            />
                          </button>
                        </div>

                        {expanded ? (
                          <div className="space-y-3 border-t border-[#e7ecf2] bg-[#f8fafc] px-5 py-4 md:px-6 md:pl-[4.75rem]">
                            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#6e7580]">
                              Requested coverage
                            </p>
                            <div className="grid gap-x-6 sm:grid-cols-2">
                              {requestedDepartments.length ? (
                                requestedDepartments.map((department) => (
                                  <div
                                    key={`${request.id}-${department.id}`}
                                    className="flex items-center justify-between gap-3 border-b border-[#e3e9f0] py-2 text-sm last:border-b-0"
                                  >
                                    <span className="font-semibold text-[#182235]">
                                      {department.name}
                                    </span>
                                    <span className="text-xs text-[#6e7580]">
                                      {serviceLineLabels[department.family]}
                                    </span>
                                  </div>
                                ))
                              ) : (
                                <span className="text-sm text-[#74777f]">
                                  No departments requested.
                                </span>
                              )}
                            </div>
                            {request.notes ? (
                              <p className="border-l-2 border-[#c9d9ea] pl-3 text-sm leading-6 text-[#44474e]">
                                {request.notes}
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="flex min-h-[144px] flex-col items-center justify-center gap-3 bg-[#fbfcfd] px-6 text-center">
                  <span className="flex h-9 w-9 items-center justify-center rounded-[0.35rem] bg-[#edf4fb] text-[#005db6]">
                    <ShieldCheck className="h-5 w-5" />
                  </span>
                  <p className="text-sm leading-6 text-[#5b6169]">
                    All access requests are reviewed.
                  </p>
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
            className={requestQueueClass}
          >
            <div>
              <div className="flex items-start justify-between gap-4 border-b border-[#e7ecf2] px-5 py-5 md:px-6">
                <div className="min-w-0">
                  <h2 className="font-display text-[1.25rem] font-bold tracking-[-0.02em] text-[#000a1e]">
                    Account requests
                  </h2>
                  <p className="mt-1 text-sm leading-5 text-[#6e7580]">
                    New accounts awaiting role approval.
                  </p>
                </div>
                <span className="inline-flex shrink-0 items-center gap-2 rounded-[0.3rem] bg-[#fff7e5] px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[#8a5a00]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#f0b429]" />
                  {pendingAccountRequests.length} pending
                </span>
              </div>

              {pendingAccountRequests.length ? (
                <div className="divide-y divide-[#e7ecf2]">
                  {pendingAccountRequests.map((request) => {
                    const expanded = expandedRequests.has(request.id)
                    const requestedRole = request.requestedRole as UserRole
                    const residentDraft = residentDraftFor(request)
                    const residentYear = Number(residentDraft.trainingYear)
                    const residentGroup = residentDraft.rotationGroup.trim().toUpperCase()
                    const residentProfileComplete =
                      requestedRole !== 'resident' ||
                      (residentYear >= 1 &&
                        residentYear <= 3 &&
                        (residentYear !== 3 || Boolean(residentGroup)))

                    return (
                      <div
                        key={request.id}
                        className={cn(
                          'bg-white transition-colors duration-200',
                          expanded && 'bg-[#f8fafc]',
                        )}
                      >
                        <div
                          onClick={() => toggleExpandedRequest(request.id)}
                          className="group relative flex cursor-pointer flex-wrap items-center gap-3 py-3.5 pl-5 pr-14 transition-colors duration-200 hover:bg-[#f8fafc] sm:pr-5 md:px-6"
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.35rem] bg-[#071b35] text-[11px] font-bold tracking-[0.04em] text-[#f0b429]">
                            {initialsFor(request.fullName)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-[#000a1e]">
                              {request.fullName}
                            </span>
                            <span className="block truncate text-xs text-[#74777f]">{request.email}</span>
                          </span>
                          {/* Always visible: approving grants the badged role, so it
                              must be readable before Approve is reachable. */}
                          <span className="shrink-0 rounded-[0.25rem] bg-[#edf4fb] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#005394]">
                            {rolesByKey.get(requestedRole)?.label ??
                              roleLabels[requestedRole] ??
                              request.requestedRole}
                          </span>
                          {requestedRole === 'resident' ? (
                            <span
                              className={cn(
                                'shrink-0 rounded-[0.25rem] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em]',
                                residentProfileComplete
                                  ? 'bg-[#edf7f0] text-[#1f6b3b]'
                                  : 'bg-[#fff3d6] text-[#805600]',
                              )}
                            >
                              {residentDraft.trainingYear
                                ? `Year ${residentDraft.trainingYear}${residentYear === 3 && residentGroup ? ` · Group ${residentGroup}` : ''}`
                                : 'Year required'}
                            </span>
                          ) : null}
                          <div className="flex w-full shrink-0 items-center gap-1.5 [&>button]:flex-1 sm:w-auto sm:[&>button]:flex-none">
                            <Button
                              size="sm"
                              className={requestActionClass}
                              disabled={!residentProfileComplete}
                              title={
                                residentProfileComplete
                                  ? 'Approve account request'
                                  : residentYear === 3
                                    ? 'Open the request and assign a Year 3 rotation group.'
                                    : 'Open the request and confirm the resident training year.'
                              }
                              onClick={(event) => {
                                event.stopPropagation()
                                void approveAdminAccessRequest(
                                  request.id,
                                  requestedRole === 'resident'
                                    ? {
                                        trainingYear: residentYear,
                                        rotationGroup: residentYear === 3 ? residentGroup : null,
                                      }
                                    : undefined,
                                )
                              }}
                            >
                              <CheckCheck className="h-4 w-4" />
                              Approve
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className={requestRejectClass}
                              onClick={(event) => {
                                event.stopPropagation()
                                void rejectAdminAccessRequest(request.id)
                              }}
                            >
                              Reject
                            </Button>
                          </div>
                          <button
                            type="button"
                            aria-expanded={expanded}
                            aria-label={`${expanded ? 'Hide' : 'Show'} request details`}
                            onClick={(event) => {
                              event.stopPropagation()
                              toggleExpandedRequest(request.id)
                            }}
                            className="absolute right-5 top-4 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.3rem] text-[#8b96a5] outline-none transition-colors hover:bg-[#edf3f8] hover:text-[#005db6] focus-visible:ring-2 focus-visible:ring-[#63a1ff]/45 sm:static pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                          >
                            <ChevronDown
                              className={cn(
                                'h-4 w-4 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]',
                                expanded && 'rotate-180',
                              )}
                            />
                          </button>
                        </div>

                        {expanded ? (
                          <div className="space-y-4 border-t border-[#e7ecf2] bg-[#f8fafc] px-5 py-4 md:px-6 md:pl-[4.75rem]">
                            {requestedRole === 'resident' ? (
                              <div className="grid gap-4 border-l-2 border-[#f0b429] bg-[#fffdf7] px-4 py-3.5 sm:grid-cols-2">
                                <div className="space-y-1.5">
                                  <label className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#000a1e]">
                                    Confirm training year
                                  </label>
                                  <Select
                                    value={residentDraft.trainingYear}
                                    onValueChange={(value) =>
                                      updateResidentDraft(request, {
                                        trainingYear: value,
                                        rotationGroup:
                                          value === '3' ? residentDraft.rotationGroup : '',
                                      })
                                    }
                                  >
                                    <SelectTrigger className="h-10 bg-white">
                                      <SelectValue placeholder="Select year" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="1">Year 1</SelectItem>
                                      <SelectItem value="2">Year 2</SelectItem>
                                      <SelectItem value="3">Year 3</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  <p className="text-xs leading-5 text-[#74777f]">
                                    Submitted value: {request.trainingYear ? `Year ${request.trainingYear}` : 'Not provided'}
                                  </p>
                                </div>
                                <div className="space-y-1.5">
                                  <label htmlFor={`rotation-group-${request.id}`} className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#000a1e]">
                                    Rotation group {residentYear === 3 ? '(required)' : '(Year 3 only)'}
                                  </label>
                                  <Input
                                    id={`rotation-group-${request.id}`}
                                    value={residentDraft.rotationGroup}
                                    disabled={residentYear !== 3}
                                    maxLength={8}
                                    placeholder={residentYear === 3 ? 'e.g. A' : 'Not required'}
                                    className="h-10 bg-white uppercase"
                                    onChange={(event) =>
                                      updateResidentDraft(request, {
                                        rotationGroup: event.target.value
                                          .replace(/[^A-Za-z0-9-]/g, '')
                                          .toUpperCase(),
                                      })
                                    }
                                  />
                                  <p className="text-xs leading-5 text-[#74777f]">
                                    Year 3 rotations are planned by group.
                                  </p>
                                </div>
                              </div>
                            ) : null}
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#74777f]">
                                Applicant note
                              </p>
                              <p className="mt-1 text-sm leading-6 text-[#44474e]">
                                {request.notes ? request.notes : 'No notes provided with this request.'}
                              </p>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="flex min-h-[144px] flex-col items-center justify-center gap-3 bg-[#fbfcfd] px-6 text-center">
                  <span className="flex h-9 w-9 items-center justify-center rounded-[0.35rem] bg-[#edf4fb] text-[#005db6]">
                    <ShieldCheck className="h-5 w-5" />
                  </span>
                  <p className="text-sm leading-6 text-[#5b6169]">
                    All account requests are reviewed.
                  </p>
                </div>
              )}
            </div>
          </motion.section>
        ) : null}

      </section>

      <div
        ref={deferredDirectoryRef}
        className={cn('space-y-6', !showDirectorySections && 'min-h-[72rem]')}
      >
        {showDirectorySections ? (
          <>
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
          {/* Search and count sit beside the title only from lg: beside the sidebar a
              tablet column is too narrow for both (found by the Linux sweep at 768px). */}
          <div className="flex flex-col gap-4 border-b border-[#eef2f6] pb-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <SectionEyebrow label="Directory" />
              <h2 className="mt-1 font-display text-[1.4rem] font-bold tracking-[-0.02em] text-[#000a1e] md:text-[1.6rem]">
                Active roster
              </h2>
              <p className="mt-1 text-sm text-[#74777f]">
                {workspace === 'clinical'
                  ? 'Users and their department assignments.'
                  : 'Residents, consultants, student reps, and administrators.'}
              </p>
              {/* Reps are the one role with no public signup, so they are created
                  by an admin. That happens on the Students page, beside the batch
                  assignment it belongs to; this page manages accounts that exist. */}
              {workspace === 'academic' ? (
                <p className="mt-1 text-sm text-[#74777f]">
                  Student representatives are created on the{' '}
                  <Link
                    to="/admin/academic/students"
                    className="font-semibold text-[#005db6] underline-offset-2 hover:underline"
                  >
                    Students page
                  </Link>
                  . Everyone else signs up and is approved here.
                </p>
              ) : null}
            </div>
            <div className="flex w-full items-center gap-3 lg:w-auto">
              <div className="relative w-full sm:w-64">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9aa7b8]" />
                <Input
                  value={rosterSearch}
                  onChange={(event) => {
                    setRosterSearch(event.target.value)
                    setRosterPage(1)
                  }}
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

              {visibleProfiles.map((profile) => {
                const assignments = state.assignments.filter(
                  (assignment) => assignment.nurseId === profile.id,
                )
                // Mirrors UserPolicy::setActive: maintenance is never togglable, and
                // only maintenance may suspend another admin. Every other role is fair
                // game for an admin, so academic profiles must not render as locked.
                const isProtectedAdmin = profile.role === 'admin' && currentUser.role !== 'superadmin'
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
                          {rolesByKey.get(profile.role)?.label ?? roleLabels[profile.role]}
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
                            {rolesByKey.get(profile.role)?.label ?? roleLabels[profile.role]}
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
                        {/* A role picked by mistake used to be uncorrectable: the
                            account had to be deactivated and rebuilt under a new
                            email. Only the two admin-created roles are offered. */}
                        {isCorrectableRole(profile.role) ? (
                          <div className="mb-3.5 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[#e6ecf3] pb-3.5">
                            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#74777f]">
                              Role
                            </span>
                            <Select
                              value={profile.role}
                              disabled={roleChangePending === profile.id}
                              onValueChange={(next) =>
                                void handleRoleChange(profile, next as CorrectableRole)
                              }
                            >
                              <SelectTrigger
                                className="h-9 w-[11rem] bg-white text-sm"
                                aria-label={`Role for ${profile.fullName}`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {CORRECTABLE_ROLES.map((roleKey) => (
                                  <SelectItem key={roleKey} value={roleKey}>
                                    {rolesByKey.get(roleKey)?.label ?? roleLabels[roleKey]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <p className="text-xs text-[#74777f]">
                              {roleChangePending === profile.id
                                ? 'Saving...'
                                : 'Corrects an account created under the wrong role.'}
                            </p>
                          </div>
                        ) : null}
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

              {rosterPageCount > 1 ? (
                <div className="flex items-center justify-between gap-3 border-t border-[#eef2f6] bg-[#f7f9fc] px-4 py-3">
                  <p className="text-xs font-medium text-[#74777f]">
                    Page {activeRosterPage} of {rosterPageCount}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={activeRosterPage === 1}
                      onClick={() => setRosterPage(Math.max(1, activeRosterPage - 1))}
                    >
                      Previous
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={activeRosterPage === rosterPageCount}
                      onClick={() =>
                        setRosterPage(Math.min(rosterPageCount, activeRosterPage + 1))
                      }
                    >
                      Next
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded-[0.4rem] border border-dashed border-[#d4dde8] bg-[#f7f9fc] px-6 py-10 text-center text-sm text-[#74777f]">
              No users match “{rosterSearch}”.
            </div>
          )}
        </div>
      </motion.section>
          </>
        ) : null}
      </div>
    </div>
  )
}
