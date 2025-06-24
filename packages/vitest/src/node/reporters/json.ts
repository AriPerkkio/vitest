import type { TaskMeta } from '@vitest/runner'
import type { SnapshotSummary } from '@vitest/snapshot'
import type { CoverageMap } from 'istanbul-lib-coverage'
import type { Vitest } from '../core'
import type { Reporter } from '../types/reporter'
import type { TestModule, TestSuite } from './reported-tasks'
import { existsSync, promises as fs } from 'node:fs'
import { dirname, resolve } from 'pathe'
import { getOutputFile } from '../../utils/config-helpers'

// for compatibility reasons, the reporter produces a JSON similar to the one produced by the Jest JSON reporter
// the following types are extracted from the Jest repository (and simplified)
// the commented-out fields are the missing ones

type Status = 'passed' | 'failed' | 'skipped' | 'pending' | 'todo' | 'disabled'
type Milliseconds = number
interface Callsite {
  line: number
  column: number
}

export interface JsonAssertionResult {
  ancestorTitles: Array<string>
  fullName: string
  status: Status
  title: string
  meta: TaskMeta
  duration?: Milliseconds | null
  failureMessages: Array<string> | null
  location?: Callsite | null
}

export interface JsonTestResult {
  message: string
  name: string
  status: 'failed' | 'passed'
  startTime: number
  endTime: number
  assertionResults: Array<JsonAssertionResult>
  // summary: string
  // coverage: unknown
}

export interface JsonTestResults {
  numFailedTests: number
  numFailedTestSuites: number
  numPassedTests: number
  numPassedTestSuites: number
  numPendingTests: number
  numPendingTestSuites: number
  numTodoTests: number
  numTotalTests: number
  numTotalTestSuites: number
  startTime: number
  success: boolean
  testResults: Array<JsonTestResult>
  snapshot: SnapshotSummary
  coverageMap?: CoverageMap | null | undefined
  // numRuntimeErrorTestSuites: number
  // wasInterrupted: boolean
}

export interface JsonOptions {
  outputFile?: string
}

export class JsonReporter implements Reporter {
  start = 0
  ctx!: Vitest
  options: JsonOptions
  coverageMap?: CoverageMap

  constructor(options: JsonOptions) {
    this.options = options
  }

  onInit(ctx: Vitest): void {
    this.ctx = ctx
    this.start = Date.now()
    this.coverageMap = undefined
  }

  onCoverage(coverageMap: unknown): void {
    this.coverageMap = coverageMap as CoverageMap
  }

  async onTestRunEnd(testModules: ReadonlyArray<TestModule>): Promise<void> {
    const suites = testModules.flatMap(testModule => Array.from(testModule.children.allSuites()))
    const tests = testModules.flatMap(testModule => Array.from(testModule.children.allTests()))
    const numTotalTests = tests.length

    // Test modules are counted as suites
    const numFailedTestModules = testModules.filter(testModule => testModule.state() === 'failed').length
    const numPendingTestModules = testModules.filter(testModule => testModule.state() === 'pending').length

    const numTotalTestSuites = suites.length + testModules.length
    const numFailedTestSuites = numFailedTestModules + suites.filter(s => s.state() === 'failed').length
    const numPendingTestSuites = numPendingTestModules + suites.filter(s => s.state() === 'pending' || s.state() === 'skipped' || s.options.mode === 'todo').length
    const numPassedTestSuites = numTotalTestSuites - numFailedTestSuites - numPendingTestSuites

    const numFailedTests = tests.filter(t => t.result().state === 'failed').length
    const numPassedTests = tests.filter(t => t.result().state === 'passed').length
    const numPendingTests = tests.filter(t => t.result().state === 'pending' || t.result().state === 'skipped').length
    const numTodoTests = tests.filter(t => t.options.mode === 'todo').length
    const testResults: Array<JsonTestResult> = []

    const success = !!(testModules.length > 0 || this.ctx.config.passWithNoTests) && numFailedTestSuites === 0 && numFailedTests === 0

    for (const testModule of testModules) {
      const tests = Array.from(testModule.children.allTests())

      let startTime = tests.reduce(
        (prev, next) =>
          Math.min(prev, next.diagnostic()?.startTime ?? Number.POSITIVE_INFINITY),
        Number.POSITIVE_INFINITY,
      )
      if (startTime === Number.POSITIVE_INFINITY) {
        startTime = this.start
      }

      const endTime = tests.reduce(
        (prev, next) =>
          Math.max(
            prev,
            (next.diagnostic()?.startTime ?? 0) + (next.diagnostic()?.duration ?? 0),
          ),
        startTime,
      )
      const assertionResults = tests.map((t) => {
        const ancestorTitles: string[] = []
        let iter: TestModule | TestSuite | undefined = t.parent.type === 'suite' ? t.parent : undefined
        while (iter) {
          ancestorTitles.push(iter.task.name)
          iter = iter.parent.type === 'suite' ? iter.parent : undefined
        }
        ancestorTitles.reverse()

        return {
          ancestorTitles,
          fullName: t.name
            ? [...ancestorTitles, t.name].join(' ')
            : ancestorTitles.join(' '),
          status: t.result().state,
          title: t.name,
          duration: t.diagnostic()?.duration,
          failureMessages:
            t.result()?.errors?.map(e => e.stack || e.message) || [],
          location: t.location,
          meta: t.meta(),
        } satisfies JsonAssertionResult
      })

      if (tests.some(t => t.result().state === 'pending')) {
        this.ctx.logger.warn(
          'WARNING: Some tests are still running when generating the JSON report.'
          + 'This is likely an internal bug in Vitest.'
          + 'Please report it to https://github.com/vitest-dev/vitest/issues',
        )
      }

      const hasFailedTests = tests.some(t => t.result().state === 'failed')

      testResults.push({
        assertionResults,
        startTime,
        endTime,
        status: testModule.state() === 'failed' || hasFailedTests ? 'failed' : 'passed',
        message: testModule.errors()[0]?.message ?? '',
        name: testModule.moduleId,
      })
    }

    const result: JsonTestResults = {
      numTotalTestSuites,
      numPassedTestSuites,
      numFailedTestSuites,
      numPendingTestSuites,
      numTotalTests,
      numPassedTests,
      numFailedTests,
      numPendingTests,
      numTodoTests,
      snapshot: this.ctx.snapshot.summary,
      startTime: this.start,
      success,
      testResults,
      coverageMap: this.coverageMap,
    }

    await this.writeReport(JSON.stringify(result))
  }

  /**
   * Writes the report to an output file if specified in the config,
   * or logs it to the console otherwise.
   * @param report
   */
  async writeReport(report: string): Promise<void> {
    const outputFile
      = this.options.outputFile ?? getOutputFile(this.ctx.config, 'json')

    if (outputFile) {
      const reportFile = resolve(this.ctx.config.root, outputFile)

      const outputDirectory = dirname(reportFile)
      if (!existsSync(outputDirectory)) {
        await fs.mkdir(outputDirectory, { recursive: true })
      }

      await fs.writeFile(reportFile, report, 'utf-8')
      this.ctx.logger.log(`JSON report written to ${reportFile}`)
    }
    else {
      this.ctx.logger.log(report)
    }
  }
}
