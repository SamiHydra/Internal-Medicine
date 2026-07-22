const rawApiBaseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined

export const apiEnv = {
  baseUrl: rawApiBaseUrl?.trim().replace(/\/+$/, '') || null,
}

export const missingApiEnvKeys = apiEnv.baseUrl ? [] : ['VITE_API_BASE_URL']

export const isApiConfigured = missingApiEnvKeys.length === 0

export const apiEnvSetupHint =
  'Set VITE_API_BASE_URL to the Laravel backend origin, for example http://127.0.0.1:8000, then restart the Vite dev server.'

if (!isApiConfigured) {
  console.warn(
    `[Internal Medicine] Missing Laravel API env vars: ${missingApiEnvKeys.join(', ')}. ${apiEnvSetupHint}`,
  )
}
