import { startVitest } from 'vitest/node'

// Set this to true when intentionally updating the snapshots
const UPDATE_SNAPSHOTS = false

const provider = process.argv[1 + process.argv.indexOf('--provider')]
const isBrowser = process.argv.includes('--browser')

const configs = [
  // Run test cases. Generates coverage report.
  ['test/', {
    include: ['test/*.test.*'],
    exclude: [
      'coverage-report-tests/**/*',
      // TODO: Include once mocking is supported in browser
      isBrowser && '**/no-esbuild-transform.test.js',
    ].filter(Boolean),
    coverage: { enabled: true },
    browser: { enabled: isBrowser, name: 'chrome', headless: true },
  }],
]

// Prevent the "vitest/src/node/browser/webdriver.ts" from calling process.exit
const exit = process.exit
process.exit = () => !isBrowser && exit()

for (const threads of [{ threads: true }]) {
  for (const isolate of [true]) {
    for (const [directory, config] of configs) {
      await startVitest('test', [directory], {
        name: `With settings: ${JSON.stringify({ ...threads, isolate, directory, browser: config.browser?.enabled })}`,
        ...config,
        update: UPDATE_SNAPSHOTS,
        ...threads,
        isolate,
      })

      if (process.exitCode) {
        console.error(`process.exitCode was set to ${process.exitCode}, exiting.`)
        exit()
      }
    }
  }
}

exit()
