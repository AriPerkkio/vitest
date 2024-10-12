import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    minWorkers: 2,
    maxWorkers: 2,
    reporters: 'something-new',
  },
})
