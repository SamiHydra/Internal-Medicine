import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowRightLeft,
  Building2,
  Clock3,
  Filter,
  History,
  UserRound,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  const { state } = useAppData()
  const [departmentFilter, setDepartmentFilter] = useState('all')

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
              Audit log
            </div>

            <div className="space-y-0">
              <h1 className="font-display max-w-[8ch] text-5xl font-semibold leading-[0.9] tracking-tight text-slate-950 md:text-[5.6rem] xl:text-[6.2rem]">
                Change history
              </h1>
              <p className="pt-5 text-sm font-semibold uppercase tracking-[0.24em] text-slate-500 md:pt-6 md:text-[0.8rem]">
                Field edits / newest first
              </p>
            </div>

            <div className="flex flex-wrap gap-2.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              <span className="login-chip-float rounded-full border border-white/70 bg-white/55 px-3 py-2 backdrop-blur-sm">
                {formatCompactNumber(entries.length)} visible
              </span>
              <span
                className="login-chip-float rounded-full border border-white/70 bg-white/55 px-3 py-2 backdrop-blur-sm"
                style={{ animationDelay: '700ms' }}
              >
                {selectedDepartment ? selectedDepartment.name : 'All departments'}
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
                  Entries
                </p>
                <p className="mt-2 font-display text-4xl leading-none text-slate-950">
                  {formatCompactNumber(entries.length)}
                </p>
              </div>
              <div className="space-y-1 border-b border-white/70 pb-4 sm:border-b-0 sm:pb-0 sm:pl-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Actors
                </p>
                <p className="mt-2 font-display text-4xl leading-none text-slate-950">
                  {formatCompactNumber(actorCount)}
                </p>
              </div>
            </div>

            <div className="grid gap-4 border-t border-white/70 pt-4 sm:grid-cols-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Departments
                </p>
                <p className="mt-2 text-lg font-semibold text-slate-950">
                  {formatCompactNumber(departmentCount)}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Latest
                </p>
                <p className="mt-2 text-sm font-medium leading-6 text-slate-700">
                  {latestEntry ? formatTimestamp(latestEntry.changedAt) : 'No entries'}
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: 'easeOut' }}
        className="relative overflow-hidden rounded-[2rem] border border-white/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.82),rgba(244,249,255,0.76),rgba(235,253,248,0.62))] px-5 py-5 shadow-[0_20px_42px_-34px_rgba(15,23,42,0.18)] backdrop-blur-md"
      >
        <div className="pointer-events-none absolute inset-0">
          <div className="login-ambient-drift absolute right-[12%] top-[-24%] h-32 w-32 rounded-full bg-sky-200/18 blur-3xl" />
          <div className="login-line-flow absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sky-300/70 to-transparent" />
        </div>

        <div className="relative grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)] xl:items-center">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">
              Department
            </p>
            <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
              <SelectTrigger className="bg-white/82">
                <SelectValue placeholder="Choose department" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All departments</SelectItem>
                {departments.map((department) => (
                  <SelectItem key={department.id} value={department.id}>
                    {department.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="border-l border-white/65 pl-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                View
              </p>
              <p className="mt-2 text-sm font-semibold text-slate-950">
                {selectedDepartment ? selectedDepartment.name : 'All departments'}
              </p>
              <p className="text-sm text-slate-500">
                {selectedDepartment
                  ? serviceLineLabels[selectedDepartment.family]
                  : 'Whole workspace'}
              </p>
            </div>
            <div className="border-l border-white/65 pl-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                Visible
              </p>
              <p className="mt-2 text-sm font-semibold text-slate-950">
                {formatCompactNumber(entries.length)}
              </p>
            </div>
            <div className="border-l border-white/65 pl-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                Order
              </p>
              <p className="mt-2 text-sm font-semibold text-slate-950">Newest first</p>
            </div>
          </div>
        </div>
      </motion.section>

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
                Audit stream
              </p>
              <h2 className="font-display text-3xl text-slate-950">Entries</h2>
              <p className="text-sm text-slate-500">Field-by-field changes.</p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/72 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600 shadow-[0_14px_24px_-20px_rgba(15,23,42,0.15)]">
              <History className="h-4 w-4 text-sky-700" />
              {formatCompactNumber(entries.length)} rows
            </div>
          </div>

          {entries.length ? (
            <div className="overflow-hidden rounded-[1.9rem] border border-slate-200/80 bg-white/82 shadow-[0_16px_30px_-24px_rgba(15,23,42,0.18)]">
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
                        <span className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-slate-50/90 px-3 py-1.5 text-xs font-semibold text-slate-700">
                          <Building2 className="h-3.5 w-3.5 text-sky-700" />
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
                      <div className="rounded-[1.3rem] border border-slate-200/80 bg-slate-50/90 p-4">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Before
                        </p>
                        <p className="mt-2 break-words text-sm font-medium leading-6 text-slate-800">
                          {formatAuditValue(entry.oldValue)}
                        </p>
                      </div>
                      <div className="rounded-[1.3rem] border border-slate-200/80 bg-white p-4 shadow-[0_14px_24px_-22px_rgba(15,23,42,0.14)]">
                        <div className="flex items-center gap-2">
                          <ArrowRightLeft className="h-4 w-4 text-sky-700" />
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                            After
                          </p>
                        </div>
                        <p className="mt-2 break-words text-sm font-medium leading-6 text-slate-950">
                          {formatAuditValue(entry.newValue)}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2 lg:text-right">
                      <div className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-slate-50/90 px-3 py-1.5 text-xs font-semibold text-slate-600 lg:ml-auto">
                        <Clock3 className="h-3.5 w-3.5 text-slate-400" />
                        {formatTimestamp(entry.changedAt)}
                      </div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                        Change log
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="flex min-h-[220px] flex-col items-center justify-center gap-4 rounded-[1.9rem] border border-dashed border-sky-100/90 bg-white/62 px-6 text-center text-slate-500">
              <Filter className="h-5 w-5 text-sky-500" />
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-700">No entries.</p>
                <p className="text-sm leading-6 text-slate-500">
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
