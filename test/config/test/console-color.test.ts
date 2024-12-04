import { execSync } from 'node:child_process'
import { x } from 'tinyexec'
import { expect, test } from 'vitest'

// use "tinyexec" directly since "runVitestCli" strips color

test('with color (tinyexec)', async () => {
  const proc = await x('vitest', ['run', '--root=./fixtures/console-color'], {
    nodeOptions: {
      env: {
        CI: '1',
        FORCE_COLOR: '1',
        NO_COLOR: undefined,
        GITHUB_ACTIONS: undefined,
      },
    },
  })
  expect(proc.stdout).toContain('\x1B[33mtrue\x1B[39m\n')
})

test('without color (tinyexec)', async () => {
  const proc = await x('vitest', ['run', '--root=./fixtures/console-color'], {
    nodeOptions: {
      env: {
        CI: '1',
        FORCE_COLOR: undefined,
        NO_COLOR: '1',
        GITHUB_ACTIONS: undefined,
      },
    },
  })
  expect(proc.stdout).toContain('true\n')
})

test('with color (node)', async () => {
  const stdout = execSync('./node_modules/.bin/vitest run --root=./fixtures/console-color', {
    encoding: 'utf8',
    env: {
      ...process.env,
      CI: '1',
      FORCE_COLOR: '1',
      NO_COLOR: undefined,
      GITHUB_ACTIONS: undefined,
    },
  })
  expect(stdout).toContain('\x1B[33mtrue\x1B[39m\n')
})

test('without color (node)', async () => {
  const stdout = execSync('./node_modules/.bin/vitest run --root=./fixtures/console-color', {
    encoding: 'utf8',
    env: {
      ...process.env,
      CI: '1',
      FORCE_COLOR: undefined,
      NO_COLOR: '1',
      GITHUB_ACTIONS: undefined,
    },

  })
  expect(stdout).toContain('true\n')
})
