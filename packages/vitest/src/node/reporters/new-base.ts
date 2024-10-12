import c from 'tinyrainbow'
import { relative } from 'pathe'
import { getTestName, getTests, hasFailed } from '@vitest/runner/utils'
import { toArray } from '@vitest/utils'
import type { Task } from '@vitest/runner'
import type { Vitest } from '../core'
import type { Reporter } from '../types/reporter'
import { RandomSequencer } from '../sequencers/RandomSequencer'
import { hasFailedSnapshot } from '../../utils/tasks'
import { isCI, isDeno, isNode } from '../../utils/env'
import { NewReporterAPI } from './new-reporter-api'
import { formatProjectName, getStateSymbol, taskFail } from './renderers/utils'
import { F_CHECK, F_RIGHT } from './renderers/figures'

export interface BaseOptions {
  isTTY?: boolean
}

const BADGE_PADDING = '       '
const PAD = '      '

const LAST_RUN_LOG_TIMEOUT = 1_500

export abstract class NewBaseReporter extends NewReporterAPI implements Reporter {
  isTTY: boolean
  watchFilters?: string[]
  failedUnwatchedFiles: Task[] = []
  start = 0
  end = 0

  private _filesInWatchMode = new Map<string, number>()
  private _lastRunTimeout = 0
  private _lastRunTimer: NodeJS.Timeout | undefined
  private _lastRunCount = 0
  private _timeStart = new Date()

  constructor(options: BaseOptions = {}) {
    super()
    this.isTTY = options.isTTY ?? ((isNode || isDeno) && process.stdout?.isTTY && !isCI)
  }

  onInit(_: Vitest) {
    this.printBanner()
  }

  log(...messages: any) {
    this.ctx.logger.log(...messages)
  }

  onWatcherRerun(files: string[], trigger?: string) {
    this.resetLastRunLog()
    this.watchFilters = files
    this.failedUnwatchedFiles = this.ctx.state.getFiles().filter(file =>
      !files.includes(file.filepath) && hasFailed(file),
    )

    files.forEach((filepath) => {
      let reruns = this._filesInWatchMode.get(filepath) ?? 0
      this._filesInWatchMode.set(filepath, ++reruns)
    })

    let banner = trigger ? c.dim(` ${this.relative(trigger)} `) : ''

    if (files.length > 1 || !files.length) {
      this._lastRunCount = 0
    }
    else if (files.length === 1) {
      const rerun = this._filesInWatchMode.get(files[0]) ?? 1
      this._lastRunCount = rerun
      banner += c.blue(`x${rerun} `)
    }

    this.ctx.logger.clearFullScreen('')
    this.log(withLabel('blue', 'RERUN', banner) + c.gray(this.ctx.config.root))

    if (this.ctx.configOverride.project) {
      this.log(BADGE_PADDING + c.dim(' Project name: ') + c.blue(toArray(this.ctx.configOverride.project).join(', ')))
    }

    if (this.ctx.filenamePattern) {
      this.log(BADGE_PADDING + c.dim(' Filename pattern: ') + c.blue(this.ctx.filenamePattern))
    }

    if (this.ctx.configOverride.testNamePattern) {
      this.log(BADGE_PADDING + c.dim(' Test name pattern: ') + c.blue(String(this.ctx.configOverride.testNamePattern)))
    }

    if (!this.isTTY) {
      for (const task of this.failedUnwatchedFiles) {
        this.printTask(task)
      }
    }

    this._timeStart = new Date()
    this.start = performance.now()
  }

  onWatcherStart(files = this.ctx.state.getFiles(), errors = this.ctx.state.getUnhandledErrors()) {
    const failed = errors.length > 0 || hasFailed(files)
    const failedSnap = hasFailedSnapshot(files)
    const cancelled = this.ctx.isCancelling

    if (failed) {
      this.ctx.logger.log(withLabel('red', 'FAIL', 'Tests failed. Watching for file changes...'))
    }
    else if (cancelled) {
      this.ctx.logger.log(withLabel('red', 'CANCELLED', 'Test run cancelled. Watching for file changes...'))
    }
    else {
      this.ctx.logger.log(withLabel('green', 'PASS', 'Waiting for file changes...'))
    }

    const hints = [c.dim('press ') + c.bold('h') + c.dim(' to show help')]

    if (failedSnap) {
      hints.unshift(c.dim('press ') + c.bold(c.yellow('u')) + c.dim(' to update snapshot'))
    }
    else {
      hints.push(c.dim('press ') + c.bold('q') + c.dim(' to quit'))
    }

    this.ctx.logger.log(BADGE_PADDING + hints.join(c.dim(', ')))

    if (this._lastRunCount) {
      const LAST_RUN_TEXT = `rerun x${this._lastRunCount}`
      const LAST_RUN_TEXTS = [
        c.blue(LAST_RUN_TEXT),
        c.gray(LAST_RUN_TEXT),
        c.dim(c.gray(LAST_RUN_TEXT)),
      ]
      this.log(BADGE_PADDING + LAST_RUN_TEXTS[0])

      this._lastRunTimeout = 0
      this._lastRunTimer = setInterval(() => {
        this._lastRunTimeout += 1
        if (this._lastRunTimeout >= LAST_RUN_TEXTS.length) {
          this.resetLastRunLog()
        }
        else {
          this.log(BADGE_PADDING + LAST_RUN_TEXTS[this._lastRunTimeout])
        }
      }, LAST_RUN_LOG_TIMEOUT / LAST_RUN_TEXTS.length)
    }
  }

  protected printTask(task: Task) {
    if (
      !('filepath' in task)
      || !task.result?.state
      || task.result?.state === 'run') {
      return
    }

    const tests = getTests(task)
    const failed = tests.filter(t => t.result?.state === 'fail')
    const skipped = tests.filter(t => t.mode === 'skip' || t.mode === 'todo')

    let state = c.dim(`${tests.length} test${tests.length > 1 ? 's' : ''}`)

    if (failed.length) {
      state += c.dim(' | ') + c.red(`${failed.length} failed`)
    }

    if (skipped.length) {
      state += c.dim(' | ') + c.yellow(`${skipped.length} skipped`)
    }

    let suffix = c.dim(' (') + state + c.dim(')') + this.getDurationPrefix(task)

    if (this.ctx.config.logHeapUsage && task.result.heap != null) {
      suffix += c.magenta(` ${Math.floor(task.result.heap / 1024 / 1024)} MB heap used`)
    }

    let title = getStateSymbol(task)

    if (task.meta.typecheck) {
      title += `${c.bgBlue(c.bold(' TS '))} `
    }

    if (task.projectName) {
      title += formatProjectName(task.projectName)
    }

    this.log(` ${title}${task.name} ${suffix}`)

    for (const test of tests) {
      const duration = test.result?.duration

      if (test.result?.state === 'fail') {
        const suffix = this.getDurationPrefix(test)
        this.log(c.red(`   ${taskFail} ${getTestName(test, c.dim(' > '))}${suffix}`))

        test.result?.errors?.forEach((e) => {
          // print short errors, full errors will be at the end in summary
          this.log(c.red(`     ${F_RIGHT} ${e?.message}`))
        })
      }

      // also print slow tests
      else if (duration && duration > this.ctx.config.slowTestThreshold) {
        this.log(`   ${c.yellow(c.dim(F_CHECK))} ${getTestName(test, c.dim(' > '))} ${c.yellow(Math.round(duration) + c.dim('ms'))}`)
      }
    }
  }

  private printBanner() {
    this.log()

    const color = this.ctx.config.watch ? 'blue' : 'cyan'
    const mode = this.ctx.config.watch ? 'DEV' : 'RUN'

    this.log(withLabel(color, mode, `v${this.ctx.version}`) + c.gray(this.ctx.config.root))

    if (this.ctx.config.sequence.sequencer === RandomSequencer) {
      this.log(PAD + c.gray(`Running tests with seed "${this.ctx.config.sequence.seed}"`))
    }

    this.ctx.projects.forEach((project) => {
      if (!project.browser) {
        return
      }
      const name = project.getName()
      const output = project.isCore() ? '' : ` [${name}]`

      const resolvedUrls = project.browser.vite.resolvedUrls
      const origin = resolvedUrls?.local[0] ?? resolvedUrls?.network[0]
      const provider = project.browser.provider.name
      const providerString = provider === 'preview' ? '' : ` by ${provider}`

      this.log(PAD + c.dim(c.green(`${output} Browser runner started${providerString} at ${new URL('/', origin)}`)))
    })

    if (this.ctx.config.ui) {
      this.log(PAD + c.dim(c.green(`UI started at http://${this.ctx.config.api?.host || 'localhost'}:${c.bold(`${this.ctx.server.config.server.port}`)}${this.ctx.config.uiBase}`)))
    }
    else if (this.ctx.config.api?.port) {
      const resolvedUrls = this.ctx.server.resolvedUrls
      // workaround for https://github.com/vitejs/vite/issues/15438, it was fixed in vite 5.1
      const fallbackUrl = `http://${this.ctx.config.api.host || 'localhost'}:${this.ctx.config.api.port}`
      const origin = resolvedUrls?.local[0] ?? resolvedUrls?.network[0] ?? fallbackUrl

      this.log(PAD + c.dim(c.green(`API started at ${new URL('/', origin)}`)))
    }

    if (this.ctx.coverageProvider) {
      this.log(PAD + c.dim('Coverage enabled with ') + c.yellow(this.ctx.coverageProvider.name))
    }

    if (this.ctx.config.standalone) {
      this.log(c.yellow(`\nVitest is running in standalone mode. Edit a test file to rerun tests.`))
    }
    else {
      this.log()
    }
  }

  private relative(path: string) {
    return relative(this.ctx.config.root, path)
  }

  private resetLastRunLog() {
    clearInterval(this._lastRunTimer)
    this._lastRunTimer = undefined
  }

  private getDurationPrefix(task: Task) {
    if (!task.result?.duration) {
      return ''
    }

    const color = task.result.duration > this.ctx.config.slowTestThreshold
      ? c.yellow
      : c.gray

    return color(` ${Math.round(task.result.duration)}${c.dim('ms')}`)
  }
}

function withLabel(color: 'red' | 'green' | 'blue' | 'cyan', label: string, message: string) {
  return `\n${c.bold(c.inverse(c[color](` ${label} `)))} ${c[color](message)}`
}
