const requiredEnvKeys = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] as const

type RequiredEnvKey = (typeof requiredEnvKeys)[number]

const rawEnvValues = {
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
} as const

function readEnvValue(key: RequiredEnvKey) {
  const value = rawEnvValues[key]
  return typeof value === 'string' && value.trim().length ? value.trim() : null
}

export const supabaseEnv = {
  url: readEnvValue('VITE_SUPABASE_URL'),
  anonKey: readEnvValue('VITE_SUPABASE_ANON_KEY'),
}

export const missingSupabaseEnvKeys = requiredEnvKeys.filter(
  (key) => !readEnvValue(key),
)

export const isSupabaseConfigured = missingSupabaseEnvKeys.length === 0

export const supabaseEnvSetupHint =
  'Copy .env.local.example to .env.local, then paste VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from Supabase Dashboard -> Project Settings -> API.'

if (import.meta.env.DEV && missingSupabaseEnvKeys.length > 0) {
  console.warn(
    `[Internal Medicine] Missing Supabase env vars: ${missingSupabaseEnvKeys.join(', ')}. ${supabaseEnvSetupHint}`,
  )
}
