import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { fetchActionItem, fetchActionItems } = vi.hoisted(() => ({
  fetchActionItem: vi.fn(),
  fetchActionItems: vi.fn(),
}))

vi.mock('@/lib/api/client', () => ({
  getApiBrowserClient: () => ({}),
}))

vi.mock('@/lib/api/admin', () => ({
  fetchActionItem,
  fetchActionItems,
}))

vi.mock('@/context/app-data-context', () => ({
  useAppData: () => ({
    state: { profiles: [] },
    ensureProfileDirectoryData: vi.fn(),
  }),
}))

vi.mock('@/components/action-items/alert-rules-panel', () => ({
  AlertRulesPanel: () => null,
}))

// Stand in for the real sheet so the assertions are about what the page opened.
vi.mock('@/components/action-items/action-item-sheet', () => ({
  ActionItemSheet: ({ open, item }: { open: boolean; item: { id: string } | null }) =>
    open ? <div data-testid="sheet">{item?.id ?? 'loading'}</div> : null,
}))

import { ActionItemsPage } from '@/pages/admin/action-items-page'

const summary = { open: 1, assigned: 0, inProgress: 0, outstanding: 1, highSeverity: 1, overdue: 0 }

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ActionItemsPage />
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('action items deep link', () => {
  it('opens the item named by ?item= without the operator hunting for it', async () => {
    fetchActionItems.mockResolvedValue({ items: [], summary, lastPage: 1, total: 0 })
    fetchActionItem.mockResolvedValue({ id: 'item-1', title: 'Critical values in Cardiac', status: 'open' })

    renderAt('/admin/action-items?item=item-1')

    await waitFor(() => expect(screen.getByTestId('sheet')).toHaveTextContent('item-1'))
    expect(fetchActionItem).toHaveBeenCalledWith(expect.anything(), 'item-1')
  })

  it('widens the status filter so an already-resolved item is still listed', async () => {
    fetchActionItems.mockResolvedValue({ items: [], summary, lastPage: 1, total: 0 })
    fetchActionItem.mockResolvedValue({ id: 'item-1', title: 'Resolved item', status: 'resolved' })

    renderAt('/admin/action-items?item=item-1')

    await waitFor(() => expect(fetchActionItems).toHaveBeenCalled())
    await waitFor(() =>
      expect(fetchActionItems).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ status: 'all' }),
      ),
    )
  })

  it('leaves the sheet shut when no item is requested', async () => {
    fetchActionItems.mockResolvedValue({ items: [], summary, lastPage: 1, total: 0 })

    renderAt('/admin/action-items')

    await waitFor(() => expect(fetchActionItems).toHaveBeenCalled())
    expect(screen.queryByTestId('sheet')).toBeNull()
    expect(fetchActionItem).not.toHaveBeenCalled()
  })
})
