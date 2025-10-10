import type { Awaitable } from '@vitest/utils'
import type { TestProject } from './project'
import type { TestSpecification } from './spec'
import type { BuiltinPool, Pool } from './types/pool-options'

export type RunWithFiles = (
  files: TestSpecification[],
  invalidates?: string[]
) => Awaitable<void>

export interface ProcessPool {
  name: string
  runTests: RunWithFiles
  collectTests: RunWithFiles
  close?: () => Awaitable<void>
}

export interface PoolProcessOptions {
  execArgv: string[]
  env: Record<string, string>
}

export const builtinPools: BuiltinPool[] = [
  'forks',
  'threads',
  'browser',
  'vmThreads',
  'vmForks',
  'typescript',
]

function getDefaultPoolName(project: TestProject): Pool {
  if (project.config.browser.enabled) {
    return 'browser'
  }
  return project.config.pool
}

export function getFilePoolName(project: TestProject): Pool {
  return getDefaultPoolName(project)
}
