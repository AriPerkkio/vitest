/**
 *  @vitest-environment edge-runtime
 */
import { describe, expect, it } from 'vitest'

describe('edge runtime api', () => {
  it('TextEncoder references the same global Uint8Array constructor', () => {
    expect(new TextEncoder().encode('abc')).toBeInstanceOf(Uint8Array)
  })

  it.skip('allows to run fetch', { timeout: 10_000 }, async () => {
    // 3023 is the default port
    const response = await fetch('http://localhost:3023/')
    expect(response.status).toEqual(200)
  })

  it('allows to run crypto', async () => {
    const array = new Uint32Array(10)
    expect(crypto.getRandomValues(array)).toHaveLength(array.length)
  })
})
