import { expect, test } from 'vitest'

test('sum', () => {
  console.log('sum')
  expect(1 + 1).toBe(2)
})

test('multiply', () => {
  console.log('multiply')
  expect(1 * 2).toBe(2)
})
