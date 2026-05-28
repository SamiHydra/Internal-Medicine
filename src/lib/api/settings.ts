import type { LaravelApiClient } from '@/lib/api/client'
import type { SettingsResponse } from '@/lib/api/types'
import type { AppSettings } from '@/types/domain'

export async function updateAppSettings(
  client: LaravelApiClient,
  settings: Partial<AppSettings>,
) {
  await client.patch<SettingsResponse>('/api/admin/settings', settings)
}
