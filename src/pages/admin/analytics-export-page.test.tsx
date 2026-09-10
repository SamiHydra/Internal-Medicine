import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { toastError, apiClient } = vi.hoisted(() => ({
  toastError: vi.fn(),
  // Must be stable: the real getApiBrowserClient memoises, and the page's
  // effects key off the client, so a fresh object per render would restart the
  // debounced scope fetch forever.
  apiClient: { baseUrl: 'http://127.0.0.1:8000' },
}))

vi.mock('sonner', () => ({
  toast: { error: toastError, success: vi.fn() },
}))

const { fetchAnalyticsExportScope, fetchAnalyticsExports, queueAnalyticsExport } = vi.hoisted(() => ({
  fetchAnalyticsExportScope: vi.fn(),
  fetchAnalyticsExports: vi.fn(),
  queueAnalyticsExport: vi.fn(),
}))

vi.mock('@/lib/api/client', () => ({
  getApiBrowserClient: () => apiClient,
}))

vi.mock('@/lib/api/analytics', () => ({
  fetchAnalyticsExportScope,
  fetchAnalyticsExports,
  queueAnalyticsExport,
}))

import { AnalyticsExportPage } from '@/pages/admin/analytics-export-page'

const queued = {
  id: 'export-1',
  status: 'pending' as const,
  format: 'xlsx' as const,
  fileName: null,
  rowCount: 0,
  byteSize: null,
  error: null,
  createdAt: '2026-09-04T09:00:00.000000Z',
  completedAt: null,
  expiresAt: null,
  downloadUrl: null,
}

function setup(scope = { reports: 120, limit: 5000 }) {
  fetchAnalyticsExports.mockResolvedValue([])
  fetchAnalyticsExportScope.mockResolvedValue(scope)
  queueAnalyticsExport.mockResolvedValue(queued)
  return userEvent.setup()
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('analytics export page', () => {
  it('sends the chosen wards and range', async () => {
    const user = setup()
    render(<AnalyticsExportPage />)

    // Two wards are called Cardiac; the family tells them apart.
    await user.click(screen.getByRole('checkbox', { name: /cardiac inpatient/i }))
    await user.type(screen.getByLabelText('From'), '2026-01-01')
    await user.type(screen.getByLabelText('To'), '2026-03-31')
    await user.click(screen.getByRole('button', { name: /build export/i }))

    await waitFor(() => expect(queueAnalyticsExport).toHaveBeenCalledWith(
      expect.anything(),
      {
        format: 'xlsx',
        departments: ['cardiac_inpatient'],
        dateFrom: '2026-01-01',
        dateTo: '2026-03-31',
      },
    ))
  })

  it('exports every ward when none is picked', async () => {
    const user = setup()
    render(<AnalyticsExportPage />)

    await user.click(screen.getByRole('button', { name: /build export/i }))

    await waitFor(() => expect(queueAnalyticsExport).toHaveBeenCalledWith(
      expect.anything(),
      { format: 'xlsx', departments: [], dateFrom: null, dateTo: null },
    ))
  })

  it('shows how many reports the selection covers', async () => {
    setup({ reports: 1479, limit: 5000 })
    render(<AnalyticsExportPage />)

    expect(await screen.findByText('1,479')).toBeTruthy()
  })

  it('blocks the build when the selection is over the ceiling', async () => {
    const user = setup({ reports: 9000, limit: 5000 })
    render(<AnalyticsExportPage />)

    await waitFor(() => expect(screen.getByText(/over the 5,000-report limit/i)).toBeTruthy())
    expect(screen.getByRole('button', { name: /build export/i })).toHaveProperty('disabled', true)

    await user.click(screen.getByRole('button', { name: /build export/i }))
    expect(queueAnalyticsExport).not.toHaveBeenCalled()
  })

  it('blocks the build when nothing was submitted in range', async () => {
    setup({ reports: 0, limit: 5000 })
    render(<AnalyticsExportPage />)

    await waitFor(() => expect(screen.getByText(/nothing was submitted/i)).toBeTruthy())
    expect(screen.getByRole('button', { name: /build export/i })).toHaveProperty('disabled', true)
  })

  it('surfaces the server message when a queue attempt is refused', async () => {
    const user = setup()
    queueAnalyticsExport.mockRejectedValue(
      new Error('That range covers 9,000 reports, over the 5,000 limit.'),
    )
    render(<AnalyticsExportPage />)

    await user.click(screen.getByRole('button', { name: /build export/i }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(
      'That range covers 9,000 reports, over the 5,000 limit.',
    ))
  })

  it('selects and clears a whole service line at once', async () => {
    const user = setup()
    render(<AnalyticsExportPage />)

    const inpatientGroup = screen.getAllByRole('button', { name: /select group/i })[0]
    await user.click(inpatientGroup)
    await user.click(screen.getByRole('button', { name: /build export/i }))

    await waitFor(() => expect(queueAnalyticsExport).toHaveBeenCalled())
    const sent = queueAnalyticsExport.mock.calls[0][1].departments as string[]
    expect(sent.length).toBeGreaterThan(1)
    expect(sent).toContain('cardiac_inpatient')
  })
})
