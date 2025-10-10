import type { Logger } from '../logger'
import type { Runtime, Task, WorkerResponse } from './types'
import { ForksRuntime } from './runtimes/forks'
import { ThreadsRuntime } from './runtimes/threads'
import { TypecheckRuntime } from './runtimes/typecheck'
import { VmForksRuntime } from './runtimes/vmForks'
import { VmThreadsRuntime } from './runtimes/vmThreads'

const WORKER_START_TIMEOUT = 5_000

interface Options {
  distPath: string

  /** Total amount of max threads + processes that can run parallel */
  maxWorkers: number

  // From vitest.config.teardownTimeout
  teardownTimeout: number
}

export class Pool {
  private queue: ({ task: Task; resolver: ReturnType<typeof withResolvers>; method: 'run' | 'collect'; warmRuntime?: Runtime })[] = []
  private activeTasks: ((typeof this.queue)[number] & { cancelTask: () => Promise<void> })[] = []
  private sharedRuntimes: Runtime[] = []
  private workerIds = new Map<number, boolean>()
  private exitPromises: Promise<void>[] = []

  constructor(private options: Options, private logger: Logger) {
    this.workerIds = new Map(
      Array.from({ length: this.options.maxWorkers }).fill(0).map((_, i) => [i + 1, true]),
    )
  }

  async run(task: Task, method: 'run' | 'collect' = 'run'): Promise<void> {
    const testFinish = withResolvers()

    this.queue.push({ task, resolver: testFinish, method })
    void this.schedule()

    await testFinish.promise
  }

  private async schedule(): Promise<void> {
    if (this.queue.length === 0 || this.activeTasks.length >= this.options.maxWorkers) {
      return
    }

    const { task, resolver, method, warmRuntime } = this.queue.shift()!
    const activeTask = { task, resolver, method, cancelTask }

    let runtime: Runtime
    let isMemoryLimitReached = false

    try {
      runtime = warmRuntime || this.getRuntime(task, method)
    }
    catch (error) {
      return resolver.reject(error as any)
    }

    this.activeTasks.push(activeTask)

    runtime.on('error', error => this.logger.error(`[vitest-pool]: Runtime ${task.runtime} emitted error`, error))

    async function cancelTask() {
      resolver.resolve()
      return runtime.stop()
    }

    function onFinished(message: WorkerResponse) {
      if (message?.__vitest_worker_response__ && message.type === 'testfileFinished') {
        if (task.memoryLimit && message.usedMemory) {
          isMemoryLimitReached = message.usedMemory >= task.memoryLimit
        }

        runtime.off('message', onFinished)
        resolver.resolve()
      }
    }

    runtime.on('message', onFinished)

    if (!runtime.isStarted) {
      const timeout = withResolvers()
      const id = setTimeout(
        () => timeout.reject(new Error(`[vitest-pool]: Timeout starting ${task.runtime} runtime.`)),
        WORKER_START_TIMEOUT,
      )

      void runtime.start({ env: task.env, execArgv: task.execArgv }).then(timeout.resolve).catch(resolver.reject)
      await timeout.promise
      clearTimeout(id)
    }

    runtime.postMessage({
      __vitest_worker_request__: true,
      type: method,
      context: task.context,
    })

    const next = this.queue.find(entry => !entry.warmRuntime && entry.task.isolate)
    let warmup

    // Warmup the next runtime
    if (next) {
      next.warmRuntime = this.getRuntime(next.task, next.method)
      warmup = next.warmRuntime.start({ env: next.task.env, execArgv: next.task.execArgv })
    }

    await resolver.promise
    await warmup

    const index = this.activeTasks.indexOf(activeTask)
    if (index !== -1) {
      this.activeTasks.splice(index, 1)
    }

    if (
      !task.isolate
      && !isMemoryLimitReached
      && this.queue[0]?.task.isolate === false
      && isEqualRuntime(runtime, this.queue[0].task)
    ) {
      this.sharedRuntimes.push(runtime)
      return this.schedule()
    }

    const terminate = async () => {
      const timeout = withResolvers()
      const id = setTimeout(
        () => timeout.reject(new Error(`[vitest-pool]: Timeout terminating ${task.runtime} worker for test files ${formatFiles(task)}.`)),
        this.options.teardownTimeout,
      )

      void runtime.stop()
        .then(timeout.resolve)
        .catch(error => this.logger.error(`[vitest-pool]: Failed to terminate ${task.runtime} worker for test files ${formatFiles(task)}.`, error))

      await timeout.promise
      clearTimeout(id)
    }

    this.exitPromises.push(terminate())
    this.freeWorkerId(runtime.options.workerId)

    return this.schedule()
  }

  async cancel(): Promise<void> {
    const pendingTasks = this.queue.splice(0)

    if (pendingTasks.length) {
      const error = new Error('Cancelled')
      pendingTasks.forEach(task => task.resolver.reject(error))
    }

    const activeTasks = this.activeTasks.splice(0)
    await Promise.all(activeTasks.map(task => task.cancelTask()))

    const sharedRuntimes = this.sharedRuntimes.splice(0)
    await Promise.all(sharedRuntimes.map(runtime => runtime.stop()))

    await Promise.all(this.exitPromises.splice(0))
  }

  async close(): Promise<void> {
    await this.cancel()
  }

  private getRuntime(task: Task, method: 'run' | 'collect') {
    if (task.isolate === false) {
      const index = this.sharedRuntimes.findIndex(runtime => isEqualRuntime(runtime, task))

      if (index !== -1) {
        return this.sharedRuntimes.splice(index, 1)[0]
      }
    }

    const workerId = this.getWorkerId()
    const options = {
      distPath: this.options.distPath,
      project: task.project,
      method,
      workerId,
    }

    switch (task.runtime) {
      case 'forks':
        return new ForksRuntime(options)

      case 'vmForks':
        return new VmForksRuntime(options)

      case 'threads':
        return new ThreadsRuntime(options)

      case 'vmThreads':
        return new VmThreadsRuntime(options)

      case 'typescript':
        return new TypecheckRuntime(options)
    }

    throw new Error(`Runtime ${task.runtime} not supported. Test files: ${formatFiles(task)}.`)
  }

  private getWorkerId() {
    let workerId: number

    this.workerIds.forEach((state, id) => {
      if (state && !workerId) {
        workerId = id
        this.workerIds.set(id, false)
      }
    })

    return workerId!
  }

  private freeWorkerId(id: number) {
    this.workerIds.set(id, true)
  }
}

function withResolvers() {
  let resolve = () => {}
  let reject = (_error: Error) => {}

  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { resolve, reject, promise }
}

function formatFiles(task: Task) {
  return task.context.files.map(file => file.filepath).join(', ')
}

function isEqualRuntime(runtime: Runtime, task: Task) {
  if (task.isolate) {
    throw new Error('Isolated tasks should not share runtimes')
  }

  // TODO: Compare task.context.environment.name, add runtime.options.env
  return runtime.name === task.runtime && runtime.options.project.name === task.project.name
}
