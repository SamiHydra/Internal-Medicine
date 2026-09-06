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

export async function restoreNotifications(
  client: LaravelApiClient,
  notifications: NotificationItem[],
) {
  if (!notifications.length) {
    return
  }

  return client.post<{ restored: number; data: NotificationItem[] }>(
    '/api/notifications/restore',
    { notifications },
  )
}
