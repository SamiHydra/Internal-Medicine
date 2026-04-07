import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { isSupabaseConfigured, supabaseEnv } from '@/lib/supabase/env'

let browserClient: SupabaseClient | null = null

function getAuthStorageBucket(key: string) {
  return /code-verifier/i.test(key) ? window.localStorage : window.sessionStorage
}

function createScopedAuthStorageAdapter() {
  return {
    getItem(key: string) {
      return getAuthStorageBucket(key).getItem(key)
    },
    setItem(key: string, value: string) {
      getAuthStorageBucket(key).setItem(key, value)
    },
    removeItem(key: string) {
      getAuthStorageBucket(key).removeItem(key)
    },
  }
}

export function createEphemeralSupabaseClient() {
  if (!isSupabaseConfigured) {
    return null
  }

  return createClient(supabaseEnv.url!, supabaseEnv.anonKey!, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
  })
}

export function getSupabaseBrowserClient() {
  if (!isSupabaseConfigured) {
    return null
  }

  if (!browserClient) {
    browserClient = createClient(supabaseEnv.url!, supabaseEnv.anonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
        storage: createScopedAuthStorageAdapter(),
      },
    })
  }

  return browserClient
}

export const supabase = getSupabaseBrowserClient()

export { isSupabaseConfigured } from '@/lib/supabase/env'
