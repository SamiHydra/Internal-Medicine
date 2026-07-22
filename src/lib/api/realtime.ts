import Echo from 'laravel-echo'
import Pusher from 'pusher-js'

type ReverbConfig = {
  key: string | null
  host: string
  port: number
  scheme: 'http' | 'https'
}

const reverbConfig: ReverbConfig = {
  key: (import.meta.env.VITE_REVERB_APP_KEY as string | undefined)?.trim() || null,
  host: (import.meta.env.VITE_REVERB_HOST as string | undefined)?.trim() || window.location.hostname,
  port: Number(import.meta.env.VITE_REVERB_PORT ?? 8080),
  scheme: (import.meta.env.VITE_REVERB_SCHEME as 'http' | 'https' | undefined) ?? 'http',
}

let echo: Echo<'reverb'> | null | undefined

export function getEchoClient() {
  if (!reverbConfig.key) {
    return null
  }

  if (echo !== undefined) {
    return echo
  }

  window.Pusher = Pusher
  echo = new Echo({
    broadcaster: 'reverb',
    key: reverbConfig.key,
    wsHost: reverbConfig.host,
    wsPort: reverbConfig.port,
    wssPort: reverbConfig.port,
    forceTLS: reverbConfig.scheme === 'https',
    enabledTransports: ['ws', 'wss'],
    authEndpoint: '/broadcasting/auth',
    withCredentials: true,
  })

  return echo
}
