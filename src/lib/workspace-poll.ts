export const WORKSPACE_POLL_INTERVAL_MS = 60_000
export const WORKSPACE_POLL_JITTER_MS = 15_000
export const WORKSPACE_HIDDEN_BACKOFF_MS = 5 * 60_000

export function workspacePollDelay(
  visibilityState: DocumentVisibilityState,
  random = Math.random,
) {
  if (visibilityState !== 'visible') {
    return WORKSPACE_HIDDEN_BACKOFF_MS
  }

  const offset = (random() * 2 - 1) * WORKSPACE_POLL_JITTER_MS
  return Math.round(WORKSPACE_POLL_INTERVAL_MS + offset)
}
