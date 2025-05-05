import type { CoverageMapData } from 'istanbul-lib-coverage'
import type { CoverageRuntime } from 'vitest'

import { COVERAGE_STORE_KEY } from './constants'

const runtime: CoverageRuntime = {
  takeCoverage() {
    // @ts-expect-error -- untyped global
    return globalThis[COVERAGE_STORE_KEY]
  },

  // Reset coverage map to prevent duplicate results if this is called twice in row
  startCoverage() {
    // @ts-expect-error -- untyped global
    const coverageMap = globalThis[COVERAGE_STORE_KEY] as CoverageMapData

    // When isolated, there are no previous results
    if (!coverageMap) {
      return
    }

    for (const filename in coverageMap) {
      const branches = coverageMap[filename].b

      for (const key in branches) {
        branches[key] = branches[key].map(() => 0)
      }

      for (const metric of ['f', 's'] as const) {
        const entry = coverageMap[filename][metric]

        for (const key in entry) {
          entry[key] = 0
        }
      }
    }
  },
}

export default runtime
