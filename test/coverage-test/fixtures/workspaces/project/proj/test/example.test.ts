import { expect, test } from 'vitest';
import { example } from '../src/example';

test('example', () => {
  expect(example()).toBe("Hello world");
})
