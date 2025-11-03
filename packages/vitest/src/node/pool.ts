import type { Awaitable } from '@vitest/utils'
import type { ContextTestEnvironment } from '../types/worker'
import type { Vitest } from './core'
import type { PoolTask } from './pools/types'
import type { TestProject } from './project'
import type { TestSpecification } from './spec'
import type { BuiltinPool, ResolvedConfig } from './types/config'
import * as nodeos from 'node:os'
import { isatty } from 'node:tty'
import { resolve } from 'pathe'
import { version as viteVersion } from 'vite'
import { rootDir } from '../paths'
import { isWindows } from '../utils/env'
import { getWorkerMemoryLimit, stringToBytes } from '../utils/memory-limit'
import { getSpecificationsEnvironments } from '../utils/test-helpers'
import { createBrowserPool } from './pools/browser'
import { Pool } from './pools/pool'

const suppressWarningsPath = resolve(rootDir, './suppress-warnings.cjs')

type RunWithFiles = (
  files: TestSpecification[],
  invalidates?: string[]
) => Promise<void>

export interface ProcessPool {
  name: string
  runTests: RunWithFiles
  collectTests: RunWithFiles
  close?: () => Awaitable<void>
}

export interface PoolProcessOptions {
  execArgv: string[]
  env: Record<string, string>
}

export const builtinPools: BuiltinPool[] = [
  'forks',
  'threads',
  'browser',
  'vmThreads',
  'vmForks',
  'typescript',
]

export function getFilePoolName(project: TestProject): ResolvedConfig['pool'] {
  if (project.config.browser.enabled) {
    return 'browser'
  }
  return project.config.pool
}

export function createPool(ctx: Vitest): ProcessPool {
  const pool = new Pool({
    distPath: ctx.distPath,
    teardownTimeout: ctx.config.teardownTimeout,
    state: ctx.state,
    defaultMaxWorkers: ctx.config.maxWorkers,
  }, ctx.logger)

  const options = resolveOptions(ctx)

  const Sequencer = ctx.config.sequence.sequencer
  const sequencer = new Sequencer(ctx)

  let browserPool: ProcessPool | undefined

  async function executeTests(method: 'run' | 'collect', specs: TestSpecification[], invalidates?: string[]): Promise<void> {
    ctx.onCancel(() => pool.cancel())

    if (ctx.config.shard) {
      if (!ctx.config.passWithNoTests && ctx.config.shard.count > specs.length) {
        throw new Error(
          '--shard <count> must be a smaller than count of test files. '
          + `Resolved ${specs.length} test files for --shard=${ctx.config.shard.index}/${ctx.config.shard.count}.`,
        )
      }
      specs = await sequencer.shard(Array.from(specs))
    }

    let workerId = 1

    const sorted = await sequencer.sort(specs)
    const environments = await getSpecificationsEnvironments(specs)
    const groups = groupSpecs(sorted, environments)

    const projectEnvs = new WeakMap<TestProject, Partial<NodeJS.ProcessEnv>>()
    const projectExecArgvs = new WeakMap<TestProject, string[]>()

    const tasks: (PoolTask | { isBrowser: true; specs: TestSpecification[] })[] = []

    for (const specs of groups) {
      const project = specs[0].project
      const environment = environments.get(specs[0])

      if (project.config.pool === 'browser') {
        tasks.push({ isBrowser: true, specs })
        continue
      }

      if (!environment) {
        throw new Error(`Cannot find the environment. This is a bug in Vitest.`)
      }

      let env = projectEnvs.get(specs[0].project)
      if (!env) {
        env = {
          ...process.env,
          ...options.env,
          ...ctx.config.env,
          ...project.config.env,
        }

        // env are case-insensitive on Windows, but spawned processes don't support it
        if (isWindows) {
          for (const name in env) {
            env[name.toUpperCase()] = env[name]
          }
        }
        projectEnvs.set(project, env)
      }

      let execArgv = projectExecArgvs.get(project)
      if (!execArgv) {
        execArgv = [
          ...options.execArgv,
          ...project.config.execArgv,
        ]
        projectExecArgvs.set(project, execArgv)
      }

      tasks.push({
        context: {
          pool: specs[0].pool,
          config: project.serializedConfig,
          files: specs.map(spec => ({ filepath: spec.moduleId, testLocations: spec.testLines })),
          invalidates,
          environment,
          projectName: project.name,
          providedContext: project.getProvidedContext(),
          workerId: workerId++,
        },
        project,
        env,
        execArgv,
        worker: specs[0].pool,
        isolate: project.config.isolate,
        memoryLimit: getMemoryLimit(ctx.config, specs[0].pool) ?? null,
      })
    }

    const first = tasks.find((task): task is PoolTask => !('isBrowser' in task))

    if (!first) {
      throw new Error('At least one test required')
    }

    // pool.setMaxWorkers(first.context.config.maxWorkers)

    const results: PromiseSettledResult<void>[] = await Promise.allSettled(tasks.map(async (task) => {
      if ('isBrowser' in task) {
        browserPool ??= createBrowserPool(ctx)

        return method === 'collect'
          ? await browserPool.collectTests(task.specs)
          : await browserPool.runTests(task.specs)
      }

      if (ctx.isCancelling) {
        return ctx.state.cancelFiles(task.context.files, task.project)
      }

      try {
        await pool.run(task, method)
      }
      catch (error) {
        // Intentionally cancelled
        if (ctx.isCancelling && error instanceof Error && error.message === 'Cancelled') {
          ctx.state.cancelFiles(task.context.files, task.project)
        }
        else {
          throw error
        }
      }
    }))

    const errors = results
      .filter(result => result.status === 'rejected')
      .map(result => result.reason)

    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        'Errors occurred while running tests. For more information, see serialized error.',
      )
    }
  }

  return {
    name: 'default',
    runTests: (files, invalidates) => executeTests('run', files, invalidates),
    collectTests: (files, invalidates) => executeTests('collect', files, invalidates),
    async close() {
      await Promise.all([pool.close(), browserPool?.close?.()])
    },
  }
}

function resolveOptions(ctx: Vitest) {
  // in addition to resolve.conditions Vite also adds production/development,
  // see: https://github.com/vitejs/vite/blob/af2aa09575229462635b7cbb6d248ca853057ba2/packages/vite/src/node/plugins/resolve.ts#L1056-L1080
  const viteMajor = Number(viteVersion.split('.')[0])

  const potentialConditions = new Set(viteMajor >= 6
    ? (ctx.vite.config.ssr.resolve?.conditions ?? [])
    : [
        'production',
        'development',
        ...ctx.vite.config.resolve.conditions,
      ])

  const conditions = [...potentialConditions]
    .filter((condition) => {
      if (condition === 'production') {
        return ctx.vite.config.isProduction
      }
      if (condition === 'development') {
        return !ctx.vite.config.isProduction
      }
      return true
    })
    .map((condition) => {
      if (viteMajor >= 6 && condition === 'development|production') {
        return ctx.vite.config.isProduction ? 'production' : 'development'
      }
      return condition
    })
    .flatMap(c => ['--conditions', c])

  // Instead of passing whole process.execArgv to the workers, pick allowed options.
  // Some options may crash worker, e.g. --prof, --title. nodejs/node#41103
  const execArgv = process.execArgv.filter(
    execArg =>
      execArg.startsWith('--cpu-prof')
      || execArg.startsWith('--heap-prof')
      || execArg.startsWith('--diagnostic-dir'),
  )

  const options: PoolProcessOptions = {
    execArgv: [
      ...execArgv,
      ...conditions,
      '--experimental-import-meta-resolve',
      '--require',
      suppressWarningsPath,
    ],
    env: {
      TEST: 'true',
      VITEST: 'true',
      NODE_ENV: process.env.NODE_ENV || 'test',
      VITEST_MODE: ctx.config.watch ? 'WATCH' : 'RUN',
      FORCE_TTY: isatty(1) ? 'true' : '',
    },
  }

  return options
}

function getMemoryLimit(config: ResolvedConfig, pool: string) {
  if (pool !== 'vmForks' && pool !== 'vmThreads') {
    return null
  }

  const memory = nodeos.totalmem()
  const limit = getWorkerMemoryLimit(config)

  if (typeof memory === 'number') {
    return stringToBytes(limit, config.watch ? memory / 2 : memory)
  }

  // If totalmem is not supported we cannot resolve percentage based values like 0.5, "50%"
  if (
    (typeof limit === 'number' && limit > 1)
    || (typeof limit === 'string' && limit.at(-1) !== '%')
  ) {
    return stringToBytes(limit)
  }

  // just ignore "memoryLimit" value because we cannot detect memory limit
  return null
}

function groupSpecs(specs: TestSpecification[], environments: Awaited<ReturnType<typeof getSpecificationsEnvironments>>) {
  // Test files are passed to test runner one at a time, except for Typechecker or when "--no-isolate --no-file-parallelism"
  type SpecsForRunner = TestSpecification[]

  // For isolated tests a group is a single spec file.
  // For non-isolated tests a group is list of files that can share the same worker.
  const groups: SpecsForRunner[] = []

  const serializedEnvironmentOptions = new Map<ContextTestEnvironment, string>()

  function getSerializedOptions(env: ContextTestEnvironment) {
    const options = serializedEnvironmentOptions.get(env)

    if (options) {
      return options
    }

    const serialized = JSON.stringify(env.options)
    serializedEnvironmentOptions.set(env, serialized)
    return serialized
  }

  function isEqualRunner(a: TestSpecification, b: TestSpecification) {
    if (a.project.name !== b.project.name) {
      return false
    }

    if (a.pool === 'typescript' && b.pool === 'typescript') {
      return true
    }

    const aEnv = environments.get(a)
    const bEnv = environments.get(b)

    if (!aEnv && !bEnv) {
      return true
    }

    if (!aEnv || !bEnv || aEnv.name !== bEnv.name) {
      return false
    }

    if (!aEnv.options && !bEnv.options) {
      return true
    }

    if (!aEnv.options || !bEnv.options) {
      return false
    }

    return getSerializedOptions(aEnv) === getSerializedOptions(bEnv)
  }

  // Order of specs must be respected at this point
  specs.forEach((spec) => {
    const isolate = spec.project.config.isolate

    // Isolated tests are always passed to the runner one-by-one
    if (isolate) {
      return groups.push([spec])
    }

    // Typecheck tests are passed to a single worker at once, when in same project
    const isTypestrict = spec.pool === 'typescript'

    // Browser tests are passed to a single worker at once, when in same project
    const isBrowser = spec.pool === 'browser'

    // "--no-isolate --no-file-parallelism" are passed to a single worker at once, when they can share same runtime (project, env, env options)
    const isSequential = spec.project.config.maxWorkers === 1

    if (!isTypestrict && !isBrowser && !isSequential) {
      return groups.push([spec])
    }

    const previous = groups.find(group => group[0] && isEqualRunner(spec, group[0]))

    if (previous) {
      return previous.push(spec)
    }

    groups.push([spec])
  })

  return groups
}
