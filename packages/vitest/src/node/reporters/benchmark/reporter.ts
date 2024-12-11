import type { File, Task, TaskResultPack } from '@vitest/runner'
import type { Vitest } from '../../core'
import fs from 'node:fs'
import { getFullName, getTests } from '@vitest/runner/utils'
import * as pathe from 'pathe'
import c from 'tinyrainbow'
import { BaseReporter } from '../base'
import { getStateSymbol } from '../renderers/utils'
import { WindowRenderer } from '../renderers/windowedRenderer'
import { TaskParser } from '../task-parser'
import { createBenchmarkJsonReport, flattenFormattedBenchmarkReport } from './json-formatter'
import { renderTable } from './tableRender'

export class BenchmarkReporter extends BaseReporter {
  private summary?: BenchSummary
  compare?: Parameters<typeof renderTable>[0]['compare']

  async onInit(ctx: Vitest) {
    super.onInit(ctx)

    if (this.isTTY) {
      this.summary = new BenchSummary()
      this.summary.onInit(ctx)
    }

    if (this.ctx.config.benchmark?.compare) {
      const compareFile = pathe.resolve(
        this.ctx.config.root,
        this.ctx.config.benchmark?.compare,
      )
      try {
        this.compare = flattenFormattedBenchmarkReport(
          JSON.parse(await fs.promises.readFile(compareFile, 'utf-8')),
        )
      }
      catch (e) {
        this.error(`Failed to read '${compareFile}'`, e)
      }
    }
  }

  onTaskUpdate(packs: TaskResultPack[]) {
    this.summary?.onTaskUpdate(packs)
    super.onTaskUpdate(packs)
  }

  printTask(task: Task) {
    if (task?.type !== 'suite' || !task.result?.state || task.result?.state === 'run') {
      return
    }

    const benches = task.tasks.filter(t => t.meta.benchmark)
    const duration = task.result.duration

    if (benches.length > 0 && benches.every(t => t.result?.state !== 'run')) {
      let title = ` ${getStateSymbol(task)} ${getFullName(task, c.dim(' > '))}`

      if (duration != null && duration > this.ctx.config.slowTestThreshold) {
        title += c.yellow(` ${Math.round(duration)}${c.dim('ms')}`)
      }

      this.log(title)
      this.log(renderTable({
        tasks: benches,
        level: 1,
        shallow: true,
        columns: this.ctx.logger.getColumns(),
        compare: this.compare,
        showHeap: this.ctx.config.logHeapUsage,
        slowTestThreshold: this.ctx.config.slowTestThreshold,
      }))
    }
  }

  async onFinished(files = this.ctx.state.getFiles(), errors = this.ctx.state.getUnhandledErrors()) {
    super.onFinished(files, errors)

    // write output for future comparison
    let outputFile = this.ctx.config.benchmark?.outputJson

    if (outputFile) {
      outputFile = pathe.resolve(this.ctx.config.root, outputFile)
      const outputDirectory = pathe.dirname(outputFile)

      if (!fs.existsSync(outputDirectory)) {
        await fs.promises.mkdir(outputDirectory, { recursive: true })
      }

      const output = createBenchmarkJsonReport(files)
      await fs.promises.writeFile(outputFile, JSON.stringify(output, null, 2))
      this.log(`Benchmark report written to ${outputFile}`)
    }
  }
}

class BenchSummary extends TaskParser {
  private renderer!: WindowRenderer
  private runningTest?: File
  private finishedTests: Set<File['id']> = new Set()

  onInit(ctx: Vitest): void {
    this.ctx = ctx

    this.renderer = new WindowRenderer({
      logger: ctx.logger,
      getWindow: () => this.createSummary(),
      interval: 50,
    })

    this.ctx.onClose(() => this.renderer.stop())
  }

  onTestFilePrepare(file: File) {
    if (this.finishedTests.has(file.id)) {
      return
    }

    this.runningTest = file
  }

  onTestFileFinished(file: File) {
    this.finishedTests.add(file.id)
    this.runningTest = undefined
  }

  createSummary() {
    if (!this.runningTest) {
      return ['']
    }

    const tasks = getTests(this.runningTest)
    const duration = this.runningTest.result?.duration

    let title = ` ${getStateSymbol(this.runningTest)} ${getFullName(this.runningTest, c.dim(' > '))}`

    if (duration != null && duration > this.ctx.config.slowTestThreshold) {
      title += c.yellow(` ${Math.round(duration)}${c.dim('ms')}`)
    }

    return [
      '',
      title,
      ...renderTable({
        tasks,
        level: 1,
        shallow: true,
        columns: this.ctx.logger.getColumns(),
        showHeap: this.ctx.config.logHeapUsage,
        slowTestThreshold: this.ctx.config.slowTestThreshold,
      }).split('\n'),
      '',
    ]
  }
}
