import type { PoolTask, Vitest, WorkerRequest } from 'vitest/node'
import type { ProcessPool } from '../../../packages/vitest/src/node/pool'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { EventEmitter } from 'node:stream'
import { test as base, expect, vi } from 'vitest'
import { createVitest } from 'vitest/node'
import { createPool } from '../../../packages/vitest/src/node/pool'
import { TestSpecification } from '../../../packages/vitest/src/node/spec'

interface ActiveTask { context: PoolTask['context']; onFinish: () => void; poolId: number }

const activeTasks: ActiveTask[] = []
const emitter = new EventEmitter<{
  'max-active-tasks': [void]
  'task-start': [ActiveTask]
}>()

const test = base.extend<{ pool: ProcessPool; vitest: Vitest; specs: TestSpecification[] }>({
  vitest: async ({ }, use) => {
    const vitest = await createVitest('test', { config: false, watch: false })
    await use(vitest)
    await vitest.close()
  },

  specs: async ({ vitest }, use) => {
    const fixtures = resolve(import.meta.dirname, './fixtures/order')
    const specs = readdirSync(fixtures).map(filename => new TestSpecification(vitest.getRootProject(), resolve(fixtures, filename), 'forks'))
    await use(specs)
  },

  pool: async ({ vitest }, use) => {
    const pool = createPool(vitest)
    await use(pool)
    await pool.close?.()
  },
})

test('runs tests', async ({ pool, specs }) => {
  const testRun = pool.runTests(specs.slice(0, 2))

  await waitForTask('a.test.ts')
  await waitForTask('b.test.ts')

  await finishActiveTasks()
  await testRun
})

test('runs tests in sets of maxWorkers', async ({ pool, specs, vitest }) => {
  vitest.config.maxWorkers = 2

  const testRun = pool.runTests(specs.slice(0, 5)).catch(() => {})

  await waitForMaxActivePool()
  expect(activeTasks).toHaveLength(2)

  expect(activeTasks.flatMap(formatFiles)).toMatchInlineSnapshot(`
    [
      "Runner 1, Worker 1: <process-cwd>/test/fixtures/order/a.test.ts",
      "Runner 2, Worker 2: <process-cwd>/test/fixtures/order/b.test.ts",
    ]
  `)

  await finishActiveTasks()
  await waitForMaxActivePool()
  expect(activeTasks).toHaveLength(2)

  expect(activeTasks.flatMap(formatFiles)).toMatchInlineSnapshot(`
    [
      "Runner 1, Worker 3: <process-cwd>/test/fixtures/order/c.test.ts",
      "Runner 2, Worker 4: <process-cwd>/test/fixtures/order/d.test.ts",
    ]
  `)

  await finishActiveTasks()
  await waitForTask('e.test.ts')
  expect(activeTasks).toHaveLength(1)

  expect(activeTasks.flatMap(formatFiles)).toMatchInlineSnapshot(`
    [
      "Runner 1, Worker 5: <process-cwd>/test/fixtures/order/e.test.ts",
    ]
  `)

  await finishActiveTasks()
  await testRun
})

test('isolated single worker pool receives single testfile at once', async ({ pool, vitest, specs }) => {
  vitest.config.maxWorkers = 1
  vitest.config.isolate = true

  const testRun = pool.runTests(specs.slice(0, 3))

  await waitForMaxActivePool()
  expect(activeTasks).toHaveLength(1)
  expect(activeTasks.flatMap(formatFiles)).toMatchInlineSnapshot(`
    [
      "Runner 1, Worker 1: <process-cwd>/test/fixtures/order/a.test.ts",
    ]
  `)

  await finishActiveTasks()
  await waitForMaxActivePool()

  expect(activeTasks).toHaveLength(1)
  expect(activeTasks.flatMap(formatFiles)).toMatchInlineSnapshot(`
    [
      "Runner 1, Worker 2: <process-cwd>/test/fixtures/order/b.test.ts",
    ]
  `)

  await finishActiveTasks()
  await waitForMaxActivePool()

  expect(activeTasks).toHaveLength(1)
  expect(activeTasks.flatMap(formatFiles)).toMatchInlineSnapshot(`
    [
      "Runner 1, Worker 3: <process-cwd>/test/fixtures/order/c.test.ts",
    ]
  `)

  await finishActiveTasks()
  await testRun
})

test('non-isolated single worker pool receives all testfiles at once', async ({ pool, vitest, specs }) => {
  vitest.config.maxWorkers = 1
  vitest.config.isolate = false

  const testRun = pool.runTests(specs.slice(0, 3))

  await waitForMaxActivePool()

  expect(activeTasks).toHaveLength(1)
  expect(activeTasks.flatMap(formatFiles)).toMatchInlineSnapshot(`
    [
      "Runner 1, Worker 1: <process-cwd>/test/fixtures/order/a.test.ts",
      "Runner 1, Worker 1: <process-cwd>/test/fixtures/order/b.test.ts",
      "Runner 1, Worker 1: <process-cwd>/test/fixtures/order/c.test.ts",
    ]
  `)

  await finishActiveTasks()
  await testRun
})

async function waitForTask(filename: string) {
  return new Promise<(typeof activeTasks)[number]>((resolve) => {
    const active = activeTasks.find(task => isEqualFilename(task, filename))

    if (active) {
      return resolve(active)
    }

    emitter.once('task-start', (task) => {
      if (isEqualFilename(task, filename)) {
        resolve(task)
      }
    })
  })
}

async function finishActiveTasks() {
  // task.onFinish() mutates activeTasks so use slice()
  activeTasks.slice().forEach(task => task.onFinish())
}

async function waitForMaxActivePool() {
  return new Promise(resolve => emitter.once('max-active-tasks', resolve))
}

function isEqualFilename(task: ActiveTask, filename: string) {
  return task.context.files.find(file => file.filepath.includes(filename))
}

function formatFiles(task: ActiveTask) {
  return task.context.files.flatMap(file => `Runner ${task.poolId}, Worker ${task.context.workerId}: ${file.filepath.replace(process.cwd(), '<process-cwd>')}`)
}

vi.mock(import('../../../packages/vitest/src/node/pools/poolRunner'), async (importOg) => {
  const og = await importOg()

  class MockPoolRunner extends og.PoolRunner {
    postMessage(message: WorkerRequest) {
      if (message.type !== 'run') {
        return
      }

      const entry = {
        context: message.context,
        poolId: this.poolId!,
        onFinish: () => {
          // @ts-expect-error -- accessing private property
          this._eventEmitter.emit('message', {
            __vitest_worker_response__: true,
            type: 'testfileFinished',
          })

          const index = activeTasks.indexOf(entry)
          if (index !== -1) {
            activeTasks.splice(index, 1)
          }
        },
      }

      activeTasks.push(entry)
      emitter.emit('task-start', entry)
    }

    // don't actually run workers
    async start() {}
    async stop() {}
  }

  return { PoolRunner: MockPoolRunner }
})

vi.mock(import('../../../packages/vitest/src/node/pools/pool'), async (importOg) => {
  const { Pool } = await importOg()

  class MockPool extends Pool {
    onMaxResourceLimit(): void {
      emitter.emit('max-active-tasks')
    }
  }

  return { Pool: MockPool }
})
