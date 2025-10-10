import type { PoolOptions, ResolvedConfig } from 'vitest/node'
import { describe, expect, it } from 'vitest'
import { getWorkerMemoryLimit } from 'vitest/src/utils/memory-limit.js'

function makeConfig(poolOptions: PoolOptions): ResolvedConfig {
  return {
    maxWorkers: poolOptions.maxWorkers,
    poolOptions: {
      vmForks: {
        memoryLimit: poolOptions.memoryLimit,
      },
      vmThreads: {
        memoryLimit: poolOptions.memoryLimit,
      },
    },
  } as ResolvedConfig
}

describe('getWorkerMemoryLimit', () => {
  it('should prioritize vmThreads.memoryLimit when pool is vmThreads', () => {
    const config = {
      poolOptions: {
        vmForks: { memoryLimit: undefined },
        vmThreads: { memoryLimit: '256MB' },
      },
    } as ResolvedConfig

    expect(getWorkerMemoryLimit(config, 'vmThreads')).toBe('256MB')
  })

  it('should prioritize vmForks.memoryLimit when pool is vmForks', () => {
    const config = makeConfig({ memoryLimit: '512MB' })
    expect(getWorkerMemoryLimit(config, 'vmForks')).toBe('512MB')
  })

  it('should calculate 1/maxWorkers when vmThreads.memoryLimit is unset', () => {
    const config = makeConfig({ maxWorkers: 4 })
    expect(getWorkerMemoryLimit(config, 'vmThreads')).toBe(1 / 4)
  })

  it('should calculate 1/maxWorkers when vmForks.memoryLimit is unset', () => {
    const config = makeConfig({ maxWorkers: 4 })
    expect(getWorkerMemoryLimit(config, 'vmForks')).toBe(1 / 4)
  })
})
