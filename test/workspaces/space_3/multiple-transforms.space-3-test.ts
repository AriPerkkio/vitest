import { expect, test } from 'vitest'
import run from '../src/multiple-transforms'

test('cover space 3 related transforms', () => {
  expect(run()).toBe('OK')
})
