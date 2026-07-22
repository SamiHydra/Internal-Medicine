import { afterEach, describe, expect, it } from 'vitest'

import { clearAuthenticatedQueryCache, queryClient } from '@/lib/query-client'

describe('authenticated query cache isolation', () => {
  afterEach(() => {
    queryClient.clear()
  })

  it('removes cached server state after logout or session expiry before another account can sign in', () => {
    queryClient.setQueryData(['academic-operations', 'morning'], {
      people: [{ id: 'private-person-id' }],
    })
    queryClient.getMutationCache().build(queryClient, {
      mutationKey: ['academic-operations', 'update'],
      mutationFn: async () => undefined,
    })

    expect(queryClient.getQueryCache().getAll()).toHaveLength(1)
    expect(queryClient.getMutationCache().getAll()).toHaveLength(1)

    clearAuthenticatedQueryCache()

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0)
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
  })
})
