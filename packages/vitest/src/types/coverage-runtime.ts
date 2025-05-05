import type { ModuleExecutionInfo } from 'vite-node/client'

export interface CoverageRuntime {
  /**
   * Executed before tests are run in the worker thread.
   */
  startCoverage?: (runtimeOptions: { isolate: boolean }) => unknown | Promise<unknown>

  /**
   * Executed on after each run in the worker thread. Possible to return a payload passed to the provider
   */
  takeCoverage?: (runtimeOptions?: { moduleExecutionInfo?: ModuleExecutionInfo }) => unknown | Promise<unknown>

  /**
   * Executed after all tests have been run in the worker thread.
   */
  stopCoverage?: (runtimeOptions: { isolate: boolean }) => unknown | Promise<unknown>
}
