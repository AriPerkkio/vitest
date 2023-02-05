import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import type { AfterSuiteRunMeta, CoverageProvider, CoverageProviderModule, ReportContext, ResolvedCoverageOptions, Vitest } from 'vitest'
import { coverageConfigDefaults } from 'vitest/config'
import { normalizeFilename } from './coverage-report-tests/utils'

/**
 * Provider that simply keeps track of the function that were called
 */
class CustomCoverageProvider implements CoverageProvider {
  name = 'custom-coverage-provider'

  calls: string[] = []
  transformedFiles: string[] = []

  initialize(ctx: Vitest) {
    this.calls.push(`initialize ${ctx ? 'with' : 'without'} context`)
  }

  clean(force: boolean) {
    this.calls.push(`clean ${force ? 'with' : 'without'} force`)
  }

  onBeforeFilesRun() {
    this.calls.push('onBeforeFilesRun')
  }

  onAfterSuiteRun(meta: AfterSuiteRunMeta) {
    this.calls.push(`onAfterSuiteRun with ${JSON.stringify(meta)}`)
  }

  reportCoverage(reportContext?: ReportContext) {
    this.calls.push(`reportCoverage with ${JSON.stringify(reportContext)}`)

    const jsonReport = JSON.stringify({
      calls: this.calls,
      transformedFiles: this.transformedFiles.sort(),
    }, null, 2)

    if (existsSync('./coverage'))
      rmSync('./coverage', { maxRetries: 10, recursive: true })

    mkdirSync('./coverage')
    writeFileSync('./coverage/custom-coverage-provider-report.json', jsonReport, 'utf-8')
  }

  onFileTransform(code: string, id: string) {
    const filename = normalizeFilename(id)

    if (/\/src\//.test(filename))
      this.transformedFiles.push(filename)

    return { code }
  }

  resolveOptions(): ResolvedCoverageOptions {
    return {
      ...coverageConfigDefaults,
      enabled: true,

      // TODO: Fix. This does not pass to workers
      provider: new CustomCoverageProviderModule(),

    }
  }
}

export default class CustomCoverageProviderModule implements CoverageProviderModule {
  getProvider(): CoverageProvider {
    return new CustomCoverageProvider()
  }

  takeCoverage() {
    return { customCoverage: 'Custom coverage report from CustomCoverageProviderModule' }
  }
}
