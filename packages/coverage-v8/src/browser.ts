import type { CoverageRuntime } from 'vitest'
import { cdp } from '@vitest/browser/context'

const session = cdp()
let enabled = false

type ScriptCoverage = Awaited<ReturnType<typeof session.send<'Profiler.takePreciseCoverage'>>>

const runtime: CoverageRuntime = {
  async startCoverage() {
    if (enabled) {
      return
    }

    enabled = true

    await session.send('Profiler.enable')
    await session.send('Profiler.startPreciseCoverage', { callCount: true, detailed: true })
  },

  async takeCoverage(): Promise<{ result: any[] }> {
    const coverage = await session.send('Profiler.takePreciseCoverage')

    // Reduce amount of data sent over rpc by doing some early result filtering
    const result = coverage.result
      .filter(filterResult)
      .map(res => ({
        ...res,
        url: decodeURIComponent(res.url.replace(window.location.origin, '')),
      }))

    return { result }
  },

  stopCoverage() {
    // Browser mode should not stop coverage as same V8 instance is shared between tests
  },
}

export default runtime

function filterResult(coverage: ScriptCoverage['result'][number]): boolean {
  if (!coverage.url.startsWith(window.location.origin)) {
    return false
  }

  if (coverage.url.includes('/node_modules/')) {
    return false
  }

  if (coverage.url.includes('__vitest_browser__')) {
    return false
  }

  if (coverage.url.includes('__vitest__/assets')) {
    return false
  }

  if (coverage.url === window.location.href) {
    return false
  }

  if (coverage.url.includes('?browserv=') || coverage.url.includes('&browserv=')) {
    return false
  }

  return true
}
