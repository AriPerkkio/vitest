import type { Profiler } from 'node:inspector'

export interface ScriptCoverageWithOffset extends Profiler.ScriptCoverage {
  startOffset: number
}
