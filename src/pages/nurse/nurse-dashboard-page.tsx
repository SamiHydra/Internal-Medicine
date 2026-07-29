import { motion } from 'framer-motion'
import { Bell, ClipboardList, PencilLine, Sparkles } from 'lucide-react'
import { useEffect } from 'react'
import { Link } from 'react-router-dom'

import {
  HeaderChip,
  SectionEmptyState,
  SectionEyebrow,
  SectionHeader,
  panelClass,
} from '@/components/dashboard/section-panel'
import { ReportAssignmentCard } from '@/components/reports/report-assignment-card'
import { Button } from '@/components/ui/button'
import { getCurrentWeekAssignmentCards } from '@/data/selectors'
import { useAppData, useCurrentReportingPeriod } from '@/context/app-data-context'
import { formatTimestamp } from '@/lib/dates'
import { formatCompactNumber } from '@/lib/utils'

export function NurseDashboardPage() {
  const { state, currentUser, ensureReportSummaryData } = useAppData()
  const currentPeriod = useCurrentReportingPeriod()

  useEffect(() => {
    if (currentPeriod) {
      void ensureReportSummaryData({ periodIds: [currentPeriod.id] })
    }
  }, [currentPeriod, ensureReportSummaryData])

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

  const unreadCount = state.notifications.filter(
    (notification) => notification.userId === currentUser.id && !notification.readAt,
  ).length
  const periodLabel = currentPeriod?.label ?? 'Current week'

  return (
    <div className="space-y-6 px-4 py-6 md:px-6 md:py-8">
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className={panelClass}
      >
        <SectionHeader
          eyebrow="Overview"
          title="This week at a glance"
          description={`${periodLabel} · ${currentUser.title}`}
          actions={
            <>
              <Button asChild size="sm">
                <Link to="/nurse/reports">
                  Open my reports
                  <ClipboardList className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="sm" variant="secondary">
                <Link to="/notifications">
                  Notifications
                  <Bell className="h-4 w-4" />
                </Link>
              </Button>
            </>
          }
        />
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut', delay: 0.04 }}
        className={panelClass}
      >
        <SectionHeader
          eyebrow="Current week"
          title="Assigned reports"
          description="Open a form to enter this week's figures."
          actions={<HeaderChip>{formatCompactNumber(cards.length)} forms</HeaderChip>}
        />
        {cards.length ? (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
          <div className="mt-5">
            <SectionEmptyState
              icon={<ClipboardList className="h-5 w-5" />}
              title="No assigned reports"
              description="Request access if you need another service line."
            />
          </div>
        )}
      </motion.section>

      <section className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut', delay: 0.08 }}
          className={panelClass}
        >
          <SectionHeader
            eyebrow="Updates"
            title="Latest activity"
            actions={<HeaderChip>{formatCompactNumber(unreadCount)} unread</HeaderChip>}
          />
          {notifications.length ? (
            <div className="mt-5 space-y-3">
              {notifications.map((notification, index) => (
                <motion.div
                  key={notification.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22, ease: 'easeOut', delay: index * 0.03 }}
                  className="rounded-[0.35rem] border border-[#e6ecf3] bg-[#f8fafc] p-4"
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
                      <p className="text-sm leading-6 text-[#5b6169]">{notification.message}</p>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9aa7b8]">
                        {formatTimestamp(notification.createdAt)}
                      </p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="mt-5">
              <SectionEmptyState
                icon={<Bell className="h-5 w-5" />}
                title="No notifications"
                description="New report and lock updates will appear here."
              />
            </div>
          )}

          <div className="mt-5">
            <Button asChild size="sm" variant="secondary">
              <Link to="/notifications">
                Open notifications
                <Bell className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut', delay: 0.12 }}
          className={panelClass}
        >
          <SectionEyebrow label="Access" />
          <h2 className="mt-1.5 font-display text-[1.4rem] font-bold leading-tight tracking-[-0.02em] text-[#000a1e] md:text-[1.6rem]">
            Need another service?
          </h2>
          <p className="mt-1.5 text-sm leading-6 text-[#74777f]">
            Request access to an additional reporting assignment or service line.
          </p>
          <Button asChild size="sm" variant="secondary" className="mt-4">
            <Link to="/register">
              Request access
              <PencilLine className="h-4 w-4" />
            </Link>
          </Button>
        </motion.section>
      </section>
    </div>
  )
}
