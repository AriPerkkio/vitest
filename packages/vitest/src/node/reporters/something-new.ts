import type { Writable } from 'node:stream'
import type { File } from '@vitest/runner'
import type { Vitest } from '../core'
import type { Reporter } from '../types/reporter'
import { NewBaseReporter } from './new-base'
import type { TestCase } from './reported-tasks'

const ESC = '\x1B['
const CLEAR_LINE = `${ESC}K`
const MOVE_CURSOR_ONE_ROW_UP = `${ESC}1A`
const SYNC_START = `${ESC}?2026h`
const SYNC_END = `${ESC}?2026l`

type StreamType = 'output' | 'error'

export class SomethingNewReporter extends NewBaseReporter implements Reporter {
  verbose: boolean = true

  private runningTests = new Map<string, { total: number; completed: number }>()
  private maxParallelTests = 0
  private summaryHeight = 0
  private streams!: Record<StreamType, (NodeJS.WriteStream | Writable)['write']>

  private suites = { total: 0, completed: 0 }
  private tests = { total: 0, completed: 0 }

  onInit(ctx: Vitest) {
    this.ctx = ctx

    this.streams = {
      output: this.ctx.logger.outputStream.write.bind(this.ctx.logger.outputStream),
      error: this.ctx.logger.errorStream.write.bind(this.ctx.logger.errorStream),
    }

    this.interceptStream(process.stdout, 'output')
    this.interceptStream(process.stderr, 'error')

    super.onInit(ctx)
  }

  onPathsCollected(paths?: string[]) {
    this.suites.total = (paths || []).length
  }

  onFinished(_: File[]) {
    this.runningTests.clear()

    this.render()
  }

  onWatcherRerun(files: string[], trigger?: string) {
    this.runningTests.clear()
    this.summaryHeight = 0
    this.suites = { completed: 0, total: 0 }
    this.tests = { completed: 0, total: 0 }

    super.onWatcherRerun(files, trigger)
  }

  onTestPrepare(test: TestCase) {
    const filename = test.task.file.name

    if (!this.runningTests.has(filename)) {
      const total = test.parent.children.size
      this.runningTests.set(filename, { total, completed: 0 })
      this.tests.total += total
    }

    this.render()
  }

  onTestFinished(test: TestCase) {
    this.tests.completed++

    const file = test.task.file
    const meta = this.runningTests.get(file.name)!

    const completed = 1 + meta.completed
    const total = meta.total

    this.runningTests.set(file.name, { total, completed })

    if (completed === total) {
      this.onTestFileFinished(file)
    }

    this.render()
  }

  onTestFileFinished(file: File) {
    this.suites.completed++
    this.runningTests.delete(file.name)
    this.render(`✓ ${file.name}\n`)
  }

  onTestFailed(test: TestCase) {
    this.tests.completed++

    this.render(`Failed ${test.name}\n`)
  }

  private render(message?: string, type: StreamType = 'output') {
    const summary = this.createSummary()

    this.write(SYNC_START, type)
    this.clearSummary()

    if (message) {
      this.write(message, type)
    }

    this.write(summary.join('\n'), type)
    this.write(SYNC_END, type)

    this.summaryHeight = summary.length
  }

  private createSummary() {
    const summary = ['']
    const columns = 'columns' in this.ctx.logger.outputStream ? this.ctx.logger.outputStream.columns : 80

    function push(message: string) {
      if (message.length === 0) {
        return summary.push(message)
      }

      for (let i = 0; i < message.length; i += columns) {
        summary.push(message.slice(i, i + columns))
      }
    }

    for (const test of this.runningTests.keys()) {
      push(`RUNNING ${test}`)
    }

    if (this.runningTests.size > this.maxParallelTests) {
      this.maxParallelTests = this.runningTests.size
    }

    const remaining = (this.suites.total - this.suites.completed)
    this.maxParallelTests = Math.min(remaining, this.maxParallelTests)

    for (let i = 0; i < this.maxParallelTests - this.runningTests.size; i++) {
      push('')
    }

    push('')
    push(`Test Suites: ${this.suites.completed} of ${this.suites.total}`)
    push(`Tests: ${this.tests.completed} of ${this.tests.total}`)
    push('')

    return summary
  }

  private clearSummary() {
    if (this.summaryHeight === 0) {
      return
    }

    this.write(CLEAR_LINE)

    for (let i = 1; i < this.summaryHeight; i++) {
      this.write(`${MOVE_CURSOR_ONE_ROW_UP}${CLEAR_LINE}`)
    }
  }

  private interceptStream(stream: NodeJS.WriteStream, type: StreamType) {
    // @ts-expect-error -- not sure how 2 overloads should be typed
    stream.write = (chunk, _, callback) => {
      if (chunk) {
        this.render(chunk.toString(), type)
      }
      callback?.()
    }
  }

  private write(message: string, type: 'output' | 'error' = 'output') {
    (this.streams[type] as Writable['write'])(message)
  }
}
