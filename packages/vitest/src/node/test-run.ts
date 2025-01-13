import type { File as RunnerTestFile, TaskEventPack, TaskResultPack, TaskUpdateEvent } from '@vitest/runner'
import type { SerializedError } from '../public/utils'
import type { UserConsoleLog } from '../types/general'
import type { Vitest } from './core'
import type { TestProject } from './project'
import type { ReportedHookContext, TestCase, TestCollection, TestModule, TestSuite } from './reporters/reported-tasks'
import type { TestSpecification } from './spec'
import assert from 'node:assert'
import { serializeError } from '@vitest/utils/error'

export class TestRun {
  constructor(private vitest: Vitest) {}

  statistics = {
    tests: createStatistics(),
    suites: createStatistics(),
    modules: createStatistics(),
  }

  async start(specifications: TestSpecification[]) {
    this.statistics = {
      tests: createStatistics(),
      suites: createStatistics(),
      modules: createStatistics(),
    }
    this.statistics.modules.total = specifications.length

    await this.vitest.report('onTestRunStart', [...specifications])
  }

  async enqueued(project: TestProject, file: RunnerTestFile) {
    this.vitest.state.collectFiles(project, [file])
    const testModule = this.vitest.state.getReportedEntity(file) as TestModule
    await this.vitest.report('onTestModuleQueued', testModule)
  }

  async collected(project: TestProject, files: RunnerTestFile[]) {
    this.vitest.state.collectFiles(project, files)
    await Promise.all([
      this.vitest.report('onCollected', files),
      ...files.map((file) => {
        const testModule = this.vitest.state.getReportedEntity(file) as TestModule
        return this.vitest.report('onTestModuleCollected', testModule)
      }),
    ])
  }

  async log(log: UserConsoleLog) {
    this.vitest.state.updateUserLog(log)
    await this.vitest.report('onUserConsoleLog', log)
  }

  async updated(update: TaskResultPack[], events: TaskEventPack[]) {
    this.vitest.state.updateTasks(update)

    // TODO: what is the order or reports here?
    // "onTaskUpdate" in parallel with others or before all or after all?
    // TODO: error handling - what happens if custom reporter throws an error?
    await this.vitest.report('onTaskUpdate', update)

    for (const [id, event] of events) {
      await this.reportEvent(id, event).catch((error) => {
        this.vitest.state.catchError(serializeError(error), 'Unhandled Reporter Error')
      })
    }
  }

  async end(specifications: TestSpecification[], errors: unknown[], coverage?: unknown) {
    // specification won't have the File task if they were filtered by the --shard command
    const modules = specifications.map(spec => spec.testModule).filter(s => s != null)
    const files = modules.map(m => m.task)

    const state = this.vitest.isCancelling
      ? 'interrupted'
      // by this point, the run will be marked as failed if there are any errors,
      // should it be done by testRun.end?
      : process.exitCode
        ? 'failed'
        : 'passed'

    try {
      await Promise.all([
        this.vitest.report('onTestRunEnd', modules, [...errors] as SerializedError[], state),
        // TODO: in a perfect world, the coverage should be done in parallel to `onFinished`
        this.vitest.report('onFinished', files, errors, coverage),
      ])
    }
    finally {
      await this.vitest.report('onCoverage', coverage)
    }
  }

  private async reportEvent(id: string, event: TaskUpdateEvent) {
    const task = this.vitest.state.idMap.get(id)
    const entity = task && this.vitest.state.getReportedEntity(task)

    assert(task && entity, `Entity must be found for task ${task?.name || id}`)

    if (event === 'suite-prepare' && entity.type === 'suite') {
      this.statistics.suites.total++
      return await this.vitest.report('onTestSuiteReady', entity)
    }

    if (event === 'suite-prepare' && entity.type === 'module') {
      return await this.vitest.report('onTestModuleStart', entity)
    }

    if (event === 'suite-finished') {
      assert(entity.type === 'suite' || entity.type === 'module', 'Entity type must be suite or module')

      const state = entity.state()

      if (state === 'skipped') {
        // everything inside suite or a module is skipped,
        // so we won't get any children events
        // we need to report everything manually
        await this.reportChildren(entity.children)
      }
      else {
        // skipped tests need to be reported manually once test module/suite has finished
        for (const test of entity.children.tests('skipped')) {
          if (test.task.result?.pending) {
            // pending error tasks are reported normally
            continue
          }
          await this.vitest.report('onTestCaseReady', test)
          await this.vitest.report('onTestCaseResult', test)
        }
      }

      if (entity.type === 'module') {
        await this.vitest.report('onTestModuleEnd', entity)
      }
      else {
        await this.vitest.report('onTestSuiteResult', entity)
      }

      updateStats(entity.type === 'module' ? this.statistics.modules : this.statistics.suites, entity)
      return
    }

    if (event === 'test-prepare' && entity.type === 'test') {
      this.statistics.tests.total++
      return await this.vitest.report('onTestCaseReady', entity)
    }

    if (event === 'test-finished' && entity.type === 'test') {
      await this.vitest.report('onTestCaseResult', entity)
      updateStats(this.statistics.tests, entity)

      return
    }

    if (event.startsWith('before-hook') || event.startsWith('after-hook')) {
      const isBefore = event.startsWith('before-hook')

      const hook: ReportedHookContext = entity.type === 'test'
        ? {
            name: isBefore ? 'beforeEach' : 'afterEach',
            entity,
          }
        : {
            name: isBefore ? 'beforeAll' : 'afterAll',
            entity,
          }

      if (event.endsWith('-start')) {
        await this.vitest.report('onHookStart', hook)
      }
      else {
        await this.vitest.report('onHookEnd', hook)
      }
    }
  }

  private async reportChildren(children: TestCollection) {
    for (const child of children) {
      if (child.type === 'test') {
        await this.vitest.report('onTestCaseReady', child)
        await this.vitest.report('onTestCaseResult', child)
        updateStats(this.statistics.tests, child)
      }
      else {
        await this.vitest.report('onTestSuiteReady', child)
        await this.reportChildren(child.children)
        await this.vitest.report('onTestSuiteResult', child)
        updateStats(this.statistics.suites, child)
      }
    }
  }
}

function createStatistics() {
  return {
    total: 0,
    completed: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    todo: 0,
  }
}

function updateStats(totals: TestSuiteStatistics, entity: TestCase | TestSuite | TestModule) {
  const state = entity.type === 'test' ? entity.result().state : entity.state()

  totals.completed++

  if (entity.task.mode === 'todo') {
    return totals.todo++
  }

  if (state === 'passed') {
    return totals.passed++
  }

  if (state === 'failed') {
    return totals.failed++
  }

  if (state === 'skipped') {
    return totals.skipped++
  }
}

interface TestSuiteStatistics {
  total: number
  completed: number
  passed: number
  failed: number
  skipped: number
  todo: number
}
