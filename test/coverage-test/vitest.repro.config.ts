import { defineConfig } from 'vitest/config'
import { sourcemapVisualizer } from 'vite-plugin-source-map-visualizer'

export default defineConfig({
  plugins: [sourcemapVisualizer()],
  test: {
    watch: false,
    include: ['fixtures/test/math.test.ts'],
    reporters: 'basic',
    inspectBrk: true,
    fileParallelism: false,
    browser: {
      enabled: true,
      headless: true,
      name: 'chromium',
      provider: 'playwright',
    },
  },
})
