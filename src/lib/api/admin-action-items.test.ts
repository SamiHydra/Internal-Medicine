import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  fetchActionItem,
  fetchActionItems,
  fetchClinicalAlertRules,
  uploadActionItemEvidence,
} from '@/lib/api/admin'
import { LaravelApiClient } from '@/lib/api/client'
import type { ActionItem, ActionItemSummary } from '@/lib/api/types'

const summary: ActionItemSummary = {
  open: 2, assigned: 1, inProgress: 3, outstanding: 6, highSeverity: 4,
  overdue: 2, oldestOpenedAt: null, averageResolutionHours: 8.5, byDepartment: [],
}

describe('clinical action-item API', () => {
  const originalFetch = globalThis.fetch
  let fetchMock: ReturnType<typeof vi.fn>
  let client: LaravelApiClient

  beforeEach(() => {
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch
    client = new LaravelApiClient('http://127.0.0.1:8000')
  })

  afterEach(() => { globalThis.fetch = originalFetch })

  it('sends bounded leadership filters and preserves pagination metadata', async () => {
    fetchMock.mockResolvedValueOnce({ status: 200, ok: true, text: async () => JSON.stringify({
      data: [], meta: { openCount: 2, summary, currentPage: 2, lastPage: 4, total: 76 },
    }) })

    const result = await fetchActionItems(client, {
      status: 'outstanding', severity: 'high', departmentId: 'department-1',
      overdue: true, search: 'infection', page: 2, perPage: 25,
    })
    const url = decodeURIComponent(String(fetchMock.mock.calls[0][0]))
    expect(url).toContain('status=outstanding')
    expect(url).toContain('severity=high')
    expect(url).toContain('department_id=department-1')
    expect(url).toContain('overdue=1')
    expect(url).toContain('search=infection')
    expect(result.summary.outstanding).toBe(6)
    expect(result.lastPage).toBe(4)
  })

  it('loads complete action detail and governed rule options', async () => {
    fetchMock
      .mockResolvedValueOnce({ status: 200, ok: true, text: async () => JSON.stringify({ id: 'action-1', history: [], comments: [], evidence: [] } satisfies Partial<ActionItem>) })
      .mockResolvedValueOnce({ status: 200, ok: true, text: async () => JSON.stringify({ data: [{ id: 'rule-1' }], options: [{ id: 'template-1', fields: [] }] }) })

    const detail = await fetchActionItem(client, 'action-1')
    const rules = await fetchClinicalAlertRules(client)
    expect(detail.history).toEqual([])
    expect(rules.rules).toHaveLength(1)
    expect(rules.templates).toHaveLength(1)
  })

  it('uploads evidence as multipart data without forcing a JSON content type', async () => {
    fetchMock
      .mockResolvedValueOnce({ status: 204, ok: true, text: async () => '' })
      .mockResolvedValueOnce({ status: 201, ok: true, text: async () => JSON.stringify({ id: 'evidence-1' }) })
    const file = new File(['evidence'], 'review.txt', { type: 'text/plain' })

    await uploadActionItemEvidence(client, 'action-1', file)
    const request = fetchMock.mock.calls[1][1] as RequestInit
    expect(request.body).toBeInstanceOf(FormData)
    expect(new Headers(request.headers).has('Content-Type')).toBe(false)
  })
})
