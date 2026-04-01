import { motion } from 'framer-motion'
import {
  Bell,
  ClipboardList,
  LockKeyhole,
  PencilLine,
  Sparkles,
} from 'lucide-react'
import { Link } from 'react-router-dom'

import { ReportAssignmentCard } from '@/components/reports/report-assignment-card'
import { Button } from '@/components/ui/button'
import { useAppData, useCurrentReportingPeriod } from '@/context/app-data-context'
import { formatTimestamp } from '@/lib/dates'
import { formatCompactNumber } from '@/lib/utils'
import { getCurrentWeekAssignmentCards } from '@/data/selectors'

export function NurseDashboardPage() {
  const { state, currentUser } = useAppData()
  const currentPeriod = useCurrentReportingPeriod()

  if (!currentUser) {
    return null
  }

  const cards = getCurrentWeekAssignmentCards(state, currentUser.id)
  const notifications = [...state.notifications]
    .filter((notification) => notification.userId === currentUser.id)
    .sort((left, right) => {
      const unreadPriority = Number(Boolean(left.readAt)) - Number(Boolean(right.readAt))
      if (unreadPriority !== 0) {
        return unreadPriority
      }

      return right.createdAt.localeCompare(left.createdAt)
    })
    .slice(0, 4)

  const draftCount = cards.filter((card) => card.status === 'draft').length
  const lockedCount = cards.filter((card) => card.status === 'locked').length
  const editableCount = cards.filter((card) => card.status !== 'locked').length
  const unreadCount = state.notifications.filter(
    (notification) => notification.userId === currentUser.id && !notification.readAt,
  ).length
  const serviceLineCount = new Set(cards.map((card) => card.department.family)).size

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
              Nurse home
            </div>

            <div className="space-y-0">
              <h1 className="font-display max-w-[8ch] text-5xl font-semibold leading-[0.9] tracking-tight text-slate-950 md:text-[5.6rem] xl:text-[6.2rem]">
                Weekly reporting
              </h1>
              <p className="pt-5 text-sm font-semibold uppercase tracking-[0.24em] text-slate-500 md:pt-6 md:text-[0.8rem]">
                {currentPeriod?.label ?? 'Current week'} / {currentUser.title}
              </p>
            </div>

            <div className="flex flex-wrap gap-2.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              <span className="login-chip-float rounded-full border border-white/70 bg-white/55 px-3 py-2 backdrop-blur-sm">
                {formatCompactNumber(cards.length)} assigned
              </span>
              <span
                className="login-chip-float rounded-full border border-white/70 bg-white/55 px-3 py-2 backdrop-blur-sm"
                style={{ animationDelay: '700ms' }}
              >
                {formatCompactNumber(editableCount)} open
              </span>
              <span
                className="login-chip-float rounded-full border border-white/70 bg-white/55 px-3 py-2 backdrop-blur-sm"
                style={{ animationDelay: '1400ms' }}
              >
                {serviceLineCount} service lines
              </span>
            </div>

            <div className="flex flex-wrap gap-3 pt-1">
              <Button asChild>
                <Link to="/nurse/reports">
                  Open my reports
                  <ClipboardList className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="secondary">
                <Link to="/notifications">
                  Notifications
                  <Bell className="h-4 w-4" />
                </Link>
              </Button>
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
                  Assigned
                </p>
                <p className="mt-2 font-display text-4xl leading-none text-slate-950">
                  {formatCompactNumber(cards.length)}
                </p>
              </div>
              <div className="space-y-1 border-b border-white/70 pb-4 sm:border-b-0 sm:pb-0 sm:pl-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Drafts
                </p>
                <p className="mt-2 font-display text-4xl leading-none text-slate-950">
                  {formatCompactNumber(draftCount)}
                </p>
              </div>
            </div>

            <div className="grid gap-4 border-t border-white/70 pt-4 sm:grid-cols-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Locked
                </p>
                <p className="mt-2 text-lg font-semibold text-slate-950">
                  {formatCompactNumber(lockedCount)}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Unread
                </p>
                <p className="mt-2 text-lg font-semibold text-slate-950">
                  {formatCompactNumber(unreadCount)}
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
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
                  Current week
                </p>
                <h2 className="font-display text-3xl text-slate-950">Assigned reports</h2>
                <p className="text-sm text-slate-500">Your live reporting work.</p>
              </div>
              <div className="rounded-full border border-white/80 bg-white/72 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600 shadow-[0_14px_24px_-20px_rgba(15,23,42,0.15)]">
                {formatCompactNumber(cards.length)} forms
              </div>
            </div>

            {cards.length ? (
              <div className="grid gap-4 lg:grid-cols-2">
                {cards.map((card, index) => (
                  <motion.div
                    key={card.assignment.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.24, ease: 'easeOut', delay: index * 0.03 }}
                  >
                    <ReportAssignmentCard
                      departmentName={card.department.name}
                      templateName={card.template.name}
                      periodLabel={card.period.label}
                      status={card.status}
                      lastUpdatedAt={card.updatedAt}
                      href={`/reports/${card.assignment.id}/${card.period.id}`}
                      canEdit={card.status !== 'locked'}
                    />
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="flex min-h-[220px] flex-col items-center justify-center gap-4 rounded-[1.9rem] border border-dashed border-sky-100/90 bg-white/62 px-6 text-center text-slate-500">
                <ClipboardList className="h-5 w-5 text-sky-500" />
                <div className="space-y-2">
                  <p className="text-sm font-medium text-slate-700">No assigned reports.</p>
                  <p className="text-sm leading-6 text-slate-500">
                    Request access if you need another service line.
                  </p>
                </div>
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
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-100">
                  Updates
                </p>
                <h2 className="font-display text-3xl text-white">Latest activity</h2>
                <p className="text-sm text-cyan-50/72">Unread stays first.</p>
              </div>
              <div className="rounded-full border border-white/12 bg-white/8 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100">
                {formatCompactNumber(unreadCount)} unread
              </div>
            </div>

            {notifications.length ? (
              <div className="space-y-3">
                {notifications.map((notification, index) => (
                  <motion.div
                    key={notification.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.24, ease: 'easeOut', delay: index * 0.03 }}
                    className="rounded-[1.6rem] border border-white/12 bg-white/8 p-4 backdrop-blur-sm"
                  >
                    <div className="flex items-start gap-3">
                      <div className="rounded-[1rem] border border-white/12 bg-white/8 p-2.5">
                        {notification.readAt ? (
                          <Bell className="h-4 w-4 text-cyan-100" />
                        ) : (
                          <Sparkles className="h-4 w-4 text-cyan-100" />
                        )}
                      </div>
                      <div className="min-w-0 space-y-1">
                        <p className="text-sm font-semibold text-white">{notification.title}</p>
                        <p className="text-sm leading-6 text-cyan-50/72">
                          {notification.message}
                        </p>
                        <p className="text-xs uppercase tracking-[0.18em] text-cyan-100/60">
                          {formatTimestamp(notification.createdAt)}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="flex min-h-[240px] flex-col items-center justify-center gap-4 rounded-[1.9rem] border border-dashed border-white/12 bg-white/6 px-6 text-center text-cyan-50/72">
                <Bell className="h-5 w-5 text-cyan-100" />
                <div className="space-y-2">
                  <p className="text-sm font-medium text-white">No notifications.</p>
                  <p className="text-sm leading-6 text-cyan-50/72">
                    New report and lock updates will appear here.
                  </p>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-3 pt-2">
              <Button asChild variant="secondary">
                <Link to="/notifications">
                  Open notifications
                  <Bell className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild className="bg-white/8 text-white shadow-none ring-1 ring-white/12 hover:bg-white/12">
                <Link to="/register">
                  Request access
                  <LockKeyhole className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </motion.section>
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

        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">Need another assignment?</p>
            <p className="text-sm text-slate-500">Use the same approval request flow.</p>
          </div>
          <Button asChild variant="secondary">
            <Link to="/register">
              Open access request
              <PencilLine className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </motion.section>
    </div>
  )
}
