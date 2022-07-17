import { resolve } from 'pathe';
import { ExistingRawSourceMap, TransformPluginContext } from 'rollup';
import { createRequire } from 'module'

import { configDefaults } from '../../defaults'
import type { UserConfig } from '../../config';
import type { Vitest } from '../../node'
import { IstanbulOptions, ResolvedCoverageOptions } from '../../types';
import type { BaseCoverageReporter } from './base'

const require = createRequire(import.meta.url)

interface Instrumenter {
  /* Instrument the supplied code and track coverage against the supplied filename. It throws if invalid code is passed to it. ES5 and ES6 syntax is supported. To instrument ES6 modules, make sure that you set the esModules property to true when creating the instrumenter. */
  instrumentSync(
    /* The code to instrument */
    code: string,
    /* The filename against which to track coverage. */
    filename: string,
    /* The source map that maps the not instrumented code back to it's original form. Is assigned to the coverage object and therefore, is available in the json output and can be used to remap the coverage to the untranspiled source.): string; */
    inputSourceMap: object
  ): string;

  /* Returns the file coverage object for the last file instrumented. */
  lastSourceMap(): ExistingRawSourceMap;
}

export class IstanbulReporter implements BaseCoverageReporter {
    ctx!: Vitest;
    options!: ResolvedCoverageOptions & { provider: "istanbul" }
    instrumenter!: Instrumenter;

    initialize(ctx: Vitest) {
        this.ctx = ctx;
        this.options = resolveIstanbulOptions(ctx.config.coverage, ctx.config.root)

        const { createInstrumenter } = require('istanbul-lib-instrument')

        this.instrumenter = createInstrumenter(this.options)
    }

    resolveOptions(): ResolvedCoverageOptions {
      return this.options;
    }

    processUserConfig(userConfig: UserConfig) {
        userConfig.build = userConfig.build || {}
        userConfig.build.sourcemap = true
    }

    isEnabled() {
        // @ts-expect-error -- todo
        return this.ctx.config.coverage.reporter === 'nyc';
    }

    instrument(sourceCode: string, id: string, pluginCtx: TransformPluginContext) {
          const sourceMap = sanitizeSourceMap(pluginCtx.getCombinedSourcemap())
          const code = this.instrumenter.instrumentSync(sourceCode, id, sourceMap)
          const map = this.instrumenter.lastSourceMap()

          return { code, map }
    }

    clean() {}

    report() {
        const libReport = require('istanbul-lib-report')
        const reports = require('istanbul-reports')
        const libCoverage = require('istanbul-lib-coverage')

        const context = libReport.createContext({
            dir: './coverage',
            // @ts-expect-error -- todo
            coverageMap: libCoverage.createCoverageMap(globalThis.__VITEST_COVERAGE__),
          })

          reports.create('lcov').execute(context)
    }
}

function sanitizeSourceMap(rawSourceMap: ExistingRawSourceMap): ExistingRawSourceMap {
  // Delete sourcesContent since it is optional and if it contains process.env.NODE_ENV vite will break when trying to replace it
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { sourcesContent, ...sourceMap } = rawSourceMap

  // JSON parse/stringify trick required for istanbul to accept the SourceMap
  return JSON.parse(JSON.stringify(sourceMap))
}

function resolveIstanbulOptions(options: IstanbulOptions, root: string) {
  const reportsDirectory = resolve(root, options.reportsDirectory || configDefaults.coverage.reportsDirectory!)

  const resolved = {
      ...configDefaults.coverage,

      // Custom
      provider: "istanbul",
      coverageVariable: '__VITEST_COVERAGE__',
      coverageGlobalScope: 'globalThis',
      coverageGlobalScopeFunc: false,
      esModules: true,

      // Defaults from nyc, https://github.com/istanbuljs/nyc/blob/master/lib/instrumenters/istanbul.js#L7
      preserveComments: true,
      produceSourceMap: true,
      autoWrap: true,

      // Overrides
      ...options,

      reportsDirectory,
      tempDirectory: resolve(reportsDirectory, 'tmp')
    }

    return resolved as ResolvedCoverageOptions & { provider: "istanbul" }
}