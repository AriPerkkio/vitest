import { expect, test } from 'vitest'
import run from '../../src/multiple-transforms'

test('cover space 1 related transforms', () => {
  expect(run()).toBe('OK')
})
