import { existsSync, promises as fs, readFileSync } from 'fs'
import { fileURLToPath, pathToFileURL } from 'url'
import type { Profiler } from 'inspector'
import { normalize, resolve } from 'pathe'
import c from 'picocolors'
import { provider } from 'std-env'
import type { EncodedSourceMap, FetchResult } from 'vite-node'
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
const OFFSET_NODE_VM = '.'.repeat(185)

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
    const shouldInstrument = (result: Profiler.ScriptCoverage): Boolean => report._shouldInstrument(result.url)

    if (this.ctx.isBrowserEnabled()) {
      const replaceUrl = (result: Profiler.ScriptCoverage) => {
        return {
          ...result,
          // TODO: use a better way to replace url
          url: result.url.replace('http://localhost:63315', this.ctx.config.root).split('?')[0],
        }
      }

      this.coverages = this.coverages.map(coverage => ({
        ...coverage,
        result: coverage.result
          .map(replaceUrl)
          .filter(shouldInstrument)
          .map(result => ({ ...result, url: pathToFileURL(result.url).href })),
      })).filter(coverage => coverage.result.length > 0)
    }

    // Overwrite C8's loader as results are in memory instead of file system
    report._loadReports = () => this.coverages

    // TODO: What to do when a file is loaded both by Node and Browser?
    let transformResults: Map<string, { result: FetchResult }> = this.ctx.vitenode.fetchCache

    if (this.ctx.isBrowserEnabled()) {
      transformResults = new Map<string, { result: { code?: string; map?: EncodedSourceMap } }>()

      for (const coverage of this.coverages) {
        for (const { url } of coverage.result) {
          const path = fileURLToPath(url)
          const result = await this.ctx.browser.transformRequest(path)
          if (result) {
            transformResults.set(path, {
              result: {
                code: result.code,
                map: result.map as any,
              },
            })
          }
          else {
            this.ctx.logger.error(`No transform result for ${url}`)
          }
        }
      }
    }

    // writeFileSync('./v8-coverage.json', JSON.stringify(this.coverages, null, 2), 'utf-8')
    // writeFileSync('./transformResults.json', JSON.stringify(Array.from(transformResults.entries()), null, 2), 'utf-8')

    const originalGetSourceMap = report._getSourceMap
    report._getSourceMap = (coverage: Profiler.ScriptCoverage) => {
      const path = normalize(coverage.url.split('?')[0])
      const transformResult = transformResults.get(path)
      const map = transformResult?.result.map

      if (!map) {
        this.ctx.logger.error(`Unable to find source maps for ${path}.`)
        return originalGetSourceMap.call(report, coverage)
      }

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
        source: (this.ctx.isBrowserEnabled() ? '' : OFFSET_NODE_VM) + transformResult.result.code,
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
        configurationFile: this.ctx.server.config.configFile,
      })
    }
  }
}
