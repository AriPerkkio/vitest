import c from 'tinyrainbow'
import type { Vitest } from '../core'
import type { Reporter } from '../types/reporter'
import { RandomSequencer } from '../sequencers/RandomSequencer'
import { hasFailed, hasFailedSnapshot } from '../../utils'
import { NewReporterAPI } from './new-reporter-api'

export interface BaseOptions {
  isTTY?: boolean
}

const BADGE_PADDING = '       '
const PAD = '      '

const LAST_RUN_LOG_TIMEOUT = 1_500

export abstract class NewBaseReporter extends NewReporterAPI implements Reporter {
  private _lastRunTimeout = 0
  private _lastRunTimer: NodeJS.Timeout | undefined
  private _lastRunCount = 0

  onInit(_: Vitest) {
    this.printBanner()
  }

  log(...messages: any) {
    this.ctx.logger.log(...messages)
  }

  onWatcherRerun() {
    this.ctx.logger.clearFullScreen('')
    this.printBanner()
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

  private resetLastRunLog() {
    clearInterval(this._lastRunTimer)
    this._lastRunTimer = undefined
  }
}

function withLabel(color: 'red' | 'green' | 'blue' | 'cyan', label: string, message: string) {
  return `\n${c.bold(c.inverse(c[color](` ${label} `)))} ${c[color](message)}`
}
