import { afterEach, describe, expect, it, vi } from 'vitest'

import { forgetSessionHint, hasSessionHint, rememberSessionHint } from './session-hint'

describe('session hint', () => {
  afterEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('is absent on a device that never signed in', () => {
    expect(hasSessionHint()).toBe(false)
  })

  it('is remembered after sign-in and forgotten after sign-out', () => {
    rememberSessionHint()
    expect(hasSessionHint()).toBe(true)

    forgetSessionHint()
    expect(hasSessionHint()).toBe(false)
  })

  it('falls back to probing when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })

    expect(hasSessionHint()).toBe(true)
  })

  it('never throws when storage refuses writes', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })

    expect(() => rememberSessionHint()).not.toThrow()
    expect(() => forgetSessionHint()).not.toThrow()
  })
})
