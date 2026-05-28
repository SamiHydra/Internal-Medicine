import type { LaravelApiClient } from '@/lib/api/client'

export type AnalyticsQuery = Record<string, string | number | boolean | null | undefined>

export function fetchAnalytics<T>(
  client: LaravelApiClient,
  endpoint:
    | 'overview'
    | 'inpatient'
    | 'outpatient'
    | 'procedures'
    | 'weekly'
    | 'monthly'
    | 'departments'
    | 'wards',
  query?: AnalyticsQuery,
) {
  return client.get<T>(`/api/analytics/${endpoint}`, { query })
}
