import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowRightLeft,
  Building2,
  Clock3,
  Filter,
  History,
  UserRound,
} from 'lucide-react'

import { ReportingScopePanel } from '@/components/admin/reporting-scope-panel'
import { Badge } from '@/components/ui/badge'
import { departments, templateMap } from '@/config/templates'
import { useAppData } from '@/context/app-data-context'
import { formatTimestamp } from '@/lib/dates'
import { formatCompactNumber } from '@/lib/utils'

const serviceLineLabels = {
  inpatient: 'Inpatient',
  outpatient: 'Outpatient',
  procedure: 'Procedures',
} as const

function formatAuditValue(value: string | number | null) {
  if (value === null || value === undefined || value === '') {
    return '-'
  }

  return String(value)
}

export function AuditLogPage() {
  const { state, ensureHistoryData } = useAppData()
  const [departmentFilter, setDepartmentFilter] = useState('all')

  useEffect(() => {
    void ensureHistoryData()
  }, [ensureHistoryData])

  const orderedEntries = [...state.auditLogs].sort((left, right) =>
    right.changedAt.localeCompare(left.changedAt),
  )
  const entries = orderedEntries.filter((entry) =>
    departmentFilter === 'all' ? true : entry.departmentId === departmentFilter,
  )
  const selectedDepartment =
    departmentFilter === 'all'
      ? null
      : departments.find((department) => department.id === departmentFilter) ?? null
  const actorCount = new Set(entries.map((entry) => entry.changedById)).size
  const departmentCount = new Set(entries.map((entry) => entry.departmentId)).size
  const latestEntry = entries[0] ?? null
  const departmentOptions = [
    { value: 'all', label: 'All departments' },
    ...departments.map((department) => ({
      value: department.id,
      label: department.name,
    })),
  ] as const
  const summaryItems = [
    {
      label: 'Entries',
      value: formatCompactNumber(entries.length),
      note: 'Visible after current filters',
      icon: History,
      tone: 'text-[#005db6] bg-[#edf4fb] outline-[#cfe0f4]/75',
    },
    {
      label: 'Actors',
      value: formatCompactNumber(actorCount),
      note: 'Distinct editors',
      icon: UserRound,
      tone: 'text-[#00468c] bg-[#edf4fb] outline-[#cfe0f4]/75',
    },
    {
      label: 'Departments',
      value: formatCompactNumber(departmentCount),
      note: selectedDepartment ? selectedDepartment.name : 'All departments',
      icon: Building2,
      tone: 'text-[#1d3047] bg-[#edf1f5] outline-[#d4dde8]/75',
    },
    {
      label: 'Latest',
      value: latestEntry ? formatTimestamp(latestEntry.changedAt) : 'No entries',
      note: 'Newest first',
      icon: Clock3,
      tone: 'text-[#8a5a00] bg-[#fcf5e8] outline-[#edd9b0]/75',
    },
  ] as const

  return (
    <div className="space-y-8">
      <section className="rounded-[0.35rem] bg-[#eef2f6] px-5 py-5 md:px-6">
        <div className="space-y-5">
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#005db6]">
              Audit log
            </p>
            <h1 className="font-display text-[2rem] leading-[0.96] tracking-[-0.03em] text-[#000a1e] md:text-[2.35rem]">
              Change history
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

          <div className="border-t border-[#d9e0e7] pt-4">
            <ReportingScopePanel
              className="w-full max-w-[360px]"
              fields={[
                {
                  label: 'Department',
                  options: departmentOptions,
                  placeholder: 'Choose department',
                  value: departmentFilter,
                  onValueChange: setDepartmentFilter,
                  triggerClassName: 'text-[0.95rem]',
                },
              ]}
            />
          </div>
        </div>
      </section>

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
                Audit stream
              </p>
              <h2 className="font-display text-[1.85rem] text-[#000a1e]">Entries</h2>
            </div>
            <div className="inline-flex items-center gap-2 rounded-[0.25rem] border border-[#d4dde8] bg-[#ffffff] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#44474e]">
              <History className="h-4 w-4 text-[#005db6]" />
              {formatCompactNumber(entries.length)} rows
            </div>
          </div>

          {entries.length ? (
            <div className="overflow-hidden rounded-[0.35rem] border border-[#d4dde8] bg-[#ffffff]">
              {entries.map((entry, index) => {
                const department =
                  departments.find((candidate) => candidate.id === entry.departmentId) ?? null
                const templateName = templateMap[entry.templateId]?.name ?? 'Template'

                return (
                  <div
                    key={entry.id}
                    className={`grid gap-5 px-5 py-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.95fr)_180px] lg:items-start ${
                      index === 0 ? '' : 'border-t border-slate-100/90'
                    }`}
                  >
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="info">
                          {department ? serviceLineLabels[department.family] : 'Service line'}
                        </Badge>
                        <span className="inline-flex items-center gap-2 rounded-[0.25rem] border border-[#d4dde8] bg-[#f3f4f5] px-3 py-1.5 text-xs font-semibold text-[#44474e]">
                          <Building2 className="h-3.5 w-3.5 text-[#005db6]" />
                          {department?.name ?? entry.departmentId}
                        </span>
                      </div>

                      <div className="space-y-1">
                        <p className="text-base font-semibold text-slate-950">{entry.fieldLabel}</p>
                        <p className="text-sm text-slate-500">{templateName}</p>
                      </div>

                      <div className="inline-flex items-center gap-2 text-sm text-slate-500">
                        <UserRound className="h-4 w-4 text-slate-400" />
                        {entry.changedByName}
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-[0.35rem] border border-[#d4dde8] bg-[#f3f4f5] p-4">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#74777f]">
                          Before
                        </p>
                        <p className="mt-2 break-words text-sm font-medium leading-6 text-[#44474e]">
                          {formatAuditValue(entry.oldValue)}
                        </p>
                      </div>
                      <div className="rounded-[0.35rem] border border-[#d4dde8] bg-[#ffffff] p-4">
                        <div className="flex items-center gap-2">
                          <ArrowRightLeft className="h-4 w-4 text-[#005db6]" />
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#005db6]">
                            After
                          </p>
                        </div>
                        <p className="mt-2 break-words text-sm font-medium leading-6 text-[#000a1e]">
                          {formatAuditValue(entry.newValue)}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2 lg:text-right">
                      <div className="inline-flex items-center gap-2 rounded-[0.25rem] border border-[#d4dde8] bg-[#f3f4f5] px-3 py-1.5 text-xs font-semibold text-[#44474e] lg:ml-auto">
                        <Clock3 className="h-3.5 w-3.5 text-[#74777f]" />
                        {formatTimestamp(entry.changedAt)}
                      </div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#74777f]">
                        Change log
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="flex min-h-[220px] flex-col items-center justify-center gap-4 rounded-[0.5rem] border border-dashed border-[#d4dde8] bg-[#ffffff] px-6 text-center text-[#74777f]">
              <Filter className="h-5 w-5 text-[#005db6]" />
              <div className="space-y-2">
                <p className="text-sm font-medium text-[#000a1e]">No entries.</p>
                <p className="text-sm leading-6 text-[#44474e]">
                  Try another department.
                </p>
              </div>
            </div>
          )}
        </div>
      </motion.section>
    </div>
  )
}
