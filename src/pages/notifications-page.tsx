import { motion } from 'framer-motion'
import {
  Bell,
  CheckCheck,
  CheckCircle2,
  ChevronRight,
  FileLock2,
  History,
  PencilLine,
  RotateCcw,
  ShieldAlert,
  Trash2,
  TriangleAlert,
  UserRoundPlus,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { useAppData } from '@/context/app-data-context'
import { formatTimestamp } from '@/lib/dates'
import { cn } from '@/lib/utils'
import type { NotificationItem } from '@/types/domain'

const clearedNotificationsStorageKey = 'im:last-cleared-notifications'

function readClearedNotificationsSnapshot() {
  if (typeof window === 'undefined') {
    return [] as NotificationItem[]
  }

  try {
    const value = window.sessionStorage.getItem(clearedNotificationsStorageKey)
    if (!value) {
      return [] as NotificationItem[]
    }

    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? (parsed as NotificationItem[]) : []
  } catch {
    return [] as NotificationItem[]
  }
}

function writeClearedNotificationsSnapshot(notifications: NotificationItem[]) {
  if (typeof window === 'undefined') {
    return
  }

  if (!notifications.length) {
    window.sessionStorage.removeItem(clearedNotificationsStorageKey)
    return
  }

  window.sessionStorage.setItem(
    clearedNotificationsStorageKey,
    JSON.stringify(notifications),
  )
}

function scrollNotificationsToTop() {
  if (typeof window === 'undefined') {
    return
  }

  window.requestAnimationFrame(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  })
}

const notificationMeta: Record<
  NotificationItem['type'],
  {
    label: string
    icon: typeof Bell
    iconTone: string
    chipTone: string
    unreadTone: string
  }
> = {
  new_report_submitted: {
    label: 'Submitted',
    icon: CheckCircle2,
    iconTone: 'bg-cyan-50 text-cyan-700 ring-1 ring-cyan-100/90',
    chipTone: 'bg-cyan-50 text-cyan-800',
    unreadTone: 'before:bg-cyan-400',
  },
  submitted_report_edited: {
    label: 'Edited',
    icon: PencilLine,
    iconTone: 'bg-amber-50 text-amber-700 ring-1 ring-amber-100/90',
    chipTone: 'bg-amber-50 text-amber-800',
    unreadTone: 'before:bg-amber-400',
  },
  report_locked: {
    label: 'Locked',
    icon: FileLock2,
    iconTone: 'bg-slate-100 text-slate-700 ring-1 ring-slate-200/90',
    chipTone: 'bg-slate-100 text-slate-700',
    unreadTone: 'before:bg-slate-500',
  },
  report_unlocked: {
    label: 'Unlocked',
    icon: ShieldAlert,
    iconTone: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100/90',
    chipTone: 'bg-emerald-50 text-emerald-800',
    unreadTone: 'before:bg-emerald-400',
  },
  overdue_report: {
    label: 'Overdue',
    icon: TriangleAlert,
    iconTone: 'bg-rose-50 text-rose-700 ring-1 ring-rose-100/90',
    chipTone: 'bg-rose-50 text-rose-800',
    unreadTone: 'before:bg-rose-500',
  },
  nurse_access_request: {
    label: 'Access request',
    icon: UserRoundPlus,
    iconTone: 'bg-sky-50 text-sky-700 ring-1 ring-sky-100/90',
    chipTone: 'bg-sky-50 text-sky-800',
    unreadTone: 'before:bg-sky-500',
  },
  access_request_reviewed: {
    label: 'Reviewed',
    icon: CheckCheck,
    iconTone: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100/90',
    chipTone: 'bg-emerald-50 text-emerald-800',
    unreadTone: 'before:bg-emerald-400',
  },
}

export function NotificationsPage() {
  const {
    state,
    currentUser,
    markNotificationsRead,
    clearNotifications,
    restoreNotifications,
  } = useAppData()

  const [lastClearedNotifications, setLastClearedNotifications] = useState<NotificationItem[]>(
    () => readClearedNotificationsSnapshot(),
  )
  const currentUserId = currentUser?.id ?? ''

  const notifications = [...state.notifications]
    .filter((notification) => notification.userId === currentUserId)
    .sort((left, right) => {
      const unreadPriority = Number(Boolean(left.readAt)) - Number(Boolean(right.readAt))
      if (unreadPriority !== 0) {
        return unreadPriority
      }

      return right.createdAt.localeCompare(left.createdAt)
    })

  const unreadNotifications = notifications.filter((notification) => !notification.readAt)
  const unreadCount = unreadNotifications.length
  const totalCount = notifications.length
  const latestNotification = notifications[0]
  const restoreSnapshot = lastClearedNotifications.filter(
    (notification) => notification.userId === currentUserId,
  )
  const hasRestoreSnapshot = restoreSnapshot.length > 0
  const isEmptyInbox = !notifications.length

  useEffect(() => {
    if (!restoreSnapshot.length) {
      return
    }

    const restored = restoreSnapshot.every((notification) =>
      state.notifications.some((entry) => entry.id === notification.id),
    )

    if (restored) {
      setLastClearedNotifications([])
      writeClearedNotificationsSnapshot([])
    }
  }, [restoreSnapshot, state.notifications])

  useEffect(() => {
    if (isEmptyInbox) {
      scrollNotificationsToTop()
    }
  }, [isEmptyInbox])

  const markAllRead = () =>
    void markNotificationsRead(
      currentUserId,
      unreadNotifications.map((notification) => notification.id),
    )

  const clearAll = () => {
    if (!notifications.length) {
      return
    }

    setLastClearedNotifications(notifications)
    writeClearedNotificationsSnapshot(notifications)
    scrollNotificationsToTop()

    return void clearNotifications(
      currentUserId,
      notifications.map((notification) => notification.id),
    )
  }

  const restoreLastClear = () => {
    scrollNotificationsToTop()
    return void restoreNotifications(restoreSnapshot)
  }

  if (!currentUser) {
    return null
  }

  return (
    <div className="space-y-5">
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
              Notifications
            </div>

            <div className="space-y-0">
              <h1 className="font-display max-w-[8ch] text-5xl font-semibold leading-[0.9] tracking-tight text-slate-950 md:text-[5.6rem] xl:text-[6.2rem]">
                Notification center
              </h1>
              <p className="pt-5 text-sm font-semibold uppercase tracking-[0.24em] text-slate-500 md:pt-6 md:text-[0.8rem]">
                Unread first / current inbox
              </p>
            </div>

            <div className="flex flex-wrap gap-2.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              <span className="login-chip-float rounded-full border border-white/70 bg-white/55 px-3 py-2 backdrop-blur-sm">
                {unreadCount ? `${unreadCount} unread` : 'All caught up'}
              </span>
              <span
                className="login-chip-float rounded-full border border-white/70 bg-white/55 px-3 py-2 backdrop-blur-sm"
                style={{ animationDelay: '700ms' }}
              >
                {totalCount} total
              </span>
              {hasRestoreSnapshot ? (
                <span
                  className="login-chip-float rounded-full border border-white/70 bg-white/55 px-3 py-2 backdrop-blur-sm"
                  style={{ animationDelay: '1400ms' }}
                >
                  Restore available
                </span>
              ) : null}
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
                  Unread
                </p>
                <p className="mt-2 font-display text-4xl leading-none text-slate-950">
                  {unreadCount}
                </p>
              </div>
              <div className="space-y-1 border-b border-white/70 pb-4 sm:border-b-0 sm:pb-0 sm:pl-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Total
                </p>
                <p className="mt-2 font-display text-4xl leading-none text-slate-950">
                  {totalCount}
                </p>
              </div>
            </div>

            <div className="grid gap-4 border-t border-white/70 pt-4 sm:grid-cols-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Latest
                </p>
                <p className="mt-2 text-sm font-medium leading-6 text-slate-700">
                  {latestNotification
                    ? formatTimestamp(latestNotification.createdAt)
                    : hasRestoreSnapshot
                      ? 'Restore ready'
                      : 'No items'}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                  State
                </p>
                <p className="mt-2 text-sm font-medium leading-6 text-slate-700">
                  {unreadCount ? 'Needs review' : hasRestoreSnapshot ? 'Restorable' : 'Clear'}
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-[2rem] border border-white/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.82),rgba(244,249,255,0.76),rgba(235,253,248,0.62))] px-5 py-5 shadow-[0_20px_42px_-34px_rgba(15,23,42,0.18)] backdrop-blur-md"
      >
        <div className="pointer-events-none absolute inset-0">
          <div className="login-ambient-drift absolute right-[12%] top-[-24%] h-32 w-32 rounded-full bg-sky-200/18 blur-3xl" />
          <div className="login-line-flow absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sky-300/70 to-transparent" />
        </div>

        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">
              {unreadCount
                ? `${unreadCount} unread updates.`
                : notifications.length
                  ? 'All notifications are read.'
                  : hasRestoreSnapshot
                    ? 'Inbox cleared. Restore is ready.'
                    : 'Inbox empty.'}
            </p>
            <p className="text-sm text-slate-500">
              {notifications.length
                ? 'Newest items stay at the top.'
                : hasRestoreSnapshot
                  ? 'Use restore if you cleared something by mistake.'
                  : 'New updates will appear here.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {unreadCount ? (
              <Button variant="secondary" onClick={markAllRead}>
                <CheckCheck className="h-4 w-4" />
                Mark all read
              </Button>
            ) : null}
            <Button
              variant="outline"
              className="border-rose-200/80 text-rose-700 hover:border-rose-300 hover:bg-rose-50/80"
              onClick={clearAll}
              disabled={!notifications.length}
            >
              <Trash2 className="h-4 w-4" />
              Clear inbox
            </Button>
            {hasRestoreSnapshot ? (
              <Button variant="secondary" onClick={restoreLastClear}>
                <History className="h-4 w-4" />
                Restore last clear
              </Button>
            ) : null}
          </div>
        </div>
      </motion.section>

      {notifications.length ? (
        <motion.section
          key="notifications-list"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-[2.4rem] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(242,248,255,0.84))] px-5 py-6 shadow-[0_24px_54px_-36px_rgba(15,23,42,0.22)]"
        >
          <div className="pointer-events-none absolute inset-0">
            <div className="login-grid-drift absolute inset-0 opacity-12" />
            <div className="login-ambient-drift absolute right-[-4%] top-[-12%] h-44 w-44 rounded-full bg-sky-200/12 blur-3xl" />
            <div className="login-line-flow absolute inset-x-6 top-0 h-1 bg-gradient-to-r from-cyan-400 via-sky-500 to-emerald-400" />
          </div>

          <div className="relative space-y-5">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">
                Notification center
              </p>
              <p className="text-sm text-slate-500">Unread first.</p>
            </div>

            <div className="space-y-3">
              {notifications.map((notification, index) => {
                const meta = notificationMeta[notification.type]
                const Icon = meta.icon
                const isUnread = !notification.readAt

                return (
                  <motion.div
                    key={notification.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.03 }}
                  >
                    <Link
                      to={notification.relatedRoute}
                      onClick={() => {
                        if (isUnread) {
                          void markNotificationsRead(currentUserId, [notification.id])
                        }
                      }}
                      className={cn(
                        'group relative block overflow-hidden rounded-[1.7rem] border px-5 py-5 transition-all duration-300',
                        'before:absolute before:bottom-5 before:left-0 before:top-5 before:w-1 before:rounded-full before:content-[""]',
                        isUnread
                          ? cn(
                              'border-cyan-200/75 bg-[linear-gradient(145deg,rgba(255,255,255,0.94),rgba(241,249,255,0.9),rgba(236,253,248,0.72))] shadow-[0_18px_34px_-26px_rgba(14,165,233,0.24)] hover:-translate-y-0.5 hover:shadow-[0_22px_38px_-28px_rgba(14,165,233,0.28)]',
                              meta.unreadTone,
                            )
                          : 'border-slate-200/75 bg-white/82 hover:border-sky-200/75 hover:bg-white/92',
                      )}
                    >
                      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[44px_minmax(0,1fr)_170px] lg:items-start">
                        <div
                          className={cn(
                            'flex h-11 w-11 items-center justify-center rounded-[1.1rem] shadow-[0_14px_24px_-18px_rgba(15,23,42,0.18)]',
                            meta.iconTone,
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </div>

                        <div className="min-w-0 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={cn(
                                'rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]',
                                meta.chipTone,
                              )}
                            >
                              {meta.label}
                            </span>
                            {isUnread ? (
                              <span className="rounded-full bg-slate-950 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white">
                                Unread
                              </span>
                            ) : null}
                          </div>
                          <p className="text-base font-semibold text-slate-950">
                            {notification.title}
                          </p>
                          <p className="max-w-3xl text-sm leading-6 text-slate-600">
                            {notification.message}
                          </p>
                        </div>

                        <div className="flex items-center justify-between gap-4 lg:flex-col lg:items-end lg:text-right">
                          <div className="space-y-1">
                            <p className="text-sm font-medium text-slate-700">
                              {formatTimestamp(notification.createdAt)}
                            </p>
                            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                              {notification.readAt ? 'Read' : 'Unread'}
                            </p>
                          </div>
                          <span className="inline-flex items-center gap-1 text-sm font-medium text-sky-700 transition-transform duration-300 group-hover:translate-x-0.5">
                            Open
                            <ChevronRight className="h-4 w-4" />
                          </span>
                        </div>
                      </div>
                    </Link>
                  </motion.div>
                )
              })}
            </div>
          </div>
        </motion.section>
      ) : (
        <motion.section
          key="notifications-empty"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-[2rem] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(242,248,255,0.84))] px-5 py-5 shadow-[0_20px_42px_-34px_rgba(15,23,42,0.18)]"
        >
          <div className="pointer-events-none absolute inset-0">
            <div className="login-ambient-drift absolute right-[12%] top-[-30%] h-28 w-28 rounded-full bg-sky-200/14 blur-3xl" />
            <div className="login-line-flow absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-sky-300/70 to-transparent" />
          </div>

          <div className="relative flex flex-col gap-4 rounded-[1.7rem] border border-dashed border-sky-100/90 bg-white/68 px-6 py-8 text-center text-slate-500 md:flex-row md:items-center md:justify-between md:text-left">
            <div className="flex items-center justify-center md:justify-start">
              <div className="flex h-11 w-11 items-center justify-center rounded-[1rem] bg-sky-50 text-sky-600 ring-1 ring-sky-100/90">
                <Bell className="h-5 w-5" />
              </div>
            </div>

            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-sm font-medium text-slate-700">No notifications.</p>
              <p className="text-sm leading-6 text-slate-500">
                {hasRestoreSnapshot
                  ? 'Your last cleared notifications can still be restored.'
                  : 'New updates will appear here.'}
              </p>
            </div>

            <div className="flex justify-center md:justify-end">
              {hasRestoreSnapshot ? (
                <Button variant="secondary" onClick={restoreLastClear}>
                  <RotateCcw className="h-4 w-4" />
                  Restore last clear
                </Button>
              ) : null}
            </div>
          </div>
        </motion.section>
      )}
    </div>
  )
}
