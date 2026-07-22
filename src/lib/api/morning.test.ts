import { describe, expect, it, vi } from 'vitest'

import { LaravelApiClient } from '@/lib/api/client'
import { updateMorningSessionTime } from '@/lib/api/morning'

describe('morning-session settings API', () => {
  it('sends the admin-selected start time to the settings endpoint', async () => {
    const client = new LaravelApiClient('http://127.0.0.1:8000')
    const patch = vi.spyOn(client, 'patch').mockResolvedValue({})

    await updateMorningSessionTime(client, '07:30')

    expect(patch).toHaveBeenCalledWith('/api/admin/settings', {
      morningSessionTime: '07:30',
    })
  })
})
