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
  }
> = {
  new_report_submitted: {
    label: 'Submitted',
    icon: CheckCircle2,
    iconTone: 'bg-[#edf4fb] text-[#005db6]',
    chipTone: 'border-[#cfe0f4] bg-[#edf4fb] text-[#005db6]',
  },
  submitted_report_edited: {
    label: 'Edited',
    icon: PencilLine,
    iconTone: 'bg-[#fbf4e6] text-[#8a5a00]',
    chipTone: 'border-[#f0d9aa] bg-[#fbf4e6] text-[#8a5a00]',
  },
  report_locked: {
    label: 'Locked',
    icon: FileLock2,
    iconTone: 'bg-[#edf1f5] text-[#1d3047]',
    chipTone: 'border-[#d4dde8] bg-[#edf1f5] text-[#1d3047]',
  },
  report_unlocked: {
    label: 'Unlocked',
    icon: ShieldAlert,
    iconTone: 'bg-[#edf7f0] text-[#1f6b3b]',
    chipTone: 'border-[#cfe7d9] bg-[#edf7f0] text-[#1f6b3b]',
  },
  overdue_report: {
    label: 'Overdue',
    icon: TriangleAlert,
    iconTone: 'bg-[#fff1f1] text-[#9d2a2a]',
    chipTone: 'border-[#f1d1d1] bg-[#fff1f1] text-[#9d2a2a]',
  },
  nurse_access_request: {
    label: 'Access request',
    icon: UserRoundPlus,
    iconTone: 'bg-[#edf4fb] text-[#005db6]',
    chipTone: 'border-[#cfe0f4] bg-[#edf4fb] text-[#005db6]',
  },
  access_request_reviewed: {
    label: 'Reviewed',
    icon: CheckCheck,
    iconTone: 'bg-[#edf7f0] text-[#1f6b3b]',
    chipTone: 'border-[#cfe7d9] bg-[#edf7f0] text-[#1f6b3b]',
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
  const restoreSnapshotAlreadyApplied =
    restoreSnapshot.length > 0 &&
    restoreSnapshot.every((notification) =>
      state.notifications.some((entry) => entry.id === notification.id),
    )
  const effectiveRestoreSnapshot = restoreSnapshotAlreadyApplied ? [] : restoreSnapshot
  const hasRestoreSnapshot = effectiveRestoreSnapshot.length > 0
  const isEmptyInbox = !notifications.length
  const summaryItems = [
    {
      label: 'Unread',
      value: String(unreadCount),
      note: unreadCount ? 'Needs review' : 'All caught up',
      icon: Bell,
      tone: 'text-[#005db6] bg-[#edf4fb] outline-[#cfe0f4]/75',
    },
    {
      label: 'Total',
      value: String(totalCount),
      note: totalCount ? 'Current inbox' : 'No items',
      icon: CheckCheck,
      tone: 'text-[#1d3047] bg-[#edf1f5] outline-[#d4dde8]/75',
    },
    {
      label: 'Latest',
      value: latestNotification ? formatTimestamp(latestNotification.createdAt) : 'No items',
      note: latestNotification ? latestNotification.title : 'Inbox clear',
      icon: History,
      tone: 'text-[#00468c] bg-[#edf4fb] outline-[#cfe0f4]/75',
    },
    {
      label: 'Restore',
      value: hasRestoreSnapshot ? 'Available' : 'Clear',
      note: hasRestoreSnapshot
        ? `${effectiveRestoreSnapshot.length} items ready`
        : 'No cleared snapshot',
      icon: RotateCcw,
      tone: 'text-[#8a5a00] bg-[#fcf5e8] outline-[#edd9b0]/75',
    },
  ] as const

  useEffect(() => {
    if (!restoreSnapshotAlreadyApplied) {
      return
    }
    writeClearedNotificationsSnapshot([])
  }, [restoreSnapshotAlreadyApplied])

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
    return void restoreNotifications(effectiveRestoreSnapshot)
  }

  if (!currentUser) {
    return null
  }

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
                Notifications
              </p>
              <h1 className="font-display text-[2rem] leading-[0.96] tracking-[-0.03em] text-[#000a1e] md:text-[2.35rem]">
                Notification center
              </h1>
            </div>

            <div className="flex flex-wrap gap-3">
              {unreadCount ? (
                <Button
                  variant="secondary"
                  className="bg-[none] bg-[#ffffff] shadow-none"
                  onClick={markAllRead}
                >
                  <CheckCheck className="h-4 w-4" />
                  Mark all read
                </Button>
              ) : null}
              {hasRestoreSnapshot ? (
                <Button
                  variant="secondary"
                  className="bg-[none] bg-[#ffffff] shadow-none"
                  onClick={restoreLastClear}
                >
                  <History className="h-4 w-4" />
                  Restore last clear
                </Button>
              ) : null}
              <Button
                variant="outline"
                className="border-[#f1d1d1] bg-[#ffffff] text-[#9d2a2a] hover:bg-[#fff1f1]"
                onClick={clearAll}
                disabled={!notifications.length}
              >
                <Trash2 className="h-4 w-4" />
                Clear inbox
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
                  <p className="mt-3 break-words font-display text-[1.3rem] leading-[1.08] tracking-[-0.03em]">
                    {item.value}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-current/75">{item.note}</p>
                </div>
              )
            })}
          </div>
        </div>
      </motion.section>

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
                Inbox
              </p>
              <h2 className="font-display text-[1.85rem] text-[#000a1e]">Recent activity</h2>
            </div>
            <div className="inline-flex items-center gap-2 rounded-[0.25rem] border border-[#d4dde8] bg-[#ffffff] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#44474e]">
              <Bell className="h-4 w-4 text-[#005db6]" />
              {unreadCount ? `${unreadCount} unread` : `${totalCount} total`}
            </div>
          </div>

          {notifications.length ? (
            <div className="space-y-3">
              {notifications.map((notification, index) => {
                const meta = notificationMeta[notification.type]
                const Icon = meta.icon
                const isUnread = !notification.readAt

                return (
                  <motion.div
                    key={notification.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.22, ease: 'easeOut', delay: index * 0.02 }}
                  >
                    <Link
                      to={notification.relatedRoute}
                      onClick={() => {
                        if (isUnread) {
                          void markNotificationsRead(currentUserId, [notification.id])
                        }
                      }}
                      className={cn(
                        'group block rounded-[0.35rem] border p-5 transition-colors duration-200',
                        isUnread
                          ? 'border-[#cfe0f4] bg-[#f8fbff] hover:border-[#b8cfe9]'
                          : 'border-[#d4dde8] bg-[#ffffff] hover:border-[#c4d0dd] hover:bg-[#fbfcfd]',
                      )}
                    >
                      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[40px_minmax(0,1fr)_170px] lg:items-start">
                        <div
                          className={cn(
                            'flex h-10 w-10 items-center justify-center rounded-[0.25rem]',
                            meta.iconTone,
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </div>

                        <div className="min-w-0 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={cn(
                                'rounded-[0.25rem] border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em]',
                                meta.chipTone,
                              )}
                            >
                              {meta.label}
                            </span>
                            {isUnread ? (
                              <span className="rounded-[0.25rem] border border-[#000a1e] bg-[#000a1e] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white">
                                Unread
                              </span>
                            ) : null}
                          </div>
                          <p className="text-base font-semibold text-[#000a1e]">
                            {notification.title}
                          </p>
                          <p className="max-w-3xl text-sm leading-6 text-[#44474e]">
                            {notification.message}
                          </p>
                        </div>

                        <div className="flex items-center justify-between gap-4 lg:flex-col lg:items-end lg:text-right">
                          <div className="space-y-1">
                            <p className="text-sm font-medium text-[#1d3047]">
                              {formatTimestamp(notification.createdAt)}
                            </p>
                            <p className="text-xs uppercase tracking-[0.18em] text-[#74777f]">
                              {notification.readAt ? 'Read' : 'Unread'}
                            </p>
                          </div>
                          <span className="inline-flex items-center gap-1 text-sm font-medium text-[#005db6] transition-transform duration-200 group-hover:translate-x-0.5">
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
          ) : (
            <div className="flex min-h-[180px] flex-col items-center justify-center gap-3 rounded-[0.5rem] border border-dashed border-[#d4dde8] bg-[#ffffff] px-6 text-center text-[#74777f]">
              <Bell className="h-5 w-5 text-[#005db6]" />
              <p className="text-sm leading-6">
                {hasRestoreSnapshot
                  ? 'Your last cleared notifications can still be restored.'
                  : 'New updates will appear here.'}
              </p>
              {hasRestoreSnapshot ? (
                <Button
                  variant="secondary"
                  className="bg-[none] bg-[#ffffff] shadow-none"
                  onClick={restoreLastClear}
                >
                  <RotateCcw className="h-4 w-4" />
                  Restore last clear
                </Button>
              ) : null}
            </div>
          )}
        </div>
      </motion.section>
    </div>
  )
}
