import { existsSync, promises as fs } from 'fs'
import { createRequire } from 'module'
import { pathToFileURL } from 'url'
import { resolve } from 'pathe'
import type { Profiler } from 'inspector'
import type { RawSourceMap } from 'vite-node'

import { toArray } from '../../utils'
import { configDefaults } from '../../defaults'
import type { BaseCoverageReporter } from './base'
import type { C8Options, ResolvedCoverageOptions } from '../../types'
import type { Vitest } from '../../node'

const require = createRequire(import.meta.url)

export class C8Reporter implements BaseCoverageReporter {
  ctx!: Vitest;
  options!: ResolvedCoverageOptions & { provider: "c8" }

  initialize(ctx: Vitest) {
    this.ctx = ctx;
    this.options = resolveC8Options(ctx.config.coverage, ctx.config.root)
  }

  resolveOptions() {
    return this.options;
  }

  isEnabled() {
    return this.ctx.config.coverage.provider === 'c8';
  }

  processUserConfig() {}

  async clean() {
    if (existsSync(this.options.reportsDirectory))
      await fs.rm(this.options.reportsDirectory, { recursive: true, force: true })

    if (!existsSync(this.options.tempDirectory))
      await fs.mkdir(this.options.tempDirectory, { recursive: true })
  }

  async report() {
    takeCoverage()

    const createReport = require('c8/lib/report')
    const report = createReport(this.ctx.config.coverage)

    // add source maps
    const sourceMapMeta: Record<string, { map: RawSourceMap; source: string | undefined }> = {}
    await Promise.all(Array
      .from(this.ctx.vitenode.fetchCache.entries())
      .filter(i => !i[0].includes('/node_modules/'))
      .map(async ([file, { result }]) => {
        const map = result.map
        if (!map)
          return

        const url = pathToFileURL(file).href

        let code: string | undefined
        try {
          code = (await fs.readFile(file)).toString()
        }
        catch {}

        // Vite does not report full path in sourcemap sources
        // so use an actual file path
        const sources = [url]

        sourceMapMeta[url] = {
          source: result.code,
          map: {
            sourcesContent: code ? [code] : undefined,
            ...map,
            sources,
          },
        }
      }))

    // This is a magic number. It corresponds to the amount of code
    // that we add in packages/vite-node/src/client.ts:114 (vm.runInThisContext)
    // TODO: Include our transformations in sourcemaps
    const offset = 224

    report._getSourceMap = (coverage: Profiler.ScriptCoverage) => {
      const path = pathToFileURL(coverage.url).href
      const data = sourceMapMeta[path]

      if (!data)
        return {}

      return {
        sourceMap: {
          sourcemap: data.map,
        },
        source: Array(offset).fill('.').join('') + data.source,
      }
    }

    await report.run()

    if (this.ctx.config.coverage.enabled && this.ctx.config.coverage.provider === 'c8') {
      if (this.ctx.config.coverage['100']) {
        this.ctx.config.coverage.lines = 100
        this.ctx.config.coverage.functions = 100
        this.ctx.config.coverage.branches = 100
        this.ctx.config.coverage.statements = 100
      }

      const { checkCoverages } = require('c8/lib/commands/check-coverage')
      await checkCoverages(this.ctx.config.coverage, report)
    }

  }
}

function resolveC8Options(options: C8Options, root: string) {
  const resolved = {
    ...configDefaults.coverage,
    ...options as any,
  }

  resolved.reporter = toArray(resolved.reporter)
  resolved.reportsDirectory = resolve(root, resolved.reportsDirectory)
  resolved.tempDirectory = process.env.NODE_V8_COVERAGE || resolve(resolved.reportsDirectory, 'tmp')

  return resolved
}

// Flush coverage to disk
function takeCoverage() {
  const v8 = require('v8')
  if (v8.takeCoverage == null)
    console.warn('[Vitest] takeCoverage is not available in this NodeJs version.\nCoverage could be incomplete. Update to NodeJs 14.18.')
  else
    v8.takeCoverage()
}
