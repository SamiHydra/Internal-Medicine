import type { LaravelApiClient } from '@/lib/api/client'
import type { NotificationItem } from '@/types/domain'

export async function updateNotificationReadState(
  client: LaravelApiClient,
  _userId: string,
  notificationIds: string[],
) {
  if (!notificationIds.length) {
    return
  }

  return client.patch<{ updated: number; data: NotificationItem[] }>(
    '/api/notifications/read',
    { ids: notificationIds },
  )
}

export async function clearNotifications(
  client: LaravelApiClient,
  _userId: string,
  notificationIds: string[],
) {
  if (!notificationIds.length) {
    return
  }

  return client.delete<{ deleted: number }>('/api/notifications', { ids: notificationIds })
}

/**
 * The restore endpoint validates at most this many notifications per call
 * (NotificationController::restore, `max:50`). A cleared inbox is often
 * larger, so the snapshot is sent in batches; one call with everything was
 * refused with a 422 and the "can still be restored" banner became a lie.
 */
const RESTORE_BATCH_SIZE = 50

export async function restoreNotifications(
  client: LaravelApiClient,
  notifications: NotificationItem[],
) {
  if (!notifications.length) {
    return
  }

  const result = { restored: 0, data: [] as NotificationItem[] }

  for (let start = 0; start < notifications.length; start += RESTORE_BATCH_SIZE) {
    const response = await client.post<{ restored: number; data: NotificationItem[] }>(
      '/api/notifications/restore',
      { notifications: notifications.slice(start, start + RESTORE_BATCH_SIZE) },
    )
    result.restored += response?.restored ?? 0
    result.data.push(...(response?.data ?? []))
  }

  return result
}
