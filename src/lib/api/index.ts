export * from '@/lib/api/academic'
export * from '@/lib/api/access-requests'
export * from '@/lib/api/admin'
export * from '@/lib/api/analytics'
export * from '@/lib/api/auth'
export * from '@/lib/api/client'
export * from '@/lib/api/env'
export * from '@/lib/api/helpers'
export * from '@/lib/api/notifications'
export * from '@/lib/api/passwords'
// NOTE: '@/lib/api/realtime' is intentionally NOT re-exported here. It statically
// imports laravel-echo + pusher-js (~40KB gz) for a Reverb feature that is not yet
// wired (getEchoClient has no callers). Re-exporting it from this barrel — which
// the app-data-context imports — forces those libs into the main bundle. Import
// '@/lib/api/realtime' directly (ideally via dynamic import) once realtime ships.
export * from '@/lib/api/reports'
export * from '@/lib/api/settings'
export * from '@/lib/api/types'
export * from '@/lib/api/workspace'
