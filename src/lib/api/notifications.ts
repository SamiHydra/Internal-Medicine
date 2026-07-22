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

  await client.patch('/api/notifications/read', { ids: notificationIds })
}

export async function clearNotifications(
  client: LaravelApiClient,
  _userId: string,
  notificationIds: string[],
) {
  if (!notificationIds.length) {
    return
  }

  await client.delete('/api/notifications', { ids: notificationIds })
}

export async function restoreNotifications(
  client: LaravelApiClient,
  notifications: NotificationItem[],
) {
  if (!notifications.length) {
    return
  }

  await client.post('/api/notifications/restore', { notifications })
}
