import {
  differenceInCalendarDays,
  differenceInHours,
  differenceInMinutes,
  format,
  isToday,
  isYesterday,
  parseISO,
} from 'date-fns'
import { motion } from 'framer-motion'
import {
  Bell,
  CheckCheck,
  CheckCircle2,
  Download,
  FileLock2,
  PencilLine,
  RotateCcw,
  ShieldAlert,
  Siren,
  Trash2,
  TriangleAlert,
  UserRoundPlus,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { useAppData } from '@/context/app-data-context'
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

/** Short, glanceable timestamp: "Just now", "5m", "3h", "Yesterday", "Apr 12". */
function relativeTime(iso: string): string {
  const date = parseISO(iso)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  const now = new Date()
  const minutes = differenceInMinutes(now, date)
  if (minutes < 1) {
    return 'Just now'
  }
  if (minutes < 60) {
    return `${minutes}m`
  }
  if (isToday(date)) {
    return `${differenceInHours(now, date)}h`
  }
  if (isYesterday(date)) {
    return 'Yesterday'
  }
  const days = differenceInCalendarDays(now, date)
  if (days < 7) {
    return `${days}d`
  }
  return format(date, 'MMM d')
}

const groupOrder = ['Today', 'Yesterday', 'This week', 'Earlier', 'Older'] as const
type GroupLabel = (typeof groupOrder)[number]

function dayGroup(iso: string): GroupLabel {
  const date = parseISO(iso)
  if (Number.isNaN(date.getTime())) {
    return 'Older'
  }
  if (isToday(date)) {
    return 'Today'
  }
  if (isYesterday(date)) {
    return 'Yesterday'
  }
  const days = differenceInCalendarDays(new Date(), date)
  if (days < 7) {
    return 'This week'
  }
  if (days < 30) {
    return 'Earlier'
  }
  return 'Older'
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
    iconTone: 'bg-[#fceeee] text-[#ba1a1a]',
    chipTone: 'border-[#f3cccc] bg-[#fceeee] text-[#ba1a1a]',
  },
  analytics_export_ready: {
    label: 'Export ready',
    icon: Download,
    iconTone: 'bg-[#edf7f0] text-[#1f6b3b]',
    chipTone: 'border-[#cfe7d9] bg-[#edf7f0] text-[#1f6b3b]',
  },
  nurse_access_request: {
    label: 'Access request',
    icon: UserRoundPlus,
    iconTone: 'bg-[#edf4fb] text-[#005db6]',
    chipTone: 'border-[#cfe0f4] bg-[#edf4fb] text-[#005db6]',
  },
  admin_access_request: {
    label: 'Account request',
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
  critical_value_alert: {
    label: 'Critical',
    icon: Siren,
    iconTone: 'bg-[#fceeee] text-[#ba1a1a]',
    chipTone: 'border-[#f3cccc] bg-[#fceeee] text-[#ba1a1a]',
  },
  critical_value_corrected: {
    label: 'Correction',
    icon: ShieldAlert,
    iconTone: 'bg-[#fbf4e6] text-[#8a5a00]',
    chipTone: 'border-[#f0d9aa] bg-[#fbf4e6] text-[#8a5a00]',
  },
  action_item_assigned: {
    label: 'Assigned',
    icon: UserRoundPlus,
    iconTone: 'bg-[#edf4fb] text-[#005db6]',
    chipTone: 'border-[#cfe0f4] bg-[#edf4fb] text-[#005db6]',
  },
  action_item_overdue: {
    label: 'Action overdue',
    icon: Siren,
    iconTone: 'bg-[#fceeee] text-[#ba1a1a]',
    chipTone: 'border-[#f3cccc] bg-[#fceeee] text-[#ba1a1a]',
  },
  trend_alert: {
    label: 'Trend',
    icon: TriangleAlert,
    iconTone: 'bg-[#fbf4e6] text-[#8a5a00]',
    chipTone: 'border-[#f0d9aa] bg-[#fbf4e6] text-[#8a5a00]',
  },
}

const fallbackMeta = {
  label: 'Update',
  icon: Bell,
  iconTone: 'bg-[#edf1f5] text-[#1d3047]',
  chipTone: 'border-[#d4dde8] bg-[#edf1f5] text-[#1d3047]',
}

function NotificationRow({
  notification,
  onOpen,
}: {
  notification: NotificationItem
  onOpen: () => void
}) {
  const meta = notificationMeta[notification.type] ?? fallbackMeta
  const Icon = meta.icon
  const isUnread = !notification.readAt

  return (
    <Link
      to={notification.relatedRoute}
      onClick={onOpen}
      className={cn(
        'group flex gap-3 rounded-[0.6rem] border p-3 transition-[transform,border-color,background-color] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-safe:active:scale-[0.99] sm:p-3.5',
        isUnread
          ? 'border-[#cfe0f4] bg-[#f6fbff] hover:border-[#b8cfe9] hover:bg-white'
          : 'border-[#e9eef4] bg-white hover:border-[#cdd9e8] hover:bg-[#f8fafc]',
      )}
    >
      <span
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-[0.5rem]',
          meta.iconTone,
        )}
      >
        <Icon className="h-[1.15rem] w-[1.15rem]" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 flex-1 truncate text-[0.95rem] font-semibold text-[#000a1e]">
            {notification.title}
          </p>
          <span className="mt-0.5 flex shrink-0 items-center gap-1.5">
            <span className="text-[11px] font-medium tabular-nums text-[#69727d]">
              {relativeTime(notification.createdAt)}
            </span>
            {isUnread ? (
              <>
                <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#005db6]" />
                <span className="sr-only">Unread</span>
              </>
            ) : null}
          </span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-sm leading-5 text-[#5b6169]">
          {notification.message}
        </p>
        <span
          className={cn(
            'mt-2 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em]',
            meta.chipTone,
          )}
        >
          {meta.label}
        </span>
      </div>
    </Link>
  )
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
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  // The inbox action in flight. The three bulk actions only update local state
  // once the server answers, so without this a second click (a double-click,
  // or a click while a slow answer is pending) sent the same request again.
  const [pendingAction, setPendingAction] = useState<'read' | 'clear' | 'restore' | null>(null)
  const currentUserId = currentUser?.id ?? ''

  const notifications = useMemo(
    () =>
      [...state.notifications]
        .filter((notification) => notification.userId === currentUserId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [state.notifications, currentUserId],
  )

  const unreadNotifications = notifications.filter((notification) => !notification.readAt)
  const unreadCount = unreadNotifications.length
  const totalCount = notifications.length

  const visible = filter === 'unread' ? unreadNotifications : notifications
  const groups = useMemo(
    () =>
      groupOrder
        .map((label) => ({
          label,
          items: visible.filter((notification) => dayGroup(notification.createdAt) === label),
        }))
        .filter((group) => group.items.length > 0),
    [visible],
  )

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

  const runInboxAction = async (
    action: 'read' | 'clear' | 'restore',
    run: () => Promise<void>,
  ) => {
    if (pendingAction) {
      return
    }

    setPendingAction(action)
    try {
      await run()
    } finally {
      setPendingAction(null)
    }
  }

  const markAllRead = () =>
    void runInboxAction('read', () =>
      markNotificationsRead(
        currentUserId,
        unreadNotifications.map((notification) => notification.id),
      ),
    )

  const clearAll = () => {
    if (!notifications.length) {
      return
    }

    return void runInboxAction('clear', () => {
      setLastClearedNotifications(notifications)
      writeClearedNotificationsSnapshot(notifications)
      scrollNotificationsToTop()

      return clearNotifications(
        currentUserId,
        notifications.map((notification) => notification.id),
      )
    })
  }

  const restoreLastClear = () => {
    scrollNotificationsToTop()
    return void runInboxAction('restore', () => restoreNotifications(effectiveRestoreSnapshot))
  }

  if (!currentUser) {
    return null
  }

  const segments = [
    { value: 'all' as const, label: 'All', count: totalCount },
    { value: 'unread' as const, label: 'Unread', count: unreadCount },
  ]

  return (
    <div className="px-4 py-5 md:px-6 md:py-8">
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="rounded-[0.35rem] bg-white px-4 py-5 outline outline-1 outline-[#d4dde8] shadow-[0_24px_60px_-42px_rgba(0,33,71,0.28)] sm:px-5 sm:py-6 md:px-6 md:py-7"
      >
        {/* Header */}
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#005db6]">
          Inbox
        </p>
        <h2 className="mt-1 font-display text-[1.4rem] font-bold tracking-[-0.02em] text-[#000a1e] md:text-[1.6rem]">
          Recent activity
        </h2>

        {/* Filter + bulk actions */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-b border-[#eef2f6] pb-4">
          <div className="inline-flex w-fit flex-wrap gap-1.5 rounded-[0.35rem] bg-white p-1.5 outline outline-1 outline-[#d4dde8]">
            {segments.map((segment) => {
              const active = filter === segment.value
              return (
                <button
                  key={segment.value}
                  type="button"
                  onClick={() => setFilter(segment.value)}
                  aria-pressed={active}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-[0.25rem] px-3.5 py-2 text-sm font-semibold transition-colors',
                    active
                      ? 'bg-[#04162f] text-white'
                      : 'text-[#44474e] hover:bg-[#eef2f6]',
                  )}
                >
                  {segment.label}
                  <span
                    className={cn(
                      'rounded-[0.2rem] px-1.5 text-[10px] font-bold tabular-nums',
                      active
                        ? 'bg-white/15 text-white'
                        : 'bg-[#e7edf4] text-[#666970]',
                    )}
                  >
                    {segment.count}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="flex items-center gap-2">
            {unreadCount ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={markAllRead}
                disabled={pendingAction !== null}
              >
                <CheckCheck className="h-4 w-4" />
                Mark all read
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              className="text-[#ba1a1a] hover:bg-[#fceeee] hover:text-[#93000a]"
              onClick={clearAll}
              disabled={!notifications.length || pendingAction !== null}
              aria-label="Clear inbox"
            >
              <Trash2 className="h-4 w-4" />
              <span className="hidden sm:inline">Clear</span>
            </Button>
          </div>
        </div>

        {/* Restore banner */}
        {hasRestoreSnapshot ? (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-[0.5rem] border border-[#cfe0f4] bg-[#f6fbff] px-3.5 py-2.5">
            <p className="min-w-0 text-[13px] text-[#1d3047]">
              Cleared notifications can still be restored.
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="shrink-0"
              onClick={restoreLastClear}
              disabled={pendingAction !== null}
            >
              <RotateCcw className="h-4 w-4" />
              Restore
            </Button>
          </div>
        ) : null}

        {/* List */}
        {groups.length ? (
          <div className="mt-5 space-y-5">
            {groups.map((group) => (
              <div key={group.label} className="space-y-2">
                <div className="flex items-center gap-2 px-0.5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#666970]">
                    {group.label}
                  </p>
                  <span className="text-[11px] font-medium tabular-nums text-[#69727d]">
                    {group.items.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {group.items.map((notification, index) => (
                    <motion.div
                      key={notification.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        duration: 0.2,
                        ease: 'easeOut',
                        delay: Math.min(index * 0.02, 0.16),
                      }}
                    >
                      <NotificationRow
                        notification={notification}
                        onOpen={() => {
                          if (!notification.readAt) {
                            void markNotificationsRead(currentUserId, [notification.id])
                          }
                        }}
                      />
                    </motion.div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-5 flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-[0.5rem] border border-dashed border-[#d4dde8] bg-[#f8fafc] px-6 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#edf4fb] text-[#005db6]">
              {filter === 'unread' ? <CheckCheck className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
            </span>
            <p className="text-sm leading-6 text-[#5b6169]">
              {filter === 'unread'
                ? "You're all caught up."
                : 'New updates will appear here.'}
            </p>
          </div>
        )}
      </motion.section>
    </div>
  )
}
