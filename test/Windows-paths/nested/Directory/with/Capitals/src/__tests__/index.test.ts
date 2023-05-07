import { describe, expect, it } from 'vitest'

describe('Utilities', () => {
  describe.concurrent('sum', () => {
    it('1 + 1 = 2', () => {
      expect(1 + 1).toEqual(2)
    })

    it('1 + 2 = 3', () => {
      expect(1 + 2).toEqual(3)
    })
  })
})
