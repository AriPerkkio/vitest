import { existsSync, promises as fs, readFileSync } from 'node:fs'
import type { Profiler } from 'node:inspector'
import { normalize, resolve } from 'pathe'
import c from 'picocolors'
import { provider } from 'std-env'
import { coverageConfigDefaults } from 'vitest/config'
import { BaseCoverageProvider } from 'vitest/coverage'
// eslint-disable-next-line no-restricted-imports
import type { AfterSuiteRunMeta, CoverageC8Options, CoverageProvider, ReportContext, ResolvedCoverageOptions } from 'vitest'
import type { Vitest } from 'vitest/node'
import type { Report } from 'c8'
// @ts-expect-error missing types
import createReport from 'c8/lib/report.js'
// @ts-expect-error missing types
import { checkCoverages } from 'c8/lib/commands/check-coverage.js'

type Options = ResolvedCoverageOptions<'c8'>

// This is a magic number. It corresponds to the amount of code
// that we add in packages/vite-node/src/client.ts:114 (vm.runInThisContext)
// TODO: Include our transformations in sourcemaps
const OFFSET = '.'.repeat(185)

export class C8CoverageProvider extends BaseCoverageProvider implements CoverageProvider {
  name = 'c8'

  ctx!: Vitest
  options!: Options
  coverages: Profiler.TakePreciseCoverageReturnType[] = []

  initialize(ctx: Vitest) {
    const config: CoverageC8Options = ctx.config.coverage

    this.ctx = ctx
    this.options = {
      ...coverageConfigDefaults,

      // Provider specific defaults
      excludeNodeModules: true,
      allowExternal: false,

      // User's options
      ...config,

      // Resolved fields
      provider: 'c8',
      reporter: this.resolveReporters(config.reporter || coverageConfigDefaults.reporter),
      reportsDirectory: resolve(ctx.config.root, config.reportsDirectory || coverageConfigDefaults.reportsDirectory),
      lines: config['100'] ? 100 : config.lines,
      functions: config['100'] ? 100 : config.functions,
      branches: config['100'] ? 100 : config.branches,
      statements: config['100'] ? 100 : config.statements,
    }
  }

  resolveOptions() {
    return this.options
  }

  async clean(clean = true) {
    if (clean && existsSync(this.options.reportsDirectory))
      await fs.rm(this.options.reportsDirectory, { recursive: true, force: true, maxRetries: 10 })

    this.coverages = []
  }

  onAfterSuiteRun({ coverage }: AfterSuiteRunMeta) {
    this.coverages.push(coverage as Profiler.TakePreciseCoverageReturnType)
  }

  async reportCoverage({ allTestsRun }: ReportContext = {}) {
    if (provider === 'stackblitz')
      this.ctx.logger.log(c.blue(' % ') + c.yellow('@vitest/coverage-c8 does not work on Stackblitz. Report will be empty.'))

    const options: ConstructorParameters<typeof Report>[0] = {
      ...this.options,
      all: this.options.all && allTestsRun,
      reporter: this.options.reporter.map(([reporterName]) => reporterName),
      reporterOptions: this.options.reporter.reduce((all, [name, options]) => ({
        ...all,
        [name]: {
          skipFull: this.options.skipFull,
          projectRoot: this.ctx.config.root,
          ...options,
        },
      }), {}),
    }

    const report = createReport(options)

    // Overwrite C8's loader as results are in memory instead of file system
    report._loadReports = () => this.coverages

    const originalGetSourceMap = report._getSourceMap
    report._getSourceMap = (coverage: Profiler.ScriptCoverage) => {
      const path = normalize(coverage.url.split('?')[0])
      const transformResult = this.ctx.vitenode.fetchCache.get(path)
      const map = transformResult?.result.map

      if (!map)
        return originalGetSourceMap.call(report, coverage)

      let sourcesContent = map.sourcesContent?.[0]

      try {
        // The map.sourcesContent is present most of the time. Fallback to file system in edge cases.
        sourcesContent = sourcesContent || readFileSync(path, 'utf-8')
      }
      catch { }

      return {
        sourceMap: {
          sourcemap: {
            ...map,
            sourcesContent: sourcesContent ? [sourcesContent] : [],
            sources: [path],
          },
        },
        // Length of each line in source should match the code that was run in `node:vm`.
        // V8 reports use offsets starting from the first column of first line.
        source: OFFSET + transformResult.result.code,
      }
    }

    await report.run()
    await checkCoverages(options, report)

    if (this.options.thresholdAutoUpdate && allTestsRun) {
      this.updateThresholds({
        coverageMap: await report.getCoverageMapFromAllCoverageFiles(),
        thresholds: {
          branches: this.options.branches,
          functions: this.options.functions,
          lines: this.options.lines,
          statements: this.options.statements,
        },
        perFile: this.options.perFile,
        configurationFile: this.ctx.server.config.configFile,
      })
    }
  }
}
