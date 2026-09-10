import { describe, expect, it } from 'vitest'
import {
  WORKSPACE_HIDDEN_BACKOFF_MS,
  workspacePollDelay,
} from './workspace-poll'

describe('workspace revision polling', () => {
  it('jitters visible polls between 45 and 75 seconds', () => {
    expect(workspacePollDelay('visible', () => 0)).toBe(45_000)
    expect(workspacePollDelay('visible', () => 0.5)).toBe(60_000)
    expect(workspacePollDelay('visible', () => 1)).toBe(75_000)
  })

  it('backs off while the document is hidden', () => {
    expect(workspacePollDelay('hidden', () => 0)).toBe(WORKSPACE_HIDDEN_BACKOFF_MS)
  })
})
