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
import { getCurrentWeekAssignmentCards } from '@/data/selectors'
import { useAppData, useCurrentReportingPeriod } from '@/context/app-data-context'
import { formatTimestamp } from '@/lib/dates'
import { formatCompactNumber } from '@/lib/utils'

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
  const summaryItems = [
    {
      label: 'Assigned',
      value: formatCompactNumber(cards.length),
      note: currentPeriod?.label ?? 'Current week',
      icon: ClipboardList,
      tone: 'text-[#005db6] bg-[#edf4fb] outline-[#cfe0f4]/75',
    },
    {
      label: 'Drafts',
      value: formatCompactNumber(draftCount),
      note: `${formatCompactNumber(editableCount)} editable forms`,
      icon: PencilLine,
      tone: 'text-[#00468c] bg-[#edf4fb] outline-[#cfe0f4]/75',
    },
    {
      label: 'Locked',
      value: formatCompactNumber(lockedCount),
      note: 'Read only',
      icon: LockKeyhole,
      tone: 'text-[#1d3047] bg-[#edf1f5] outline-[#d4dde8]/75',
    },
    {
      label: 'Unread',
      value: formatCompactNumber(unreadCount),
      note: `${serviceLineCount} service lines`,
      icon: Bell,
      tone: 'text-[#8a5a00] bg-[#fcf5e8] outline-[#edd9b0]/75',
    },
  ] as const

  return (
    <div className="space-y-8">
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.26, ease: 'easeOut' }}
        className="rounded-[0.35rem] bg-[#eef2f6] px-5 py-5 md:px-6"
      >
        <div className="space-y-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#005db6]">
                Nurse home
              </p>
              <h1 className="font-display text-[2rem] leading-[0.96] tracking-[-0.03em] text-[#000a1e] md:text-[2.35rem]">
                Weekly reporting
              </h1>
              <p className="text-sm text-[#44474e]">
                {currentPeriod?.label ?? 'Current week'} / {currentUser.title}
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <Link to="/nurse/reports">
                  Open my reports
                  <ClipboardList className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="secondary" className="bg-[none] bg-[#ffffff] shadow-none">
                <Link to="/notifications">
                  Notifications
                  <Bell className="h-4 w-4" />
                </Link>
              </Button>
            </div>
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
      </motion.section>

      <section className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
          className="rounded-[0.35rem] bg-[#eef2f6] px-5 py-6"
        >
          <div className="space-y-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#005db6]">
                  Current week
                </p>
                <h2 className="font-display text-[1.85rem] text-[#000a1e]">Assigned reports</h2>
              </div>
              <div className="rounded-[0.25rem] border border-[#d4dde8] bg-[#ffffff] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#44474e]">
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
                    transition={{ duration: 0.22, ease: 'easeOut', delay: index * 0.03 }}
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
              <div className="flex min-h-[220px] flex-col items-center justify-center gap-4 rounded-[0.5rem] border border-dashed border-[#d4dde8] bg-[#ffffff] px-6 text-center text-[#74777f]">
                <ClipboardList className="h-5 w-5 text-[#005db6]" />
                <div className="space-y-2">
                  <p className="text-sm font-medium text-[#1d3047]">No assigned reports.</p>
                  <p className="text-sm leading-6 text-[#74777f]">
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
          transition={{ duration: 0.28, ease: 'easeOut' }}
          className="rounded-[0.35rem] bg-[#eef2f6] px-5 py-6"
        >
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#005db6]">
                  Updates
                </p>
                <h2 className="font-display text-[1.85rem] text-[#000a1e]">Latest activity</h2>
              </div>
              <div className="rounded-[0.25rem] border border-[#d4dde8] bg-[#ffffff] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#44474e]">
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
                    transition={{ duration: 0.22, ease: 'easeOut', delay: index * 0.03 }}
                    className="rounded-[0.35rem] border border-[#d4dde8] bg-[#ffffff] p-4"
                  >
                    <div className="flex items-start gap-3">
                      <div className="rounded-[0.25rem] bg-[#edf4fb] p-2.5 text-[#005db6]">
                        {notification.readAt ? (
                          <Bell className="h-4 w-4" />
                        ) : (
                          <Sparkles className="h-4 w-4" />
                        )}
                      </div>
                      <div className="min-w-0 space-y-1">
                        <p className="text-sm font-semibold text-[#000a1e]">{notification.title}</p>
                        <p className="text-sm leading-6 text-[#44474e]">
                          {notification.message}
                        </p>
                        <p className="text-xs uppercase tracking-[0.18em] text-[#74777f]">
                          {formatTimestamp(notification.createdAt)}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="flex min-h-[240px] flex-col items-center justify-center gap-4 rounded-[0.5rem] border border-dashed border-[#d4dde8] bg-[#ffffff] px-6 text-center text-[#74777f]">
                <Bell className="h-5 w-5 text-[#005db6]" />
                <div className="space-y-2">
                  <p className="text-sm font-medium text-[#1d3047]">No notifications.</p>
                  <p className="text-sm leading-6 text-[#74777f]">
                    New report and lock updates will appear here.
                  </p>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-3 pt-1">
              <Button asChild variant="secondary" className="bg-[none] bg-[#ffffff] shadow-none">
                <Link to="/notifications">
                  Open notifications
                  <Bell className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="secondary" className="bg-[none] bg-[#ffffff] shadow-none">
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
        transition={{ duration: 0.24, ease: 'easeOut' }}
        className="rounded-[0.35rem] bg-[#eef2f6] px-5 py-5"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#005db6]">
              Access
            </p>
            <p className="text-sm text-[#44474e]">
              Need another assignment or a different reporting service?
            </p>
          </div>
          <Button asChild variant="secondary" className="bg-[none] bg-[#ffffff] shadow-none">
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
