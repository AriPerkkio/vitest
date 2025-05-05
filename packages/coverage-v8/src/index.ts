import type { Profiler } from 'node:inspector'
import type { CoverageRuntime } from 'vitest'
import type { ScriptCoverageWithOffset } from './types'
import inspector from 'node:inspector/promises'
import { fileURLToPath } from 'node:url'
import { provider } from 'std-env'

const session = new inspector.Session()
let enabled = false

const runtime: CoverageRuntime = {
  async startCoverage({ isolate }) {
    if (isolate === false && enabled) {
      return
    }

    enabled = true

    session.connect()
    await session.post('Profiler.enable')
    await session.post('Profiler.startPreciseCoverage', { callCount: true, detailed: true })
  },

  async takeCoverage(options): Promise<{ result: ScriptCoverageWithOffset[] }> {
    if (provider === 'stackblitz') {
      return { result: [] }
    }

    const coverage = await session.post('Profiler.takePreciseCoverage')

    const result = coverage.result
      .filter(filterResult)
      .map(res => ({
        ...res,
        startOffset: options?.moduleExecutionInfo?.get(fileURLToPath(res.url))?.startOffset || 0,
      }))

    return { result }
  },

  async stopCoverage({ isolate }) {
    if (isolate === false) {
      return
    }

    await session.post('Profiler.stopPreciseCoverage')
    await session.post('Profiler.disable')
    session.disconnect()
  },

}

export default runtime

function filterResult(coverage: Profiler.ScriptCoverage): boolean {
  if (!coverage.url.startsWith('file://')) {
    return false
  }

  if (coverage.url.includes('/node_modules/')) {
    return false
  }

  return true
}
