import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { fetchMorningAnalytics, fetchTeachingAnalytics } = vi.hoisted(() => ({
  fetchMorningAnalytics: vi.fn(),
  fetchTeachingAnalytics: vi.fn(),
}))

vi.mock('@/lib/api/client', () => ({
  getApiBrowserClient: () => ({}),
}))

vi.mock('@/lib/api/academic-operations', () => ({
  fetchMorningAnalytics,
  fetchTeachingAnalytics,
  fetchStudentAnalytics: vi.fn(),
}))

vi.mock('recharts', () => ({
  Bar: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => null,
  Cell: () => null,
  Legend: () => null,
  ReferenceLine: () => null,
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}))

import {
  MorningAnalyticsTab,
  TeachingAnalyticsTab,
} from '@/components/admin/academic-operations-tabs'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('MorningAnalyticsTab', () => {
  it('uses the query cache when the tab is revisited', async () => {
    fetchMorningAnalytics.mockResolvedValue({
      recordedCount: 2,
      notRecordedCount: 1,
      cancelledCount: 0,
      onTimeRate: 50,
      avgDelayMinutes: 10,
      trend: [],
      people: [],
      window: {
        type: 'latest_sessions',
        limit: 60,
        sessionCount: 3,
        fromDate: '2026-09-07',
        toDate: '2026-09-11',
      },
    })

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
    })
    const first = render(
      <QueryClientProvider client={queryClient}>
        <MorningAnalyticsTab />
      </QueryClientProvider>,
    )

    expect(await screen.findByText('50%')).toBeInTheDocument()
    first.unmount()

    render(
      <QueryClientProvider client={queryClient}>
        <MorningAnalyticsTab />
      </QueryClientProvider>,
    )

    expect(await screen.findByText('50%')).toBeInTheDocument()
    expect(fetchMorningAnalytics).toHaveBeenCalledTimes(1)
  })

  it('shows a safe error state for an invalid response', async () => {
    fetchMorningAnalytics.mockRejectedValue(new Error('Invalid response'))
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <MorningAnalyticsTab />
      </QueryClientProvider>,
    )

    expect(await screen.findByText('Unable to load analytics')).toBeInTheDocument()
  })
})

describe('TeachingAnalyticsTab', () => {
  it('identifies the block on every missed teaching activity', async () => {
    const occurrence = {
      held: 1,
      notHeld: 1,
      cancelled: 0,
      pending: 0,
      heldRate: 50,
    }
    const missedSession = {
      id: 'session-1',
      batchId: 'block-1',
      batchLabel: 'C1 Block 2',
      activityType: 'lecture',
      subgroup: null,
      scheduledDate: '2026-09-10',
      reason: 'Lecturer unavailable',
    }
    fetchTeachingAnalytics.mockResolvedValue({
      byActivity: [{ activityType: 'lecture', ...occurrence }],
      byBatch: [{ batchId: 'block-1', batchLabel: 'C1 Block 2', ...occurrence }],
      blocks: [{
        batchId: 'block-1',
        batchLabel: 'C1 Block 2',
        cohort: 'C1',
        startsOn: '2026-09-01',
        endsOn: '2026-12-06',
        active: true,
        ...occurrence,
        byActivity: [{ activityType: 'lecture', ...occurrence }],
        reasons: [{ reason: 'Lecturer unavailable', count: 1 }],
        missedSessions: [missedSession],
        pendingBacklog: 0,
      }],
      reasons: [{ reason: 'Lecturer unavailable', count: 1 }],
      missedSessions: [missedSession],
      pendingBacklog: 0,
    })
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <TeachingAnalyticsTab />
      </QueryClientProvider>,
    )

    expect(await screen.findByText('Which block missed an activity')).toBeInTheDocument()
    expect(screen.getAllByText('C1 Block 2').length).toBeGreaterThan(0)
    expect(screen.getByText('Lecturer unavailable')).toBeInTheDocument()
  })
})
