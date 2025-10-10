import type { Vitest } from '../core'
import type { PoolProcessOptions } from '../pool'
import type { TestSpecification } from '../spec'
import type { ResolvedConfig } from '../types/config'
import type { VmOptions, WorkerContextOptions } from '../types/pool-options'
import type { ProcessPool, Task } from './types'
import * as nodeos from 'node:os'
import { isatty } from 'node:tty'
import { version as viteVersion } from 'vite'
import { isWindows } from '../../utils/env'
import { getWorkerMemoryLimit, stringToBytes } from '../../utils/memory-limit'
import { groupFilesByEnv } from '../../utils/test-helpers'
import { Pool } from './pool'

export function createPool(ctx: Vitest): ProcessPool {
  const pool = new Pool({
    distPath: ctx.distPath,
    maxWorkers: resolveMaxWorkers(ctx),
    teardownTimeout: ctx.config.teardownTimeout,
  }, ctx.logger)

  ctx.onCancel(() => pool.cancel())

  const options = resolveOptions(ctx)

  const Sequencer = ctx.config.sequence.sequencer
  const sequencer = new Sequencer(ctx)

  async function executeTests(method: 'run' | 'collect', specs: TestSpecification[], invalidates?: string[]): Promise<void> {
    if (ctx.config.shard) {
      if (!ctx.config.passWithNoTests && ctx.config.shard.count > specs.length) {
        throw new Error(
          '--shard <count> must be a smaller than count of test files. '
          + `Resolved ${specs.length} test files for --shard=${ctx.config.shard.index}/${ctx.config.shard.count}.`,
        )
      }
      specs = await sequencer.shard(Array.from(specs))
    }

    const taskGroups: Task[][] = []
    let workerId = 0

    const sorted = await sequencer.sort(specs)
    const groups = groupSpecs(sorted)

    for (const group of groups) {
      if (!group) {
        continue
      }

      const taskGroup: Task[] = []
      taskGroups.push(taskGroup)

      for (const specs of group) {
        const { project, pool } = specs[0]
        const byEnv = await groupFilesByEnv(specs)
        const env = Object.values(byEnv)[0][0]

        const poolOptions = project.config.poolOptions?.[pool] as WorkerContextOptions | VmOptions | undefined

        taskGroup.push({
          context: {
            pool,
            config: project.serializedConfig,
            files: specs.map(spec => ({ filepath: spec.moduleId, testLocations: spec.testLines })),
            invalidates,
            environment: env.environment,
            projectName: project.name,
            providedContext: project.getProvidedContext(),
            workerId: workerId++,
          },
          project,
          env: options.env,
          execArgv: [...options.execArgv, ...(poolOptions?.execArgv || [])],
          runtime: pool,
          isolate: project.serializedConfig.isolate && pool !== 'vmForks' && pool !== 'vmThreads' && pool !== 'typescript',
          memoryLimit: getMemoryLimit(ctx.config, pool) ?? null,
        })
      }
    }

    // TODO: const { createBrowserPool } = await import('@vitest/browser')

    const results: PromiseSettledResult<void>[] = []

    for (const tasks of taskGroups) {
      const groupResults = await Promise.allSettled(
        tasks.map(async (task) => {
          try {
            await pool.run(task, method)
          }
          catch (error) {
            // Worker got stuck and won't terminate - this may cause process to hang
            if (error instanceof Error && /Timeout terminating/.test(error.message)) {
              ctx.state.addProcessTimeoutCause(
                `Failed to terminate worker while running ${task.context.files.map(f => f.filepath).join(', ')}.`,
              )
            }
            // Intentionally cancelled
            else if (ctx.isCancelling && error instanceof Error && error.message === 'Cancelled') {
              ctx.state.cancelFiles(task.context.files.map(f => f.filepath), task.project)
            }
            else {
              throw error
            }
          }
        }),
      )

      results.push(...groupResults)
    }

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
      await pool.close()
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
    execArgv: [...execArgv, ...conditions],
    env: {
      TEST: 'true',
      VITEST: 'true',
      NODE_ENV: process.env.NODE_ENV || 'test',
      VITEST_MODE: ctx.config.watch ? 'WATCH' : 'RUN',
      FORCE_TTY: isatty(1) ? 'true' : '',
      ...process.env,
      ...ctx.config.env,
    },
  }

  // env are case-insensitive on Windows, but spawned processes don't support it
  if (isWindows) {
    for (const name in options.env) {
      options.env[name.toUpperCase()] = options.env[name]
    }
  }

  return options
}

function resolveMaxWorkers(ctx: Vitest) {
  if (ctx.config.maxWorkers) {
    return ctx.config.maxWorkers
  }

  const numCpus
  = typeof nodeos.availableParallelism === 'function'
    ? nodeos.availableParallelism()
    : nodeos.cpus().length

  if (ctx.config.watch) {
    return Math.max(Math.floor(numCpus / 2), 1)
  }

  return Math.max(numCpus - 1, 1)
}

function getMemoryLimit(config: ResolvedConfig, pool: string) {
  if (pool !== 'vmForks' && pool !== 'vmThreads') {
    return null
  }

  const memory = nodeos.totalmem()
  const limit = getWorkerMemoryLimit(config, pool)

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

function groupSpecs(specs: TestSpecification[]) {
  type SpecsForRuntime = TestSpecification[]
  type Groups = SpecsForRuntime[]
  const groups: Groups[] = []

  // Type tests are run in a single group, per project
  const typechecks: Record<string, TestSpecification[]> = {}

  specs.forEach((spec) => {
    if (spec.pool === 'typescript') {
      typechecks[spec.project.name] ||= []
      typechecks[spec.project.name].push(spec)
      return
    }

    const order = spec.project.config.sequence.groupOrder
    groups[order] ||= []

    // Specs in a single group are passed to pool runtime at once
    groups[order].push([spec])
  })

  for (const project in typechecks) {
    const order = Math.max(...groups.keys()) + 1

    groups[order] ||= []
    groups[order].push(typechecks[project])
  }

  return groups
}
