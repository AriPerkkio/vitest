/*
 * For details about the Profiler.* messages see https://chromedevtools.github.io/devtools-protocol/v8/Profiler/
*/

import type { Profiler } from 'node:inspector'
// eslint-disable-next-line no-restricted-imports
import type { V8Session } from 'vitest'

let session: V8Session

export async function startCoverage(v8Session?: V8Session) {
  session ||= v8Session || await initializeNodeV8Session()

  await session.connect?.()
  await session.post('Profiler.enable')
  await session.post('Profiler.startPreciseCoverage', {
    callCount: true,
    detailed: true,
  })
}

export async function takeCoverage(): Promise<Profiler.TakePreciseCoverageReturnType> {
  const coverage: Profiler.TakePreciseCoverageReturnType = await session.post('Profiler.takePreciseCoverage')

  // Reduce amount of data sent over rpc by doing some early result filtering
  const result = coverage.result.filter(filterResult)

  return { result }
}

export async function stopCoverage() {
  await session.post('Profiler.stopPreciseCoverage')
  await session.post('Profiler.disable')
  await session.disconnect?.()
}

async function initializeNodeV8Session(): Promise<V8Session> {
  const inspector = await import(['node', 'inspector'].join(':'))
  const session = new inspector.Session()

  return {
    connect: () => session.connect(),
    disconnect: () => session.disconnect(),
    post: async (command, options) => {
      return new Promise((resolve, reject) => {
        session.post(command, options, (error: any, result: any) => {
          if (error)
            return reject(error)

          resolve(result)
        })
      })
    },
  }
}

function filterResult(coverage: Profiler.ScriptCoverage): boolean {
  if (!coverage.url.startsWith('file://') && !coverage.url.startsWith('http://'))
    return false

  if (coverage.url.includes('/node_modules/'))
    return false

  return true
}
