import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { isSupabaseConfigured, supabaseEnv } from '@/lib/supabase/env'

let browserClient: SupabaseClient | null = null

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
      },
    })
  }

  return browserClient
}

export const supabase = getSupabaseBrowserClient()

export { isSupabaseConfigured } from '@/lib/supabase/env'
